// Screen: Ads. Laid out like Etsy's own Ads dashboard:
//   a date range, six headline numbers (tap one to chart it), a chart over time,
//   and a table of advertised listings.
// Etsy's API does not share ad results, so they are typed in at the bottom of this screen.
// Ad spend comes from Etsy's bill when the bill shows it, otherwise from what is typed.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { adVerdict, adsByListing, totalAds, weeksInRange, type AdVerdict, type AdsListingRow, type AdsTotals } from "../../shared/ads";
import { addDays, shortDay, weekStart } from "../../shared/dates";
import { formatAud } from "../../shared/money";
import type { DashboardData } from "../../shared/types";
import { api } from "../api";
import { BarChart, Card, Est, KV, Message, Missing, pct } from "../components";

type Msg = { ok: boolean; text: string } | null;
type MetricKey = "views" | "clicks" | "orders" | "revenue" | "spend" | "roas";

const RANGES: { label: string; weeks: number | null }[] = [
  { label: "This week", weeks: 1 },
  { label: "Last 4 weeks", weeks: 4 },
  { label: "Last 12 weeks", weeks: 12 },
  { label: "All time", weeks: null },
];

const dash = "–";
const count = (n: number | null) => (n === null ? dash : n.toLocaleString("en-AU"));
const money = (c: number | null) => (c === null ? dash : formatAud(c));
const roasText = (r: number | null) => (r === null ? dash : r.toFixed(2));
const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
const numText = (n: number | null) => (n === null ? "" : String(n));

const VERDICT_STYLE: Record<AdVerdict, { cls: string; icon: string }> = {
  Earning: { cls: "good", icon: "✓" },
  "Losing money": { cls: "bad", icon: "!" },
  "Not enough clicks yet": { cls: "", icon: "…" },
  "No numbers yet": { cls: "", icon: "?" },
};

function VerdictPill({ verdict }: { verdict: AdVerdict }) {
  const st = VERDICT_STYLE[verdict];
  return (
    <span class={`tag pill ${st.cls}`}>
      <span aria-hidden="true">{st.icon}</span>
      {verdict}
    </span>
  );
}

/** A headline number that is also a button: tap it to show that number in the chart. */
function StatButton(props: { label: string; value: string; selected: boolean; onSelect: () => void; tag?: ComponentChildren; hint?: string }) {
  return (
    <button class={`tile plain stat-btn ${props.selected ? "selected" : ""}`} aria-pressed={props.selected} onClick={props.onSelect}>
      <div class="label">
        {props.label} {props.tag}
      </div>
      <div class="value">{props.value}</div>
      {props.hint && <div class="delta">{props.hint}</div>}
    </button>
  );
}

// ---- The table of advertised listings ----------------------------------------
type SortKey = "spend" | "views" | "clicks" | "rate" | "orders" | "revenue" | "roas";
const SORTS: { key: SortKey; label: string; pick: (r: AdsListingRow) => number | null }[] = [
  { key: "views", label: "Views", pick: (r) => r.views },
  { key: "clicks", label: "Clicks", pick: (r) => r.clicks },
  { key: "rate", label: "Click rate", pick: (r) => r.clickRatePct },
  { key: "orders", label: "Orders", pick: (r) => r.orders },
  { key: "revenue", label: "Revenue", pick: (r) => r.revenueCents },
  { key: "spend", label: "Spend", pick: (r) => r.spendCents },
  { key: "roas", label: "ROAS", pick: (r) => r.roas },
];

