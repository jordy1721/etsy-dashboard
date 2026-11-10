// ---------------------------------------------------------------------------
// Small reusable pieces: tags, cards, charts, action cards and text helpers.
// ---------------------------------------------------------------------------
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ListingStatus, Suggestion } from "../shared/types";

// Only load the parts of Chart.js we use, to keep the app small.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

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
  height?: number;
  ariaLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify([props.labels, props.values, props.horizontal]);

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
    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: props.labels,
        datasets: [{ data: props.values, backgroundColor: cssVar("--series"), borderRadius: 4, maxBarThickness: 18, borderSkipped: "start" }],
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false, axis: horizontal ? "y" : "x" },
        plugins: {
          legend: { display: false },
          tooltip: { displayColors: false, callbacks: { label: (ctx) => props.format(Number(horizontal ? ctx.parsed.x : ctx.parsed.y)) } },
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
