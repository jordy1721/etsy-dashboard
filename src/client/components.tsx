// ---------------------------------------------------------------------------
// Small reusable pieces: tags, cards, charts, action cards and text helpers.
// ---------------------------------------------------------------------------
import { BarController, BarElement, CategoryScale, Chart, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ListingStatus, Suggestion } from "../shared/types";

// Only load the parts of Chart.js we use, to keep the app small.
Chart.register(BarController, BarElement, LineController, LineElement, PointElement, Filler, CategoryScale, LinearScale, Tooltip);

// ---- Text helpers -----------------------------------------------------------

export function pct(value: number | null, digits = 1): string {
  return value === null ? "–" : `${value.toFixed(digits)}%`;
}

/** "3 hours ago" style text from a Unix time. */
export function timeAgo(ts: number | null, now: number): string {
  if (ts === null) return "never";
  const s = Math.max(0, now - ts);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** Country code -> country name where the phone supports it ("IT" -> "Italy"). */
export function countryName(code: string): string {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

// ---- Tags -------------------------------------------------------------------

/** Marks a number that is worked out, not read from Etsy. */
export function Est({ label = "estimated" }: { label?: string }) {
  return <span class="tag est">{label}</span>;
}

/** Marks a number we cannot show because the data is not there. */
export function Missing({ label = "missing data" }: { label?: string }) {
  return <span class="tag missing">{label}</span>;
}

const STATUS_STYLE: Record<ListingStatus, { cls: string; icon: string }> = {
  Working: { cls: "good", icon: "✓" },
  "Needs traffic": { cls: "warn", icon: "→" },
  "Needs a better listing": { cls: "bad", icon: "!" },
  "Not enough data yet": { cls: "", icon: "…" },
};

/** Status label with an icon as well as colour, so it never relies on colour alone. */
export function StatusPill({ status }: { status: ListingStatus }) {
  const st = STATUS_STYLE[status];
  return (
    <span class={`tag pill ${st.cls}`}>
      <span aria-hidden="true">{st.icon}</span>
      {status}
    </span>
  );
}

export function Card({ title, children, right }: { title?: string; children: ComponentChildren; right?: ComponentChildren }) {
  return (
    <section class="card">
      {title && (
        <div class="row between" style="margin-bottom:10px">
          <h2 style="margin:0">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** One line: name on the left, amount on the right. */
export function KV({ k, v, cls = "" }: { k: ComponentChildren; v: ComponentChildren; cls?: string }) {
  return (
    <div class={`kv ${cls}`}>
      <span class="k">{k}</span>
      <span class="v">{v}</span>
    </div>
  );
}

// ---- Charts -----------------------------------------------------------------

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * A simple bar chart with one series. Tap or hover a bar to see its value.
 * `horizontal` turns it on its side (good for country names).
 */
export function BarChart(props: {
  labels: string[];
  values: number[];
  format: (value: number) => string;
  horizontal?: boolean;
  /** Draw a smooth line with a soft fill instead of bars (good for a trend over time). */
  area?: boolean;
  height?: number;
  ariaLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The theme is part of the key so the chart is redrawn in the new colours when it changes.
  const key = JSON.stringify([props.labels, props.values, props.horizontal, props.area, document.documentElement.dataset.theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const text = cssVar("--muted");
    const grid = cssVar("--grid");
    const horizontal = !!props.horizontal;
    const valueAxis = {
      beginAtZero: true,
      grid: { color: grid },
      border: { display: false },
      ticks: { color: text, maxTicksLimit: 4, callback: (v: string | number) => props.format(Number(v)) },
    };
    const labelAxis = {
      grid: { display: false },
      border: { color: grid },
      ticks: { color: text, maxRotation: 0, autoSkip: true, maxTicksLimit: horizontal ? 12 : 6 },
    };
    const series = cssVar("--series");
    const serif = cssVar("--serif");
    Chart.defaults.font.family = serif;
    Chart.defaults.font.size = 12;
    const chart = new Chart(canvas, {
      type: props.area ? "line" : "bar",
      data: {
        labels: props.labels,
        datasets: [
          props.area
            ? {
                data: props.values,
                borderColor: series,
                borderWidth: 2,
                // Smooth, but never swings below zero or above the real values.
                cubicInterpolationMode: "monotone" as const,
                fill: true,
                // Soft wash under the line that fades out towards the bottom.
                backgroundColor: (ctx: { chart: Chart }) => {
                  const area = ctx.chart.chartArea;
                  if (!area) return cssVar("--series-soft");
                  const gradient = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
                  gradient.addColorStop(0, cssVar("--series-soft"));
                  gradient.addColorStop(1, "rgba(0,0,0,0)");
                  return gradient;
                },
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: series,
                pointHoverBorderColor: cssVar("--card-solid"),
                pointHoverBorderWidth: 2,
              }
            : { data: props.values, backgroundColor: series, borderRadius: 4, maxBarThickness: 18, borderSkipped: "start" as const },
        ],
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false, axis: horizontal ? "y" : "x" },
        plugins: {
          legend: { display: false },
          tooltip: { displayColors: false, backgroundColor: cssVar("--accent"), titleColor: cssVar("--on-accent"), bodyColor: cssVar("--on-accent"), cornerRadius: 10, padding: 10, callbacks: { label: (ctx) => props.format(Number(horizontal ? ctx.parsed.x : ctx.parsed.y)) } },
        },
        scales: horizontal ? { x: valueAxis, y: labelAxis } : { x: labelAxis, y: valueAxis },
      },
    });
    return () => chart.destroy();
    // Redraw only when the data changes (the `key` text below captures it).
  }, [key]);

  return (
    <div class="chart-box" style={props.height ? `height:${props.height}px` : undefined}>
      <canvas ref={canvasRef} role="img" aria-label={props.ariaLabel} />
    </div>
  );
}

/**
 * A tiny trend line with no axes, used in the corner of a number tile.
 * It is decoration: the tile's number and the "more/less than" line carry the meaning.
 */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2 || values.every((v) => v === values[0])) return null;
  const w = 120;
  const h = 44;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 10)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg class="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${w} ${h} L0 ${h}Z`} fill="var(--series-soft)" />
      <path d={line} fill="none" stroke="var(--series)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

/** A name, an amount and a thin bar showing its share of the total. */
export function ShareRow({ name, value, share }: { name: ComponentChildren; value: string; share: number | null }) {
  return (
    <div class="share">
      <div class="row between">
        <span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{name}</span>
        <b class="num">{value}</b>
        <span class="pct">{share === null ? "–" : `${share.toFixed(1)}%`}</span>
      </div>
      <div class="bar">
        <div style={`width:${Math.max(0, Math.min(100, share ?? 0))}%`} />
      </div>
    </div>
  );
}

/** Line icon drawn from an SVG path. */
export function Icon({ path, size = 22 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export const ICONS = {
  home: "M4 20V10M10 20V4M16 20v-7M21 20H3",
  sales: "M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  listings: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  ads: "M3 10v4h3l8 5V5L6 10zM17.500 9a4 4 0 0 1 0 6M20 6.500a8 8 0 0 1 0 11",
  money: "M12 3v18M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.500 0-4.200 1.200-4.200 3 0 4.500 9.400 2 9.400 6.500 0 1.900-2 3.200-4.700 3.200-2.300 0-4.200-.9-5-2.400",
  fix: "M14.500 5.500a4.500 4.500 0 0 0-5.800 5.800L3 17v4h4l5.700-5.700a4.500 4.500 0 0 0 5.800-5.800l-3 3-2.500-.500-.500-2.500z",
  next: "M3 17l6-6 4 4 8-8M15 7h6v6",
  gear: "M12 15.500a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM19.400 13.500a7.600 7.600 0 0 0 0-3l2-1.500-2-3.500-2.400 1a7.600 7.600 0 0 0-2.600-1.500L14 2.500h-4l-.400 2.500a7.600 7.600 0 0 0-2.600 1.500l-2.400-1-2 3.500 2 1.500a7.600 7.600 0 0 0 0 3l-2 1.500 2 3.500 2.400-1a7.600 7.600 0 0 0 2.600 1.500l.400 2.500h4l.400-2.500a7.600 7.600 0 0 0 2.600-1.500l2.400 1 2-3.500z",
  moon: "M20 14.500A8 8 0 1 1 9.500 4a6.500 6.500 0 0 0 10.500 10.500z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M2 12h2M20 12h2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400",
  bag: "M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0",
  people: "M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM2.500 20c.5-3.500 3-5.500 6.500-5.500s6 2 6.500 5.500M16 4.500a3.500 3.500 0 0 1 0 6.500M18 14.800c2 .7 3.200 2.400 3.500 5.200",
  eye: "M2 12s3.600-7 10-7 10 7 10 7-3.600 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.500 2.500 3.800 5.500 3.800 9s-1.300 6.500-3.800 9c-2.500-2.500-3.800-5.500-3.800-9S9.500 5.500 12 3z",
  spend: "M3 7h18v11H3zM3 11h18M7 15h3",
};

/** The round brush-stroke logo (an "enso" circle), drawn as two overlapping strokes. */
export function Enso({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M46 12.500C33 4.500 14.500 11 10.500 27.500 6.500 44 19 57 33.500 56 48 55 57.500 42 54.500 28.500 53 21.500 49 16.500 43 13.500" stroke="currentColor" stroke-width="5.200" stroke-linecap="round" />
      <path d="M44.500 13.200C35 8.500 20 13 15.500 26" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" opacity="0.45" />
    </svg>
  );
}

// ---- Action cards -----------------------------------------------------------

/** A to-do item in the three-part format. `rank` shows a numbered circle. */
export function ActionCard({ item, rank, open = false }: { item: Suggestion; rank?: number; open?: boolean }) {
  const [expanded, setExpanded] = useState(open);
  return (
    <section class="card">
      <div class="row" style="align-items:flex-start">
        {rank !== undefined && <span class="rank">{rank}</span>}
        <div class="action-title grow">{item.title}</div>
      </div>
      <div class="numbers">
        <b>Why:</b> {item.numbers}
      </div>
      {expanded ? (
        <>
          <div class="part">
            <div class="part-label">What to do</div>
            <p>{item.what}</p>
          </div>
          <div class="part">
            <div class="part-label">What to consider</div>
            <p>{item.consider}</p>
          </div>
          <div class="part">
            <div class="part-label">What to expect</div>
            <p>{item.expect}</p>
          </div>
        </>
      ) : (
        <button class="toggle" onClick={() => setExpanded(true)}>
          Show what to do
        </button>
      )}
    </section>
  );
}

/** Shows a success or error message under a form. */
export function Message({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <div class={`msg ${msg.ok ? "ok" : "err"}`} role={msg.ok ? "status" : "alert"}>
      {msg.text}
    </div>
  );
}
