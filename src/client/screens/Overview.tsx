// Screen 1: Today / Overview. Last 7 days against the 7 days before.
import type { ComponentChildren } from "preact";
import { shortDay } from "../../shared/dates";
import { formatAud } from "../../shared/money";
import type { DashboardData } from "../../shared/types";
import type { Tab } from "../app";
import { ActionCard, BarChart, Card, Est, Missing, pct } from "../components";

/** "▲ A$8.10 more than the week before" */
function Delta({ now, before, format, goodWhenUp }: { now: number | null; before: number | null; format: (n: number) => string; goodWhenUp: boolean | null }) {
  if (now === null || before === null) return <div class="delta">No comparison yet</div>;
  const diff = now - before;
  if (diff === 0) return <div class="delta">Same as the week before</div>;
  const up = diff > 0;
  // Colour only when "up" clearly means good or bad. Spend going up is neither by itself.
  const cls = goodWhenUp === null ? "" : up === goodWhenUp ? "up" : "down";
  return (
    <div class="delta">
      <span class={cls}>
        {up ? "▲" : "▼"} {format(Math.abs(diff))}
      </span>{" "}
      {up ? "more" : "less"} than the week before
    </div>
  );
}

function Tile({ label, value, tag, children }: { label: string; value: ComponentChildren; tag?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="tile">
      <div class="label">
        {label} {tag}
      </div>
      <div class="value">{value}</div>
      {children}
    </div>
  );
}

export function Overview({ data, go }: { data: DashboardData; go: (tab: Tab) => void }) {
  const a = data.thisWeek;
  const b = data.lastWeek;
  const m = data.money;
  // Profit and spend lean on estimates when fees are not from Etsy's bill or ads were typed in.
  const moneyEstimated = m.feesSource === "estimated" || m.adsSource === "manual" || m.adsSource === "mixed";
  const count = (n: number) => String(n);
  const top = data.nextSteps[0];
  const last28 = data.days.slice(-28);

  return (
    <>
      <p class="muted small">Last 7 days, compared with the 7 days before.</p>
      <div class="tiles">
        <Tile label="Revenue" value={formatAud(a.revenueCents)}>
          <Delta now={a.revenueCents} before={b.revenueCents} format={formatAud} goodWhenUp={true} />
        </Tile>
        <Tile label="Orders" value={a.orders}>
          <Delta now={a.orders} before={b.orders} format={count} goodWhenUp={true} />
        </Tile>
        <Tile label="Net profit" value={<span class={a.profitCents < 0 ? "neg" : ""}>{formatAud(a.profitCents)}</span>} tag={moneyEstimated ? <Est /> : undefined}>
          <Delta now={a.profitCents} before={b.profitCents} format={formatAud} goodWhenUp={true} />
        </Tile>
        <Tile label="Spend" value={formatAud(a.spendCents)} tag={moneyEstimated ? <Est /> : undefined}>
          <Delta now={a.spendCents} before={b.spendCents} format={formatAud} goodWhenUp={null} />
        </Tile>
        <Tile label="Listing views" value={a.views === null ? "–" : a.views} tag={a.views === null ? <Missing /> : undefined}>
          {a.views === null ? <div class="delta">Needs 7 days of history</div> : <Delta now={a.views} before={b.views} format={count} goodWhenUp={true} />}
        </Tile>
        <Tile
          label="Conversion"
          value={pct(a.conversionPct)}
          tag={a.conversionBasis === "views" ? <Est /> : a.conversionBasis === "none" ? <Missing /> : undefined}
        >
          <div class="delta">
            {a.conversionBasis === "visits" && `${a.orders} orders from ${a.visits} visits`}
            {a.conversionBasis === "views" && "Orders ÷ listing views. Enter visits for the real rate."}
            {a.conversionBasis === "none" && "Enter weekly visits in Settings"}
          </div>
        </Tile>
      </div>
      <p class="muted small">
        Spend = Etsy fees {formatAud(a.feesCents)} + ads {formatAud(a.adsCents)} + other costs {formatAud(a.costsCents)}.
      </p>

      <Card title="Revenue per day">
        <BarChart
          labels={last28.map((d) => shortDay(d.day))}
          values={last28.map((d) => d.revenueCents / 100)}
          format={(v) => formatAud(Math.round(v * 100))}
          ariaLabel="Bar chart of revenue per day for the last 28 days"
        />
        <p class="muted small" style="margin-top:8px">Last {last28.length} days. Tap a bar to see the amount.</p>
      </Card>

      {top ? (
        <>
          <h2 class="section-title" style="margin:4px 0 -4px">Most important thing to do next</h2>
          <ActionCard item={top} open />
          <button class="btn block" onClick={() => go("next")}>
            See this week's 3 next steps
          </button>
        </>
      ) : (
        <Card title="Most important thing to do next">
          <p class="muted">Nothing urgent right now. Keep an eye on views and profit per sale.</p>
        </Card>
      )}

      {data.briefing && (
        <Card title="Claude briefing">
          <p style="white-space:pre-wrap">{data.briefing.text}</p>
          <p class="muted small" style="margin-top:8px">Written by AI from the numbers above. Check anything important yourself.</p>
        </Card>
      )}

      {data.dataNotes.length > 0 && (
        <section class="card">
          <details>
            <summary>About these numbers ({data.dataNotes.length})</summary>
            <ul class="list-plain small muted">
              {data.dataNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </>
  );
}
