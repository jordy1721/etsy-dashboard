// Screen 1: Today / Overview. Last 7 days against the 7 days before.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { shortDay } from "../../shared/dates";
import { formatAud } from "../../shared/money";
import type { DashboardData } from "../../shared/types";
import type { Tab } from "../app";
import { ActionCard, BarChart, Card, Est, ICONS, Icon, Missing, ShareRow, Sparkline, countryName, pct } from "../components";

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

function Tile(props: { label: string; value: ComponentChildren; icon: string; tag?: ComponentChildren; spark?: number[]; children?: ComponentChildren }) {
  return (
    <div class="tile">
      <span class="tile-ico">
        <Icon path={props.icon} size={20} />
      </span>
      <div class="label">
        {props.label} {props.tag}
      </div>
      <div class="value">{props.value}</div>
      {props.children}
      {props.spark && <Sparkline values={props.spark} />}
    </div>
  );
}

export function Overview({ data, go }: { data: DashboardData; go: (tab: Tab) => void }) {
  const a = data.thisWeek;
  const b = data.lastWeek;
  const m = data.money;
  const [range, setRange] = useState<7 | 30 | 90>(30);
  // Profit and spend lean on estimates when fees are not from Etsy's bill or ads were typed in.
  const moneyEstimated = m.feesSource === "estimated" || m.adsSource === "manual" || m.adsSource === "mixed";
  const count = (n: number) => String(n);
  const top = data.nextSteps[0];

  // Trend chart: revenue per day for the chosen range.
  const chartDays = data.days.slice(-range);
  // Tiny tile trends: for each of the last 14 days, the total of the 7 days up to
  // that day. A real trend (it can go down as well as up), smoother than single days.
  const all = data.days;
  const start = Math.max(0, all.length - 14);
  const last14 = all.slice(start);
  const running = (pick: (d: (typeof all)[number]) => number) =>
    last14.map((_, i) => all.slice(Math.max(0, start + i - 6), start + i + 1).reduce((n, d) => n + pick(d), 0));
  const viewsKnown = all.slice(Math.max(0, start - 6)).every((d) => d.views !== null);

  // Top listings and regions, as a share of all-time revenue / orders.
  const topListings = data.listings.filter((l) => l.revenueCents > 0).slice(0, 4);
  const totalOrders = data.countries.reduce((n, c) => n + c.orders, 0);
  const regions = data.countries.slice(0, 5);
  const otherOrders = totalOrders - regions.reduce((n, c) => n + c.orders, 0);

  return (
    <>
      <p class="muted small">Last 7 days, compared with the 7 days before.</p>
      <div class="tiles">
        <Tile label="Revenue" icon={ICONS.bag} value={formatAud(a.revenueCents)} spark={running((d) => d.revenueCents)}>
          <Delta now={a.revenueCents} before={b.revenueCents} format={formatAud} goodWhenUp={true} />
        </Tile>
        <Tile label="Orders" icon={ICONS.sales} value={a.orders} spark={running((d) => d.orders)}>
          <Delta now={a.orders} before={b.orders} format={count} goodWhenUp={true} />
        </Tile>
        <Tile
          label="Net profit"
          icon={ICONS.money}
          value={<span class={a.profitCents < 0 ? "neg" : ""}>{formatAud(a.profitCents)}</span>}
          tag={moneyEstimated ? <Est /> : undefined}
          spark={running((d) => d.profitCents)}
        >
          <Delta now={a.profitCents} before={b.profitCents} format={formatAud} goodWhenUp={true} />
        </Tile>
        <Tile label="Spend" icon={ICONS.spend} value={formatAud(a.spendCents)} tag={moneyEstimated ? <Est /> : undefined} spark={running((d) => d.feesCents + d.adsCents + d.costsCents)}>
          <Delta now={a.spendCents} before={b.spendCents} format={formatAud} goodWhenUp={null} />
        </Tile>
        <Tile
          label="Listing views"
          icon={ICONS.eye}
          value={a.views === null ? "–" : a.views}
          tag={a.views === null ? <Missing /> : undefined}
          spark={viewsKnown ? running((d) => d.views ?? 0) : undefined}
        >
          {a.views === null ? <div class="delta">Needs 7 days of history</div> : <Delta now={a.views} before={b.views} format={count} goodWhenUp={true} />}
        </Tile>
        <Tile
          label="Conversion"
          icon={ICONS.people}
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

      <div class="split">
        <Card
          title="Sales revenue"
          right={
            <div class="seg" role="group" aria-label="Chart range">
              {([7, 30, 90] as const).map((n) => (
                <button key={n} class={range === n ? "active" : ""} aria-pressed={range === n} onClick={() => setRange(n)}>
                  {n}D
                </button>
              ))}
            </div>
          }
        >
          <BarChart
            area
            labels={chartDays.map((d) => shortDay(d.day))}
            values={chartDays.map((d) => d.revenueCents / 100)}
            format={(v) => formatAud(Math.round(v * 100))}
            ariaLabel={`Line chart of revenue per day for the last ${chartDays.length} days`}
          />
          <p class="muted small" style="margin-top:8px">
            Revenue per day, last {chartDays.length} days{chartDays.length < range ? " (all the history there is)" : ""}. Touch the chart to see a day.
          </p>
        </Card>

        <Card title="Top listings">
          {topListings.length === 0 ? (
            <p class="muted">No sales yet.</p>
          ) : (
            topListings.map((l) => (
              <ShareRow key={l.listingId} name={l.title} value={formatAud(l.revenueCents)} share={m.revenueCents > 0 ? (l.revenueCents / m.revenueCents) * 100 : null} />
            ))
          )}
          <p class="muted small" style="margin-top:8px">Share of all-time revenue.</p>
        </Card>
      </div>

      <div class="split even">
        <div class="stack" style="gap:14px">
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
        </div>

        <div class="stack" style="gap:14px">
          <Card title="Sales by region">
            {regions.length === 0 ? (
              <p class="muted">No sales yet.</p>
            ) : (
              <>
                {regions.map((c) => (
                  <ShareRow
                    key={c.country}
                    name={
                      <span class="row">
                        <span class="dot" />
                        {countryName(c.country)}
                      </span>
                    }
                    value={`${c.orders} order${c.orders === 1 ? "" : "s"}`}
                    share={totalOrders > 0 ? (c.orders / totalOrders) * 100 : null}
                  />
                ))}
                {otherOrders > 0 && <ShareRow name="Other" value={`${otherOrders} order${otherOrders === 1 ? "" : "s"}`} share={(otherOrders / totalOrders) * 100} />}
              </>
            )}
            <p class="muted small" style="margin-top:8px">Share of all orders, by buyer country.</p>
          </Card>

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
        </div>
      </div>
    </>
  );
}
