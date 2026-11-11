// Screen 5: What to fix. The full ranked to-do list from the suggestion rules.
import type { DashboardData } from "../../shared/types";
import { ActionCard } from "../components";

export function Fix({ data }: { data: DashboardData }) {
  if (data.suggestions.length === 0) {
    return (
      <section class="card">
        <p class="muted center">Nothing to fix right now.</p>
      </section>
    );
  }
  return (
    <>
      <p class="muted small">
        {data.suggestions.length} things to fix, most important first. Each one shows the numbers it is based on.
      </p>
      <div class="grid-2">
        {data.suggestions.map((s, i) => (
          <ActionCard key={s.id} item={s} rank={i + 1} open={i === 0} />
        ))}
      </div>
    </>
  );
}
