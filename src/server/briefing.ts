// ---------------------------------------------------------------------------
// OPTIONAL: weekly "Claude briefing"
// Only runs if an ANTHROPIC_API_KEY secret exists. It runs inside the daily
// background job, never while a page is loading, so it can never slow down or
// break the dashboard. If anything goes wrong it quietly does nothing.
// Only shop numbers are sent (no buyer details exist in this app at all).
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { formatAud } from "../shared/money";
import type { Briefing, DashboardData } from "../shared/types";
import { setMeta } from "./db";
import type { Env } from "./env";

const WEEK_SECONDS = 7 * 86_400;

/** The numbers we hand to Claude, as short plain text. */
export function briefingFacts(d: DashboardData): string {
  const lines: string[] = [
    `Shop: ${d.shop?.shopName ?? "Etsy shop"} (digital downloads, AUD). Data is ${d.status.dataMode === "sample" ? "SAMPLE data, not real" : "real"}.`,
    `Last 7 days: revenue ${formatAud(d.thisWeek.revenueCents)}, ${d.thisWeek.orders} orders, net profit ${formatAud(d.thisWeek.profitCents)}, spend ${formatAud(d.thisWeek.spendCents)}.`,
    `7 days before: revenue ${formatAud(d.lastWeek.revenueCents)}, ${d.lastWeek.orders} orders, net profit ${formatAud(d.lastWeek.profitCents)}.`,
    `All time: revenue ${formatAud(d.money.revenueCents)}, Etsy fees ${formatAud(d.money.feesCents)} (${d.money.feesSource}), ads ${formatAud(d.money.adsCents)} (${d.money.adsSource}), other costs ${formatAud(d.money.costsCents)}, net profit ${formatAud(d.money.profitCents)}.`,
    `Average discount ${d.money.avgDiscountPct ?? "unknown"}%. ${d.money.salesBelowMinimum} of ${d.sales.length} sales earned under the ${formatAud(d.settings.minProfitCents)} minimum. Reviews: ${d.reviewCount}.`,
    "Listings:",
    ...d.listings.map(
      (l) =>
        `- ${l.title}: ${l.views} views, ${l.sales} sales, list ${formatAud(l.priceCents)}, avg paid ${l.avgPaidCents === null ? "n/a" : formatAud(l.avgPaidCents)}, avg profit ${l.avgProfitCents === null ? "n/a" : formatAud(l.avgProfitCents)}, status "${l.status}".`,
    ),
    "Rule-based to-do list (most important first):",
    ...d.suggestions.slice(0, 6).map((s) => `- ${s.title} (${s.numbers})`),
    "Known gaps:",
    ...d.dataNotes.map((n) => `- ${n}`),
  ];
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You write a short weekly briefing for the owner of a small Etsy shop. He is 18, a beginner, and reads this on his phone.
Rules:
- Plain, simple English. Short sentences. No jargon, no hype, no emojis.
- Tell him what he needs to hear, not what he wants to hear. Focus on profit, not revenue.
- Use only the numbers given. Never invent a number. If data is missing or estimated, say so.
- At most 150 words. Plain text only, no markdown.
- Structure: one line on how the week went, two or three lines on what the numbers mean, then "This week:" with the single most useful action.`;

/** Has enough time passed since the last briefing? */
export function briefingIsDue(existing: Briefing | null, now: number): boolean {
  return !existing || now - existing.createdAt >= WEEK_SECONDS;
}

/** Write a new briefing if a key exists and the last one is over a week old. Never throws. */
export async function maybeWriteBriefing(env: Env, data: DashboardData, now: number): Promise<void> {
  try {
    if (!env.ANTHROPIC_API_KEY || !briefingIsDue(data.briefing, now)) return;

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 1 });
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // If the model declines, let the API retry on a fallback model by itself.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Here are this week's numbers.\n\n${briefingFacts(data)}` }],
    });
    if (response.stop_reason === "refusal") return;

    let text = "";
    for (const block of response.content) if (block.type === "text") text += block.text;
    text = text.trim();
    if (text === "") return;

    const briefing: Briefing = { text: text.slice(0, 2000), createdAt: now };
    await setMeta(env.DB, { briefing: JSON.stringify(briefing) });
  } catch (err) {
    console.log("Claude briefing skipped:", err instanceof Error ? err.message : String(err));
  }
}
