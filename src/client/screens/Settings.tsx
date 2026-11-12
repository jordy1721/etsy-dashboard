// Screen 7: Manual entries and Settings.
// Etsy's API does not share ad spend, visits or traffic sources, so they are typed in here.
import { useEffect, useState } from "preact/hooks";
import { addDays, shortDay, weekStart } from "../../shared/dates";
import { formatAud } from "../../shared/money";
import type { DashboardData, WeeklyManual } from "../../shared/types";
import { api } from "../api";
import { Card, KV, Message, timeAgo } from "../components";

type Msg = { ok: boolean; text: string } | null;
const errText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
/** 1250 -> "12.50" for putting an amount back into a text box. */
const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
const numText = (n: number | null) => (n === null ? "" : String(n));

// ---- Data status, Etsy connection and Refresh now ---------------------------
function StatusCard({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const st = data.status;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [wait, setWait] = useState(st.refreshWaitSeconds);

  // Count the 10 minute wait down on screen.
  useEffect(() => setWait(st.refreshWaitSeconds), [st.refreshWaitSeconds, data.generatedAt]);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(timer);
  }, [wait > 0]);

  const refresh = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ ok: boolean; message: string }>("/api/refresh", { method: "POST" });
      setMsg({ ok: true, text: res.message });
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
    await reload();
    setBusy(false);
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Etsy? The daily updates will stop until you connect again. Your saved data stays.")) return;
    try {
      await api("/api/etsy/disconnect", { method: "POST" });
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
  };

  const now = Math.floor(Date.now() / 1000);
  return (
    <Card title="Data">
      <KV k="Showing" v={st.dataMode === "sample" ? <span class="tag warn">SAMPLE DATA</span> : <span class="tag good">✓ Real shop data</span>} />
      <KV k="Etsy" v={st.etsyConnected ? <span class="tag good">✓ Connected</span> : <span class="tag missing">Not connected</span>} />
      <KV k="Data last updated" v={st.lastSyncAt === null ? "never" : timeAgo(st.lastSyncAt, now)} />
      <KV k="Days of history saved" v={`${st.snapshotDays}${st.firstSnapshotDay ? ` (since ${shortDay(st.firstSnapshotDay)})` : ""}`} />
      {st.lastSyncMessage && (
        <p class={`small ${st.lastSyncOk ? "muted" : "neg"}`} style="margin-top:8px">
          Last update: {st.lastSyncOk ? "worked." : "FAILED."} {st.lastSyncMessage}
        </p>
      )}

      <div class="stack" style="margin-top:12px">
        {!st.etsyConnected &&
          (st.etsyConfigured ? (
            <a class="btn primary block" href="/auth/start">
              Connect Etsy
            </a>
          ) : (
            <p class="msg err">
              Etsy key not set yet. Add the ETSY_KEYSTRING and ETSY_SHARED_SECRET secrets in Cloudflare (SETUP.md, step 4), then come back here.
            </p>
          ))}
        {st.etsyConnected && (
          <>
            <button class="btn primary block" disabled={busy || wait > 0} onClick={() => void refresh()}>
              {busy ? "Refreshing…" : wait > 0 ? `Refresh again in ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}` : "Refresh now"}
            </button>
            <p class="muted small">Updates by itself once a day. You can also refresh by hand once every 10 minutes.</p>
            <button class="btn danger smallbtn" onClick={() => void disconnect()}>
              Disconnect Etsy
            </button>
          </>
        )}
        <Message msg={msg} />
      </div>
    </Card>
  );
}

// ---- Weekly numbers: ads spend, visits, traffic sources ---------------------
const EMPTY_WEEK = { visits: "", srcSearch: "", srcAds: "", srcEtsyOther: "", srcSocial: "", srcDirect: "" };

