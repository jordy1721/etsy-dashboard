// Screen 2: Sales. Every item sold with price paid, discount, fees, profit and country.
import { useMemo, useState } from "preact/hooks";
import { addDays, dayRange, shortDay } from "../../shared/dates";
import { formatAud, sum } from "../../shared/money";
import type { DashboardData, SaleRow } from "../../shared/types";
import { BarChart, Card, Est, KV, countryName, pct } from "../components";

function SaleCard({ sale, minProfit }: { sale: SaleRow; minProfit: number }) {
  return (
    <section class="card">
      <div class="row between" style="align-items:flex-start">
        <div class="grow">
          <h3>{sale.title}</h3>
          <div class="muted small">
            {shortDay(sale.day)} · {countryName(sale.country)}
            {sale.quantity > 1 ? ` · ${sale.quantity} items` : ""}
          </div>
        </div>
        <div class="right">
          <div class={`num ${sale.profitCents < 0 ? "neg" : ""}`} style="font-size:18px;font-weight:800">
            {formatAud(sale.profitCents)}
          </div>
          <div class="muted small">profit</div>
        </div>
      </div>
      {sale.belowMinimum && (
        <div style="margin-top:8px">
          <span class="tag bad">! below your {formatAud(minProfit)} minimum</span>
        </div>
      )}
      <div style="margin-top:8px">
        <KV
          k="Price paid"
          v={
            <>
              {sale.listCents !== null && sale.listCents !== sale.paidCents && <span class="strike">{formatAud(sale.listCents)}</span>} {formatAud(sale.paidCents)}
            </>
          }
        />
        <KV
          k={<>Discount {sale.listEstimated && sale.listCents !== null && <Est label="list price estimated" />}</>}
          v={sale.discountPct === null ? "–" : `${pct(sale.discountPct, 0)} off`}
        />
        <KV k={<>Etsy fees {sale.feesEstimated && <Est />}</>} v={`-${formatAud(sale.feesCents)}`} />
        <KV k={<>Share of ads and costs <Est /></>} v={`-${formatAud(sale.overheadCents)}`} />
        {sale.taxCollectedCents > 0 && <KV cls="sub" k="Tax collected (not mine)" v={formatAud(sale.taxCollectedCents)} />}
      </div>
    </section>
  );
}

export function Sales({ data }: { data: DashboardData }) {
  const firstDay = data.days[0]?.day ?? data.today;
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(data.today);
  const [listing, setListing] = useState("all");

  const preset = (days: number | null) => {
    setFrom(days === null ? firstDay : addDays(data.today, -(days - 1)));
    setTo(data.today);
  };
  const isPreset = (days: number | null) => to === data.today && from === (days === null ? firstDay : addDays(data.today, -(days - 1)));

  // Listings that have at least one sale, for the filter.
  const options = useMemo(() => {
    const seen = new Map<number, string>();
    for (const s of data.sales) if (!seen.has(s.listingId)) seen.set(s.listingId, s.title);
    return [...seen.entries()];
  }, [data.sales]);

  const rows = data.sales.filter((s) => s.day >= from && s.day <= to && (listing === "all" || String(s.listingId) === listing));

  // Chart: revenue per day in the chosen range.
  const span = from <= to ? dayRange(from, to) : [];
  const perDay = new Map<string, number>();
  for (const s of rows) perDay.set(s.day, (perDay.get(s.day) ?? 0) + s.paidCents);

  // Chart: orders per country.
  const perCountry = new Map<string, Set<number>>();
  for (const s of rows) perCountry.set(s.country, (perCountry.get(s.country) ?? new Set<number>()).add(s.receiptId));
  const countries = [...perCountry.entries()].map(([c, set]) => ({ c, n: set.size })).sort((x, y) => y.n - x.n);

  return (
    <div class="split side">
      <div class="stack sticky-col" style="gap:14px">
      <section class="card stack">
        <div class="chips">
          <button class={`chip ${isPreset(7) ? "active" : ""}`} onClick={() => preset(7)}>7 days</button>
          <button class={`chip ${isPreset(30) ? "active" : ""}`} onClick={() => preset(30)}>30 days</button>
          <button class={`chip ${isPreset(null) ? "active" : ""}`} onClick={() => preset(null)}>All time</button>
        </div>
        <div class="grid2">
          <label class="field">
            From
            <input type="date" value={from} max={to} onInput={(e) => e.currentTarget.value && setFrom(e.currentTarget.value)} />
          </label>
          <label class="field">
            To
            <input type="date" value={to} min={from} max={data.today} onInput={(e) => e.currentTarget.value && setTo(e.currentTarget.value)} />
          </label>
        </div>
        <label class="field">
          Listing
          <select value={listing} onChange={(e) => setListing(e.currentTarget.value)}>
            <option value="all">All listings</option>
            {options.map(([id, title]) => (
              <option key={id} value={String(id)}>{title}</option>
            ))}
          </select>
        </label>
      </section>

      <div class="tiles two">
        <div class="tile plain">
          <div class="label">Items sold</div>
          <div class="value">{sum(rows.map((r) => r.quantity))}</div>
        </div>
        <div class="tile plain">
          <div class="label">Revenue</div>
          <div class="value">{formatAud(sum(rows.map((r) => r.paidCents)))}</div>
        </div>
      </div>

      </div>

      <div class="stack" style="gap:14px">
      {rows.length === 0 ? (
        <Card>
          <p class="muted center">No sales in this range.</p>
        </Card>
      ) : (
        <>
          <div class="grid-2">
          <Card title="Sales by day">
            <BarChart
              labels={span.map(shortDay)}
              values={span.map((d) => (perDay.get(d) ?? 0) / 100)}
              format={(v) => formatAud(Math.round(v * 100))}
              height={190}
              ariaLabel="Bar chart of revenue per day in the chosen date range"
            />
          </Card>
          <Card title="Orders by country">
            <BarChart
              horizontal
              labels={countries.map((x) => countryName(x.c))}
              values={countries.map((x) => x.n)}
              format={(v) => (Number.isInteger(v) ? String(v) : "")}
              height={Math.max(190, countries.length * 30 + 40)}
              ariaLabel="Bar chart of orders per buyer country"
            />
          </Card>
          </div>
          <h2 class="section-title" style="margin:4px 0 -4px">{rows.length} {rows.length === 1 ? "sale" : "sales"}</h2>
          <div class="grid-2">
            {rows.map((s) => (
              <SaleCard key={s.transactionId} sale={s} minProfit={data.settings.minProfitCents} />
            ))}
          </div>
        </>
      )}
      </div>
    </div>
  );
}
