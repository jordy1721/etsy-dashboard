// Screen 4: Money. Revenue, fees, ads, costs, net profit, break-even and profit per sale.
import { shortDay } from "../../shared/dates";
import { formatAud } from "../../shared/money";
import type { DashboardData } from "../../shared/types";
import { Card, Est, KV, pct } from "../components";

export function Money({ data }: { data: DashboardData }) {
  const m = data.money;
  const adsTag =
    m.adsSource === "ledger" ? <span class="tag">from Etsy's bill</span> : m.adsSource === "none" ? <span class="tag missing">none found</span> : <Est label={m.adsSource === "mixed" ? "partly typed in" : "typed in"} />;
  const progress = m.salesToBreakEven && m.salesToBreakEven > 0 ? Math.min(100, Math.round((m.items / m.salesToBreakEven) * 100)) : 100;

  return (
    <>
      <p class="muted small">All time, in Australian dollars.</p>

      <Card title="Profit">
        <KV k="Revenue (items, after discounts)" v={formatAud(m.revenueCents)} />
        <KV
          k={<>Etsy fees {m.feesSource === "ledger" ? <span class="tag">from Etsy's bill</span> : <Est />}</>}
          v={`-${formatAud(m.feesCents)}`}
        />
        {m.feeBreakdown.map((f) => (
          <KV key={f.label} cls="sub" k={f.label} v={formatAud(f.cents)} />
        ))}
        <KV k={<>Ads {adsTag}</>} v={`-${formatAud(m.adsCents)}`} />
        <KV k={<>Other costs <span class="tag">typed in</span></>} v={`-${formatAud(m.costsCents)}`} />
        {m.refundsCents > 0 && <KV k="Refunds" v={`-${formatAud(m.refundsCents)}`} />}
        <KV cls="total" k="Net profit" v={<span class={m.profitCents < 0 ? "neg" : "pos"}>{formatAud(m.profitCents)}</span>} />
        <p class="muted small" style="margin-top:8px">
          {m.orders} orders, {m.items} items sold. Average profit per sale:{" "}
          <b>{m.avgProfitPerSaleCents === null ? "–" : formatAud(m.avgProfitPerSaleCents)}</b>.{" "}
          {m.salesBelowMinimum > 0 && (
            <span class="neg">
              {m.salesBelowMinimum} sale{m.salesBelowMinimum === 1 ? "" : "s"} earned less than your {formatAud(data.settings.minProfitCents)} minimum.
            </span>
          )}
        </p>
      </Card>

      <Card title="Not your money">
        <KV k="Tax collected (not mine)" v={formatAud(m.taxCollectedCents)} />
        {m.shippingCollectedCents > 0 && <KV k="Shipping collected" v={formatAud(m.shippingCollectedCents)} />}
        <p class="muted small" style="margin-top:8px">
          Etsy collects sales tax and VAT from buyers and pays it to governments. It is never counted as revenue here.
        </p>
      </Card>

      <Card title="List price vs price paid">
        {m.listValueCents === null ? (
          <p class="muted">No sales yet.</p>
        ) : (
          <>
            <KV k="If sold at list price" v={formatAud(m.listValueCents)} />
            <KV k="What buyers actually paid" v={formatAud(m.revenueCents)} />
            <KV cls="total" k="Average discount" v={m.avgDiscountPct === null ? "–" : `${pct(m.avgDiscountPct, 0)} off`} />
          </>
        )}
      </Card>

      <Card title="Break-even">
        {m.avgContributionCents === null ? (
          <p class="muted">No sales yet, so there is nothing to work out.</p>
        ) : m.avgContributionCents <= 0 ? (
          <p class="neg">Each sale earns {formatAud(m.avgContributionCents)} after Etsy fees. At this price you cannot cover your ads and costs. Raise the price.</p>
        ) : (
          <>
            <p>
              You have spent <b>{formatAud(m.fixedSpendCents)}</b> on ads and other costs. Each sale brings in about{" "}
              <b>{formatAud(m.avgContributionCents)}</b> after Etsy fees.
            </p>
            <p style="margin:8px 0">
              You need <b>{m.salesToBreakEven}</b> sale{m.salesToBreakEven === 1 ? "" : "s"} to cover that. You have <b>{m.items}</b>.
            </p>
            <div class="progress" role="img" aria-label={`${progress}% of the way to break-even`}>
              <div style={`width:${progress}%`} />
            </div>
            <p class="muted small" style="margin-top:8px">
              {m.items >= (m.salesToBreakEven ?? 0) ? "Ads and costs are covered. Every extra sale is profit." : "Until then, the shop is running at a loss."}
            </p>
          </>
        )}
      </Card>

      <Card title="Profit per sale, by listing">
        {data.listings.map((l) => (
          <div key={l.listingId} style="padding:10px 0;border-top:1px solid var(--line)">
            <div style="font-weight:700">{l.title}</div>
            {l.sales === 0 ? (
              <div class="muted small">No sales yet. Break-even price {formatAud(l.breakEvenPriceCents)}.</div>
            ) : (
              <div class="stats" style="margin-top:6px">
                <div class="stat"><div class="s-label">Sales</div><div class="s-value">{l.sales}</div></div>
                <div class="stat"><div class="s-label">Avg paid</div><div class="s-value">{formatAud(l.avgPaidCents ?? 0)}</div></div>
                <div class="stat">
                  <div class="s-label">Profit / sale</div>
                  <div class={`s-value ${(l.avgProfitCents ?? 0) < data.settings.minProfitCents ? "neg" : ""}`}>{formatAud(l.avgProfitCents ?? 0)}</div>
                </div>
                <div class="stat"><div class="s-label">Break-even</div><div class="s-value">{formatAud(l.breakEvenPriceCents)}</div></div>
              </div>
            )}
          </div>
        ))}
        <p class="muted small" style="margin-top:8px">
          Profit per sale = price paid − Etsy fees − an equal share of ads and other costs. <Est /> The Sales screen shows it for every single sale.
        </p>
      </Card>

      <Card title="Probable ad fees">
        {m.probableAdFees.length === 0 ? (
          <p class="muted">No lines that look like Etsy Ads were found in Etsy's bill. If you run ads, type the weekly spend into Manual entries.</p>
        ) : (
          <>
            <p class="muted small" style="margin-bottom:6px">
              These lines in Etsy's bill look like ad charges. This is a best guess from their names, not a certainty.
            </p>
            {m.probableAdFees.slice(0, 15).map((f, i) => (
              <KV key={i} cls="sub" k={`${shortDay(f.day)} · ${f.description}`} v={formatAud(f.cents)} />
            ))}
            {m.probableAdFees.length > 15 && <p class="muted small">…and {m.probableAdFees.length - 15} more.</p>}
          </>
        )}
      </Card>

      {m.otherLedgerLines.length > 0 && (
        <Card title="Bill lines we could not sort">
          <p class="muted small" style="margin-bottom:6px">These are not counted in fees or profit. Check them on Etsy.</p>
          {m.otherLedgerLines.slice(0, 15).map((f, i) => (
            <KV key={i} cls="sub" k={`${shortDay(f.day)} · ${f.description}`} v={formatAud(f.cents)} />
          ))}
        </Card>
      )}
    </>
  );
}
