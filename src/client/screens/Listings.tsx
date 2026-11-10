// Screen 3: Listings. Each listing with its numbers and one clear status label.
import { formatAud } from "../../shared/money";
import type { DashboardData, ListingRow } from "../../shared/types";
import { Est, Missing, StatusPill, pct } from "../components";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div class="stat">
      <div class="s-label">{label}</div>
      <div class="s-value">{value}</div>
    </div>
  );
}

function ListingCard({ l }: { l: ListingRow }) {
  return (
    <section class="card">
      <h3 style="margin-bottom:8px">{l.title}</h3>
      <StatusPill status={l.status} />
      <p class="small muted" style="margin-top:8px">{l.statusWhy}</p>

      <div class="stats">
        <Stat label="Views" value={l.views} />
        <Stat label="Favourites" value={l.favorites} />
        <Stat label="Sales" value={l.sales} />
        <Stat label="Views → sales" value={pct(l.viewsToSalesPct)} />
        <Stat label="List price" value={formatAud(l.priceCents)} />
        <Stat label="Avg paid" value={l.avgPaidCents === null ? "–" : formatAud(l.avgPaidCents)} />
        <Stat label="Discount" value={l.avgDiscountPct === null ? "–" : `${pct(l.avgDiscountPct, 0)} off`} />
        <Stat label="Profit / sale" value={l.avgProfitCents === null ? "–" : formatAud(l.avgProfitCents)} />
      </div>

      <hr />
      <div class="small muted stack" style="gap:4px">
        <div>
          Views in the last 7 days: {l.views7d === null ? <Missing label="not enough history" /> : <b>{l.views7d}</b>}
        </div>
        <div>
          Tags used: <b>{l.tags.length}</b> of 13 · Listed {l.ageDays} days ago
        </div>
        <div>
          Break-even price: <b>{formatAud(l.breakEvenPriceCents)}</b> · To earn your minimum: <b>{formatAud(l.minProfitPriceCents)}</b> <Est />
        </div>
      </div>
      {l.url && (
        <a class="btn smallbtn" style="margin-top:12px" href={l.url} target="_blank" rel="noopener noreferrer">
          Open on Etsy
        </a>
      )}
    </section>
  );
}

export function Listings({ data }: { data: DashboardData }) {
  if (data.listings.length === 0) {
    return (
      <section class="card">
        <p class="muted center">No active listings found.</p>
      </section>
    );
  }
  return (
    <>
      <p class="muted small">
        Views and favourites are totals since each listing went live. "Views → sales" is sales divided by listing views (Etsy does not share real visits).
      </p>
      {data.listings.map((l) => (
        <ListingCard key={l.listingId} l={l} />
      ))}
    </>
  );
}
