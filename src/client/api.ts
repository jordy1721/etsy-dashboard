// Talks to the Worker. If the session has expired, send the user to the passcode screen.
import type { DashboardData } from "../shared/types";

export async function api<T>(path: string, options: { method?: string; json?: unknown; text?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.text !== undefined) {
    headers["content-type"] = "text/csv";
    body = options.text;
  }

  let res: Response;
  try {
    res = await fetch(path, { method: options.method ?? (body === undefined ? "GET" : "POST"), headers, body, credentials: "same-origin" });
  } catch {
    throw new Error("No connection. Check your internet and try again.");
  }
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Please log in again.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Not JSON. Handled below.
  }
  if (!res.ok) {
    const message = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `Something went wrong (${res.status}).`;
    // Refresh errors come back as { ok: false, message }.
    const alt = data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : null;
    throw new Error(alt ?? message);
  }
  return data as T;
}

export function loadDashboard(): Promise<DashboardData> {
  return api<DashboardData>("/api/dashboard");
}

/** What the server answers after reading an uploaded CSV file. */
export interface CsvUploadResult {
  kind: "ads" | "stats";
  columnsUsed: string[];
  skippedRows: number;
  from?: string;
  to?: string;
  days?: number;
  weeks?: number;
  listingRows?: number;
  unmatchedListings?: string[];
  usedChosenWeek?: boolean;
}

/** Send a CSV file's text to the server. `week` is only used for an ads file that has no dates. */
export function uploadCsv(path: "/api/ads-csv" | "/api/stats-csv", text: string, week?: string): Promise<CsvUploadResult> {
  return api<CsvUploadResult>(week ? `${path}?week=${week}` : path, { text });
}
