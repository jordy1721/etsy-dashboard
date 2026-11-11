// ---------------------------------------------------------------------------
// The app frame.
//   iPhone:  header on top, the current screen, tab bar at the bottom.
//   Desktop: sidebar on the left, a big page heading, cards side by side.
// It loads all the numbers once, then each screen just shows them.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "preact/hooks";
import type { DashboardData } from "../shared/types";
import { loadDashboard } from "./api";
import { Enso, ICONS, Icon, timeAgo } from "./components";
import { useDevice, useTheme } from "./device";
import { Scenery } from "./Scenery";
import { Fix } from "./screens/Fix";
import { Listings } from "./screens/Listings";
import { Money } from "./screens/Money";
import { NextSteps } from "./screens/NextSteps";
import { Overview } from "./screens/Overview";
import { Sales } from "./screens/Sales";
import { Settings } from "./screens/Settings";

export type Tab = "home" | "sales" | "listings" | "money" | "fix" | "next" | "settings";

/** The screens, in menu order. `short` is the label under the phone's tab bar icons. */
const TABS: { id: Tab; label: string; short: string; icon: string }[] = [
  { id: "home", label: "Dashboard", short: "Today", icon: ICONS.home },
  { id: "sales", label: "Sales", short: "Sales", icon: ICONS.sales },
  { id: "listings", label: "Listings", short: "Listings", icon: ICONS.listings },
  { id: "money", label: "Money", short: "Money", icon: ICONS.money },
  { id: "fix", label: "What to fix", short: "Fix", icon: ICONS.fix },
  { id: "next", label: "Next steps", short: "Next", icon: ICONS.next },
];

/** Heading text for each screen: small label, big title, one-line description. */
const HEADINGS: Record<Tab, { eyebrow: string; title: string; lede: string }> = {
  home: { eyebrow: "Shop overview", title: "Welcome back.", lede: "Here's how your shop is performing." },
  sales: { eyebrow: "Orders", title: "Sales", lede: "Every sale, with what you really kept." },
  listings: { eyebrow: "Products", title: "Listings", lede: "What is working, and what is not." },
  money: { eyebrow: "Profit", title: "Money", lede: "Where the money comes from, and where it goes." },
  fix: { eyebrow: "To do", title: "What to fix", lede: "Ranked, most important first." },
  next: { eyebrow: "This week", title: "Next steps", lede: "The three most valuable things to do." },
  settings: { eyebrow: "Your numbers", title: "Entries and settings", lede: "Type in what Etsy does not share." },
};

export function App() {
  const device = useDevice();
  const [theme, toggleTheme] = useTheme();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");

  const reload = useCallback(async () => {
    try {
      setData(await loadDashboard());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the dashboard.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Go back to the top when switching screens.
  const go = (next: Tab) => {
    setTab(next);
    window.scrollTo(0, 0);
  };

  if (!data) {
    return (
      <>
        <Scenery />
        <div class="app" style="display:block">
          <div class="loading">
            {error ? (
              <div class="stack" style="align-items:center">
                <p>{error}</p>
                <button class="btn primary" onClick={() => void reload()}>
                  Try again
                </button>
              </div>
            ) : (
              "Loading your shop…"
            )}
          </div>
        </div>
      </>
    );
  }

  const updated =
    data.status.dataMode === "sample" ? "Sample data" : `Updated ${timeAgo(data.status.lastSyncAt, Math.floor(Date.now() / 1000))}`;
  const heading = HEADINGS[tab];
  const shopName = data.shop?.shopName ?? "My shop";
  // On the phone the first screen is titled with the shop name; on desktop it greets you.
  const title = device === "phone" && tab === "home" ? shopName : heading.title;
  const themeLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <>
      <Scenery />
      <div class="app">
        {/* Desktop only: the menu on the left */}
        <aside class="sidebar">
          <div class="logo">
            <Enso />
          </div>
          {TABS.map((t) => (
            <button key={t.id} class={`item ${tab === t.id ? "active" : ""}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
              <Icon path={t.icon} />
              {t.label}
              {t.id === "fix" && data.suggestions.length > 0 && <span class="badge">{data.suggestions.length}</span>}
            </button>
          ))}
          <button class={`item ${tab === "settings" ? "active" : ""}`} aria-current={tab === "settings" ? "page" : undefined} onClick={() => go("settings")}>
            <Icon path={ICONS.gear} />
            Settings
          </button>
          <div class="spacer" />
          <div class="foot">
            <button class="icon-btn" aria-label={themeLabel} title={themeLabel} onClick={toggleTheme}>
              <Icon path={theme === "dark" ? ICONS.sun : ICONS.moon} />
            </button>
            <span class="muted small" style="text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{shopName}</span>
          </div>
        </aside>

        <div class="content">
          <header class="header">
            <div class="titles">
              <div class="eyebrow">{heading.eyebrow}</div>
              <h1>{title}</h1>
              <span class="sub">{updated}</span>
              <p class="lede muted">{heading.lede}</p>
            </div>
            <span class="updated desktop-only">{updated}</span>
            <button class="icon-btn phone-only" aria-label={themeLabel} onClick={toggleTheme}>
              <Icon path={theme === "dark" ? ICONS.sun : ICONS.moon} />
            </button>
            <button class={`icon-btn phone-only ${tab === "settings" ? "active" : ""}`} aria-label="Manual entries and settings" onClick={() => go("settings")}>
              <Icon path={ICONS.gear} />
            </button>
          </header>

          {data.status.dataMode === "sample" && (
            <div class="banner" role="status">
              SAMPLE DATA
              <small>These numbers are invented. Connect Etsy in Settings to see your real shop.</small>
            </div>
          )}

          <main class="main">
            {error && <div class="msg err">{error}</div>}
            {tab === "home" && <Overview data={data} go={go} />}
            {tab === "sales" && <Sales data={data} />}
            {tab === "listings" && <Listings data={data} />}
            {tab === "money" && <Money data={data} />}
            {tab === "fix" && <Fix data={data} />}
            {tab === "next" && <NextSteps data={data} go={go} />}
            {tab === "settings" && <Settings data={data} reload={reload} />}
          </main>
        </div>

        {/* Phone only: the tab bar at the bottom */}
        <nav class="nav" aria-label="Screens">
          <div class="nav-inner">
            {TABS.map((t) => (
              <button key={t.id} class={tab === t.id ? "active" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
                <span class="ico">
                  <Icon path={t.icon} size={20} />
                </span>
                {t.short}
                {t.id === "fix" && data.suggestions.length > 0 && <span class="badge">{data.suggestions.length}</span>}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </>
  );
}
