export function relativeDate(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "—";
  const diff = Date.now() - then;
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function sectionBadge(section: string | null) {
  if (!section) return null;
  const cls = section === "learn" ? "badge-lime" : section === "blog" ? "badge-turquoise" : "badge-green";
  return <span class={`badge ${cls}`}>{section}</span>;
}

export type Period = "7d" | "30d" | "90d" | "all";

const periodLabels: Record<Period, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", "all": "All time" };

export function PeriodToggle({ current, basePath }: { current: Period; basePath: string }) {
  const periods: Period[] = ["7d", "30d", "90d", "all"];
  return (
    <div class="flex gap-xs" style="margin-bottom: var(--space-sm)">
      {periods.map((p) => (
        <button
          class={`period-btn ${p === current ? "period-btn-active" : ""}`}
          hx-get={`${basePath}?period=${p}`}
          hx-target="#canvas"
          hx-swap="innerHTML"
        >
          {periodLabels[p]}
        </button>
      ))}
    </div>
  );
}

/** Convert period string to DuckDB INTERVAL clause fragment, or empty string for "all" */
export function periodToDays(period: Period): number | null {
  if (period === "7d") return 7;
  if (period === "30d") return 30;
  if (period === "90d") return 90;
  return null;
}