function ListingsTable({ rows }: { rows: AdsListingRow[] }) {
  const [sort, setSort] = useState<SortKey>("spend");
  const pick = SORTS.find((s) => s.key === sort)?.pick ?? ((r: AdsListingRow) => r.spendCents);
  const sorted = [...rows].sort((a, b) => (pick(b) ?? -1) - (pick(a) ?? -1));

  if (rows.length === 0) {
    return <p class="muted">No per-listing ad numbers typed in for this range. Add them below under "Each listing".</p>;
  }
  return (
    <>
      {/* Desktop: a real table, like Etsy's. Click a column name to sort by it. */}
      <div class="desktop-only">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Listing</th>
              {SORTS.map((s) => (
                <th key={s.key} scope="col" class="r" aria-sort={sort === s.key ? "descending" : undefined}>
                  <button class={sort === s.key ? "active" : ""} onClick={() => setSort(s.key)}>
                    {s.label}
                    {sort === s.key ? " ▾" : ""}
                  </button>
                </th>
              ))}
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.listingId}>
                <th scope="row">{r.title}</th>
                <td class="r">{count(r.views)}</td>
                <td class="r">{count(r.clicks)}</td>
                <td class="r">{pct(r.clickRatePct)}</td>
                <td class="r">{count(r.orders)}</td>
                <td class="r">{money(r.revenueCents)}</td>
                <td class="r">{formatAud(r.spendCents)}</td>
                <td class="r">{roasText(r.roas)}</td>
                <td>
                  <VerdictPill verdict={r.verdict} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: one block per listing, because eight columns do not fit. */}
      <div class="phone-only">
        {sorted.map((r) => (
          <div key={r.listingId} style="padding:12px 0;border-top:1px solid var(--line)">
            <div style="font-weight:600;margin-bottom:6px">{r.title}</div>
            <VerdictPill verdict={r.verdict} />
            <p class="small muted" style="margin-top:6px">{r.verdictWhy}</p>
            <div class="stats">
              <div class="stat"><div class="s-label">Views</div><div class="s-value">{count(r.views)}</div></div>
              <div class="stat"><div class="s-label">Clicks</div><div class="s-value">{count(r.clicks)}</div></div>
              <div class="stat"><div class="s-label">Click rate</div><div class="s-value">{pct(r.clickRatePct)}</div></div>
              <div class="stat"><div class="s-label">Orders</div><div class="s-value">{count(r.orders)}</div></div>
              <div class="stat"><div class="s-label">Revenue</div><div class="s-value">{money(r.revenueCents)}</div></div>
              <div class="stat"><div class="s-label">Spend</div><div class="s-value">{formatAud(r.spendCents)}</div></div>
              <div class="stat"><div class="s-label">ROAS</div><div class="s-value">{roasText(r.roas)}</div></div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---- Typing in a week of ad numbers -------------------------------------------
type RowForm = { spend: string; views: string; clicks: string; orders: string; revenue: string };
const EMPTY_ROW: RowForm = { spend: "", views: "", clicks: "", orders: "", revenue: "" };

function NumberInputs({ value, onChange, spendLabel }: { value: RowForm; onChange: (next: RowForm) => void; spendLabel: string }) {
  const set = (key: keyof RowForm) => (e: { currentTarget: HTMLInputElement }) => onChange({ ...value, [key]: e.currentTarget.value });
  return (
    <div class="grid2 ad-inputs">
      <label class="field">{spendLabel}<input type="text" inputMode="decimal" placeholder="0.00" value={value.spend} onInput={set("spend")} /></label>
      <label class="field">Revenue (A$)<input type="text" inputMode="decimal" placeholder="0.00" value={value.revenue} onInput={set("revenue")} /></label>
      <label class="field">Views<input type="text" inputMode="numeric" placeholder="0" value={value.views} onInput={set("views")} /></label>
      <label class="field">Clicks<input type="text" inputMode="numeric" placeholder="0" value={value.clicks} onInput={set("clicks")} /></label>
      <label class="field">Orders<input type="text" inputMode="numeric" placeholder="0" value={value.orders} onInput={set("orders")} /></label>
    </div>
  );
}

function EntryCard({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const thisMonday = weekStart(data.today);
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(thisMonday, -7 * i));
  const [week, setWeek] = useState(thisMonday);
  const [shop, setShop] = useState<RowForm>(EMPTY_ROW);
  const [perListing, setPerListing] = useState<Record<number, RowForm>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  // When a week is picked, load what is already saved for it.
  useEffect(() => {
    const w = data.ads.weeks.find((x) => x.weekStart === week);
    setShop({
      spend: dollars(w?.typedSpendCents ?? null),
      views: numText(w?.views ?? null),
      clicks: numText(w?.clicks ?? null),
      orders: numText(w?.orders ?? null),
      revenue: dollars(w?.revenueCents ?? null),
    });
    const next: Record<number, RowForm> = {};
    for (const s of data.ads.listingStats.filter((x) => x.weekStart === week)) {
      next[s.listingId] = { spend: dollars(s.spendCents), views: numText(s.views), clicks: numText(s.clicks), orders: numText(s.orders), revenue: dollars(s.revenueCents) };
    }
    setPerListing(next);
  }, [week, data.generatedAt]);

  const weekLabel = (ws: string) => `${shortDay(ws)} – ${shortDay(addDays(ws, 6))}${ws === thisMonday ? " (this week)" : ""}`;
  const billWeek = data.ads.weeks.find((w) => w.weekStart === week && w.spendSource === "bill");

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const listings = Object.entries(perListing).map(([listingId, row]) => ({ listingId: Number(listingId), ...row }));
      await api("/api/ads", { json: { weekStart: week, ...shop, listings } });
      setMsg({ ok: true, text: `Saved the week of ${shortDay(week)}.` });
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Something went wrong." });
    }
    setBusy(false);
  };

  const remove = async (ws: string) => {
    if (!confirm(`Delete the ad numbers for the week of ${shortDay(ws)}?`)) return;
    try {
      await api(`/api/ads/${ws}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Something went wrong." });
    }
  };

  const saved = [...data.ads.weeks].filter((w) => w.typedSpendCents !== null || w.views !== null || w.clicks !== null || w.orders !== null || w.revenueCents !== null).reverse();
  return (
    <Card title="Type in ad numbers">
      <p class="muted small" style="margin-bottom:10px">
        On Etsy open <b>Marketing &gt; Etsy Ads</b>, set the dates to one week (Monday to Sunday), and copy the numbers here. Leave a box empty if you do not know it.
      </p>
      <form class="stack" onSubmit={(e) => void save(e)}>
        <label class="field">
          Week (Monday to Sunday)
          <select value={week} onChange={(e) => setWeek(e.currentTarget.value)}>
            {weeks.map((ws) => (
              <option key={ws} value={ws}>{weekLabel(ws)}</option>
            ))}
          </select>
        </label>

        <h3>Whole shop</h3>
        <NumberInputs value={shop} onChange={setShop} spendLabel="Ad spend (A$)" />
        {billWeek && (
          <p class="small muted">
            Etsy's bill already shows <b>{formatAud(billWeek.spendCents)}</b> of ad charges for this week. That figure is used, and a typed spend is ignored for this week.
          </p>
        )}

        <details>
          <summary>Each listing (optional)</summary>
          <p class="muted small" style="margin-bottom:8px">Fill in only the listings you advertise. This is what shows which ads earn and which lose.</p>
          {data.listings.map((l) => (
            <div key={l.listingId} style="padding:10px 0;border-top:1px solid var(--line)">
              <div style="font-weight:600;margin-bottom:6px">{l.title}</div>
              <NumberInputs value={perListing[l.listingId] ?? EMPTY_ROW} onChange={(next) => setPerListing({ ...perListing, [l.listingId]: next })} spendLabel="Spend (A$)" />
            </div>
          ))}
        </details>

        <button class="btn primary block" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save week"}
        </button>
        <Message msg={msg} />
      </form>

      {saved.length > 0 && (
        <div style="margin-top:14px">
          <h3 style="margin-bottom:4px">Saved weeks</h3>
          {saved.map((w) => (
            <div key={w.weekStart} class="row between" style="padding:8px 0;border-top:1px solid var(--line)">
              <button class="grow" style="border:0;background:none;text-align:left;padding:0;min-height:44px" onClick={() => setWeek(w.weekStart)} disabled={!weeks.includes(w.weekStart)}>
                <div style="font-weight:600">{shortDay(w.weekStart)} – {shortDay(addDays(w.weekStart, 6))}</div>
                <div class="muted small">
                  Spend {formatAud(w.spendCents)} · Clicks {count(w.clicks)} · Orders {count(w.orders)}
                </div>
              </button>
              <button class="btn danger smallbtn" aria-label={`Delete ad numbers for week of ${shortDay(w.weekStart)}`} onClick={() => void remove(w.weekStart)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---- The screen ------------------------------------------------------------------
export function Ads({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const [rangeIndex, setRangeIndex] = useState(1);
  const [metric, setMetric] = useState<MetricKey>("spend");
  const ads = data.ads;
  const range = RANGES[rangeIndex] ?? RANGES[1]!;

  const weeks = weeksInRange(ads.weeks, data.today, range.weeks);
  const totals: AdsTotals = totalAds(weeks, ads.feeSharePct);
  const verdict = adVerdict(totals, ads.feeSharePct);
  const titles = new Map(data.listings.map((l) => [l.listingId, l.title]));
  const listingRows = adsByListing(ads.listingStats, titles, ads.feeSharePct, new Set(weeks.map((w) => w.weekStart)));
  const anyTyped = weeks.some((w) => w.spendSource === "typed");
  const anyBill = weeks.some((w) => w.spendSource === "bill");
  const spendTag = totals.spendCents === 0 ? undefined : anyTyped ? <Est label={anyBill ? "partly typed in" : "typed in"} /> : <span class="tag">from Etsy's bill</span>;
  const missing = <Missing label="not typed in" />;

  // The chart: one bar per week for the number that was tapped.
  const METRICS: Record<MetricKey, { label: string; pick: (w: (typeof weeks)[number]) => number | null; format: (v: number) => string }> = {
    views: { label: "Views", pick: (w) => w.views, format: (v) => String(Math.round(v)) },
    clicks: { label: "Clicks", pick: (w) => w.clicks, format: (v) => String(Math.round(v)) },
    orders: { label: "Orders", pick: (w) => w.orders, format: (v) => (Number.isInteger(v) ? String(v) : "") },
    revenue: { label: "Revenue", pick: (w) => (w.revenueCents === null ? null : w.revenueCents / 100), format: (v) => formatAud(Math.round(v * 100)) },
    spend: { label: "Spend", pick: (w) => w.spendCents / 100, format: (v) => formatAud(Math.round(v * 100)) },
    roas: { label: "ROAS", pick: (w) => (w.revenueCents !== null && w.spendCents > 0 ? w.revenueCents / w.spendCents : null), format: (v) => v.toFixed(2) },
  };
  const m = METRICS[metric];
  const missingWeeks = weeks.filter((w) => m.pick(w) === null).length;

  return (
    <>
      <div class="chips" role="group" aria-label="Date range">
        {RANGES.map((r, i) => (
          <button key={r.label} class={`chip ${rangeIndex === i ? "active" : ""}`} aria-pressed={rangeIndex === i} onClick={() => setRangeIndex(i)}>
            {r.label}
          </button>
        ))}
      </div>

      {ads.weeks.length === 0 ? (
        <Card title="No ad data yet">
          <p class="muted">
            No ad charges were found in Etsy's bill and nothing has been typed in. If you run Etsy Ads, add this week's numbers below. If you do not run ads, there is nothing to do here.
          </p>
        </Card>
      ) : (
        <>
          <div class="tiles ads-tiles">
            <StatButton label="Views" value={count(totals.views)} tag={totals.views === null ? missing : undefined} selected={metric === "views"} onSelect={() => setMetric("views")} />
            <StatButton
              label="Clicks"
              value={count(totals.clicks)}
              tag={totals.clicks === null ? missing : undefined}
              hint={totals.clickRatePct === null ? undefined : `Click rate ${pct(totals.clickRatePct)}`}
              selected={metric === "clicks"}
              onSelect={() => setMetric("clicks")}
            />
            <StatButton label="Orders" value={count(totals.orders)} tag={totals.orders === null ? missing : undefined} selected={metric === "orders"} onSelect={() => setMetric("orders")} />
            <StatButton label="Revenue" value={money(totals.revenueCents)} tag={totals.revenueCents === null ? missing : undefined} selected={metric === "revenue"} onSelect={() => setMetric("revenue")} />
            <StatButton label="Spend" value={formatAud(totals.spendCents)} tag={spendTag} selected={metric === "spend"} onSelect={() => setMetric("spend")} />
            <StatButton
              label="ROAS"
              value={roasText(totals.roas)}
              tag={totals.roas === null ? <Missing /> : undefined}
              hint={`Break-even is ${ads.breakEvenRoas.toFixed(2)}`}
              selected={metric === "roas"}
              onSelect={() => setMetric("roas")}
            />
          </div>

          <div class="split">
            <Card title={`${m.label} per week`}>
              {weeks.length === 0 ? (
                <p class="muted">No ad activity in this range.</p>
              ) : (
                <>
                  <BarChart
                    labels={weeks.map((w) => shortDay(w.weekStart))}
                    values={weeks.map((w) => m.pick(w) ?? 0)}
                    format={m.format}
                    ariaLabel={`Bar chart of ad ${m.label.toLowerCase()} per week`}
                  />
                  <p class="muted small" style="margin-top:8px">
                    Each bar is one week, labelled by its Monday. Tap a number above to chart it.
                    {missingWeeks > 0 && ` ${missingWeeks} week${missingWeeks === 1 ? " has" : "s have"} no ${m.label.toLowerCase()} typed in and show as empty.`}
                  </p>
                </>
              )}
            </Card>

            <Card title="Are the ads paying off?">
              <VerdictPill verdict={verdict.verdict} />
              <p class="small muted" style="margin:8px 0">{verdict.why}</p>
              <KV k="Sales from ads" v={money(totals.revenueCents)} />
              <KV k={<>Etsy fees on those sales <Est /></>} v={totals.revenueCents === null ? dash : `-${formatAud(Math.round((totals.revenueCents * ads.feeSharePct) / 100))}`} />
              <KV k="Ad spend" v={`-${formatAud(totals.spendCents)}`} />
              <KV
                cls="total"
                k="Profit after ads"
                v={totals.profitCents === null ? dash : <span class={totals.profitCents < 0 ? "neg" : "pos"}>{formatAud(totals.profitCents)}</span>}
              />
              <hr />
              <KV cls="sub" k="Cost per click" v={money(totals.costPerClickCents)} />
              <KV cls="sub" k="Ad spend per order" v={money(totals.costPerOrderCents)} />
              <p class="muted small" style="margin-top:8px">
                ROAS means "return on ad spend": sales from ads divided by ad spend. Etsy keeps about {ads.feeSharePct.toFixed(0)}% of each sale in fees, so you need a ROAS of {ads.breakEvenRoas.toFixed(2)} just to get your ad money back.
              </p>
            </Card>
          </div>

          <Card title="Advertised listings">
            <ListingsTable rows={listingRows} />
          </Card>
        </>
      )}

      <div class="split even">
        <EntryCard data={data} reload={reload} />
        <Card title="Where these numbers come from">
          <ul class="list-plain small muted">
            <li>Etsy does not share ad views, clicks, orders or revenue through its API. Those are typed in by you.</li>
            <li>Ad spend is read from Etsy's bill when the bill shows ad charges for that week. Those lines are picked out by name, so treat them as probable.</li>
            <li>For a week with no ad charges on the bill, the spend you type in is used.</li>
            <li>"Profit after ads" takes Etsy's fees off the ad sales using your shop's average fee share. It is an estimate.</li>
            <li>This screen cannot turn ads on or off or change your budget. Do that on Etsy.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
