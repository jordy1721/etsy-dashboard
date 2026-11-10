// ---------------------------------------------------------------------------
// The app frame: header, SAMPLE banner, the current screen, bottom tab bar.
// It loads all the numbers once, then each screen just shows them.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "preact/hooks";
import type { DashboardData } from "../shared/types";
import { loadDashboard } from "./api";
import { timeAgo } from "./components";
import { Fix } from "./screens/Fix";
import { Listings } from "./screens/Listings";
import { Money } from "./screens/Money";
import { NextSteps } from "./screens/NextSteps";
import { Overview } from "./screens/Overview";
import { Sales } from "./screens/Sales";
import { Settings } from "./screens/Settings";

export type Tab = "home" | "sales" | "listings" | "money" | "fix" | "next" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Today", icon: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
  { id: "sales", label: "Sales", icon: "M6 7h12l-1 13H7zM9 7a3 3 0 0 1 6 0" },
  { id: "listings", label: "Listings", icon: "M4 6h16M4 12h16M4 18h16" },
  { id: "money", label: "Money", icon: "M12 3v18M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.5 0-4.2 1.200-4.200 3 0 4.500 9.400 2 9.400 6.500 0 1.900-2 3.200-4.700 3.200-2.300 0-4.200-.9-5-2.400" },
  { id: "fix", label: "Fix", icon: "M14.500 5.500a4.500 4.500 0 0 0-5.800 5.800L3 17v4h4l5.700-5.700a4.500 4.500 0 0 0 5.800-5.800l-3 3-2.500-.500-.500-2.500z" },
  { id: "next", label: "Next", icon: "M5 12h14M13 6l6 6-6 6" },
];

function Icon({ path }: { path: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const GEAR =
  "M12 15.500a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM19.400 13.500a7.600 7.600 0 0 0 0-3l2-1.500-2-3.500-2.400 1a7.600 7.600 0 0 0-2.600-1.500L14 2.500h-4l-.400 2.500a7.600 7.600 0 0 0-2.600 1.500l-2.400-1-2 3.500 2 1.500a7.600 7.600 0 0 0 0 3l-2 1.500 2 3.500 2.400-1a7.600 7.600 0 0 0 2.600 1.500l.400 2.500h4l.400-2.500a7.600 7.600 0 0 0 2.600-1.500l2.400 1 2-3.500z";

export function App() {
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
      <div class="app">
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
    );
  }

  const updated =
    data.status.dataMode === "sample" ? "Sample data" : `Updated ${timeAgo(data.status.lastSyncAt, Math.floor(Date.now() / 1000))}`;
  const titles: Record<Tab, string> = {
    home: data.shop?.shopName ?? "My shop",
    sales: "Sales",
    listings: "Listings",
    money: "Money",
    fix: "What to fix",
    next: "Next steps",
    settings: "Entries and settings",
  };

  return (
    <div class="app">
      <header class="header">
        <h1>
          {titles[tab]}
          <span class="sub">{updated}</span>
        </h1>
        <button class={`icon-btn ${tab === "settings" ? "active" : ""}`} aria-label="Manual entries and settings" onClick={() => go("settings")}>
          <Icon path={GEAR} />
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

      <nav class="nav" aria-label="Screens">
        <div class="nav-inner">
          {TABS.map((t) => (
            <button key={t.id} class={tab === t.id ? "active" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
              <Icon path={t.icon} />
              {t.label}
              {t.id === "fix" && data.suggestions.length > 0 && <span class="badge">{data.suggestions.length}</span>}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
