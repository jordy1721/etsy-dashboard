// Screen 6: Next steps. The 3 most valuable actions this week.
import type { DashboardData } from "../../shared/types";
import type { Tab } from "../app";
import { ActionCard } from "../components";

export function NextSteps({ data, go }: { data: DashboardData; go: (tab: Tab) => void }) {
  if (data.nextSteps.length === 0) {
    return (
      <section class="card">
        <p class="muted center">No actions this week. Keep going.</p>
      </section>
    );
  }
  return (
    <>
      <p class="muted small">Do these {data.nextSteps.length} things this week, in this order. One at a time.</p>
      <div class="grid-3">
        {data.nextSteps.map((s, i) => (
          <ActionCard key={s.id} item={s} rank={i + 1} open />
        ))}
      </div>
      {data.suggestions.length > data.nextSteps.length && (
        <button class="btn block narrow" onClick={() => go("fix")}>
          See all {data.suggestions.length} things to fix
        </button>
      )}
    </>
  );
}
