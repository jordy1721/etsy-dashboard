// ---------------------------------------------------------------------------
// DEVICE DETECTION
// Works out whether the app is open on a phone (iPhone) or a desktop, so each
// gets its own layout:
//   phone   -> one column, tab bar at the bottom, big touch targets
//   desktop -> sidebar on the left, cards side by side
// It also remembers the light / dark choice.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "preact/hooks";

export type Device = "phone" | "desktop";
export type Theme = "light" | "dark";

/** A screen at least this wide (in CSS pixels) gets the desktop layout. */
const DESKTOP_MIN_WIDTH = 900;

/** True on an iPhone (or iPod touch). */
export function isIphone(): boolean {
  return /iPhone|iPod/.test(navigator.userAgent);
}

/** True when opened from the Home Screen icon (no browser bars). */
export function isHomeScreenApp(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function detectDevice(): Device {
  // An iPhone always gets the phone layout, even turned sideways.
  if (isIphone()) return "phone";
  return window.innerWidth >= DESKTOP_MIN_WIDTH ? "desktop" : "phone";
}

/** Follows the window size, so resizing a desktop window switches layout live. */
export function useDevice(): Device {
  const [device, setDevice] = useState<Device>(detectDevice);
  useEffect(() => {
    const update = () => setDevice(detectDevice());
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  // Tell the stylesheet which layout to use: <html data-device="phone">.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.device = device;
    root.dataset.iphone = isIphone() ? "yes" : "no";
    root.dataset.standalone = isHomeScreenApp() ? "yes" : "no";
  }, [device]);
  return device;
}

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem("theme");
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null; // private browsing can block storage; just follow the system
  }
}

/** Light or dark. Follows the phone/computer setting until you tap the moon button. */
export function useTheme(): [Theme, () => void] {
  const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [theme, setTheme] = useState<Theme>(() => savedTheme() ?? (systemDark() ? "dark" : "light"));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Colour of the iPhone status bar area.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#1b1613" : "#f3e9dc");
  }, [theme]);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Not saved. It still changes for this visit.
    }
  };
  return [theme, toggle];
}