function WeeklyCard({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const thisMonday = weekStart(data.today);
  // The last 8 weeks to choose from, newest first.
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisMonday, -7 * i));
  const [week, setWeek] = useState(weeks[1] ?? thisMonday);
  const [form, setForm] = useState(EMPTY_WEEK);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  // When a week is picked, load what is already saved for it.
  const fill = (ws: string) => {
    const row = data.weekly.find((w) => w.weekStart === ws);
    setForm(
      row
        ? {
            visits: numText(row.visits),
            srcSearch: numText(row.srcSearch),
            srcAds: numText(row.srcAds),
            srcEtsyOther: numText(row.srcEtsyOther),
            srcSocial: numText(row.srcSocial),
            srcDirect: numText(row.srcDirect),
          }
        : EMPTY_WEEK,
    );
  };
  useEffect(() => fill(week), [week, data.generatedAt]);

  const set = (key: keyof typeof EMPTY_WEEK) => (e: { currentTarget: HTMLInputElement }) => setForm({ ...form, [key]: e.currentTarget.value });
  const weekLabel = (ws: string) => `${shortDay(ws)} – ${shortDay(addDays(ws, 6))}${ws === thisMonday ? " (this week)" : ""}`;

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/weekly", { json: { weekStart: week, ...form } });
      setMsg({ ok: true, text: `Saved the week of ${shortDay(week)}.` });
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
    setBusy(false);
  };

  const remove = async (w: WeeklyManual) => {
    if (!confirm(`Delete the visit numbers for the week of ${shortDay(w.weekStart)}?`)) return;
    try {
      await api(`/api/weekly/${w.weekStart}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
  };

  const saved = [...data.weekly].filter((w) => w.visits !== null || w.srcSearch !== null || w.srcAds !== null || w.srcEtsyOther !== null || w.srcSocial !== null || w.srcDirect !== null).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  return (
    <Card title="Weekly numbers">
      <p class="muted small" style="margin-bottom:10px">
        Read these off Etsy &gt; Shop Manager &gt; Stats. Leave a box empty if you do not know it. Ad spend and ad results are typed in on the Ads screen.
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
        <label class="field">
          Shop visits
          <input type="text" inputMode="numeric" placeholder="0" value={form.visits} onInput={set("visits")} />
        </label>
        <details>
          <summary>Where visits came from (optional)</summary>
          <div class="grid2" style="margin-top:6px">
            <label class="field">Etsy search<input type="text" inputMode="numeric" value={form.srcSearch} onInput={set("srcSearch")} /></label>
            <label class="field">Etsy Ads<input type="text" inputMode="numeric" value={form.srcAds} onInput={set("srcAds")} /></label>
            <label class="field">Other Etsy pages<input type="text" inputMode="numeric" value={form.srcEtsyOther} onInput={set("srcEtsyOther")} /></label>
            <label class="field">Social media<input type="text" inputMode="numeric" value={form.srcSocial} onInput={set("srcSocial")} /></label>
            <label class="field">Direct and other<input type="text" inputMode="numeric" value={form.srcDirect} onInput={set("srcDirect")} /></label>
          </div>
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
                  Visits {w.visits ?? "–"}
                </div>
              </button>
              <button class="btn danger smallbtn" aria-label={`Delete week of ${shortDay(w.weekStart)}`} onClick={() => void remove(w)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {data.trafficSources && (
        <div style="margin-top:14px">
          <h3 style="margin-bottom:4px">Traffic sources, week of {shortDay(data.trafficSources.weekStart)}</h3>
          {data.trafficSources.sources.map((s) => (
            <KV key={s.label} cls="sub" k={s.label} v={`${s.visits} visits`} />
          ))}
        </div>
      )}
    </Card>
  );
}

// ---- Costs -------------------------------------------------------------------
function CostsCard({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const [form, setForm] = useState({ day: data.today, kind: "tool", label: "", amount: "" });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/costs", { json: form });
      setMsg({ ok: true, text: "Cost added." });
      setForm({ ...form, label: "", amount: "" });
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
    setBusy(false);
  };

  const remove = async (id: number, label: string) => {
    if (!confirm(`Delete "${label}"?`)) return;
    try {
      await api(`/api/costs/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
  };

  const kindName: Record<string, string> = { product: "Product cost", tool: "Tool", other: "Other" };
  return (
    <Card title="Costs">
      <p class="muted small" style="margin-bottom:10px">
        Anything you paid to run the shop: tools, subscriptions, assets you bought. These come off your profit.
      </p>
      <form class="stack" onSubmit={(e) => void save(e)}>
        <div class="grid2">
          <label class="field">
            Date
            <input type="date" value={form.day} max={data.today} onInput={(e) => setForm({ ...form, day: e.currentTarget.value })} />
          </label>
          <label class="field">
            Type
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.currentTarget.value })}>
              <option value="tool">Tool</option>
              <option value="product">Product cost</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>
        <div class="grid2">
          <label class="field">
            What was it?
            <input type="text" maxLength={80} placeholder="e.g. Canva" value={form.label} onInput={(e) => setForm({ ...form, label: e.currentTarget.value })} />
          </label>
          <label class="field">
            Amount (A$)
            <input type="text" inputMode="decimal" placeholder="0.00" value={form.amount} onInput={(e) => setForm({ ...form, amount: e.currentTarget.value })} />
          </label>
        </div>
        <button class="btn primary block" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Add cost"}
        </button>
        <Message msg={msg} />
      </form>
      {data.costs.length > 0 && (
        <div style="margin-top:14px">
          {data.costs.map((c) => (
            <div key={c.id} class="row between" style="padding:8px 0;border-top:1px solid var(--line)">
              <div class="grow">
                <div style="font-weight:600">{c.label}</div>
                <div class="muted small">
                  {shortDay(c.day)} · {kindName[c.kind] ?? c.kind} · {formatAud(c.amountCents)}
                </div>
              </div>
              <button class="btn danger smallbtn" aria-label={`Delete ${c.label}`} onClick={() => void remove(c.id, c.label)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---- Minimum profit and fee settings -----------------------------------------
function ProfitSettingsCard({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const s = data.settings;
  const initial = {
    minProfit: dollars(s.minProfitCents),
    transactionFeePct: String(s.transactionFeePct),
    processingPct: String(s.processingPct),
    processingFixed: dollars(s.processingFixedCents),
    listingFee: dollars(s.listingFeeCents),
    feeTaxPct: String(s.feeTaxPct),
    reviewAfterSales: String(s.reviewAfterSales),
  };
  const [form, setForm] = useState(initial);
  const [msg, setMsg] = useState<Msg>(null);
  const set = (key: keyof typeof initial) => (e: { currentTarget: HTMLInputElement }) => setForm({ ...form, [key]: e.currentTarget.value });

  const save = async (e: Event) => {
    e.preventDefault();
    try {
      await api("/api/settings", { json: form });
      setMsg({ ok: true, text: "Saved." });
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
  };

  return (
    <Card title="Profit settings">
      <form class="stack" onSubmit={(e) => void save(e)}>
        <label class="field">
          Minimum profit per sale (A$)
          <input type="text" inputMode="decimal" value={form.minProfit} onInput={set("minProfit")} />
        </label>
        <p class="muted small">Any sale that earns less than this gets flagged.</p>
        <label class="field">
          Suggest asking for reviews after this many sales
          <input type="text" inputMode="numeric" value={form.reviewAfterSales} onInput={set("reviewAfterSales")} />
        </label>
        <details>
          <summary>Etsy fee rates (advanced)</summary>
          <p class="muted small" style="margin-bottom:8px">
            Only used to estimate fees when Etsy's bill does not show them. The defaults are Etsy's usual rates for Australian sellers. Check Etsy's fee page if unsure.
          </p>
          <div class="grid2">
            <label class="field">Transaction fee %<input type="text" inputMode="decimal" value={form.transactionFeePct} onInput={set("transactionFeePct")} /></label>
            <label class="field">Processing fee %<input type="text" inputMode="decimal" value={form.processingPct} onInput={set("processingPct")} /></label>
            <label class="field">Processing fixed (A$)<input type="text" inputMode="decimal" value={form.processingFixed} onInput={set("processingFixed")} /></label>
            <label class="field">Listing fee per sale (A$)<input type="text" inputMode="decimal" value={form.listingFee} onInput={set("listingFee")} /></label>
            <label class="field">GST on Etsy fees %<input type="text" inputMode="decimal" value={form.feeTaxPct} onInput={set("feeTaxPct")} /></label>
          </div>
        </details>
        <button class="btn primary block" type="submit">Save settings</button>
        <Message msg={msg} />
      </form>
    </Card>
  );
}

// ---- Etsy Stats CSV upload -----------------------------------------------------
function CsvCard({ reload }: { reload: () => Promise<void> }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (e: { currentTarget: HTMLInputElement }) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const res = await api<{ days: number; from: string; to: string; columnsUsed: string[]; skippedRows: number }>("/api/stats-csv", { text });
      setMsg({
        ok: true,
        text: `Read ${res.days} days (${shortDay(res.from)} to ${shortDay(res.to)}) using columns: ${res.columnsUsed.join(", ")}.${res.skippedRows > 0 ? ` Skipped ${res.skippedRows} rows without a date.` : ""}`,
      });
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
    input.value = ""; // allow choosing the same file again
    setBusy(false);
  };

  return (
    <Card title="Upload Etsy Stats CSV">
      <p class="muted small" style="margin-bottom:10px">
        On Etsy's Stats page, download the CSV, then choose it here. It needs a Date column and at least one of Visits, Views, Orders or Revenue. Daily visits from the file replace the weekly numbers for those days.
      </p>
      <input type="file" accept=".csv,text/csv" aria-label="Choose Etsy Stats CSV file" disabled={busy} onChange={(e) => void upload(e)} />
      {busy && <p class="muted small">Reading file…</p>}
      <div style="margin-top:10px">
        <Message msg={msg} />
      </div>
    </Card>
  );
}

export function Settings({ data, reload }: { data: DashboardData; reload: () => Promise<void> }) {
  const logout = async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };
  return (
    <>
      <div class="masonry">
      <StatusCard data={data} reload={reload} />
      <WeeklyCard data={data} reload={reload} />
      <CostsCard data={data} reload={reload} />
      <ProfitSettingsCard data={data} reload={reload} />
      <CsvCard reload={reload} />
      </div>
      <button class="btn block narrow" onClick={() => void logout()}>
        Lock dashboard (log out)
      </button>
    </>
  );
}
