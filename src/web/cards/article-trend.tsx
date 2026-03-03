export function ArticleTrendCard({ data, slug }: {
  data: { title: string; weeks: { week_start: string; readers: number }[] };
  slug: string;
}) {
  const maxReaders = Math.max(...data.weeks.map((w) => w.readers), 1);
  const totalReaders = data.weeks.reduce((s, w) => s + w.readers, 0);

  return (
    <div>
      <div class="card">
        <div class="flex items-center gap-xs mb-sm">
          <span
            class="text-sm card-clickable"
            style="color: var(--color-accent)"
            hx-get="/analytics/articles"
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            Articles
          </span>
          <span class="text-xs text-muted">/</span>
          <span
            class="text-sm card-clickable"
            style="color: var(--color-accent)"
            hx-get={`/articles/${encodeURIComponent(slug)}/readers`}
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            Readers
          </span>
          <span class="text-xs text-muted">/</span>
          <span class="text-sm text-secondary">Trend</span>
        </div>
        <div class="card-title">{data.title}</div>
        <div class="text-sm text-muted mt-sm">{totalReaders} total readers across {data.weeks.length} weeks</div>
      </div>

      {data.weeks.length > 0 ? (
        <div class="card">
          <div class="card-label mb-xs">Weekly Readers</div>
          {data.weeks.map((w) => {
            const barWidth = Math.max((w.readers / maxReaders) * 100, 2);
            const weekLabel = new Date(w.week_start).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            return (
              <div class="table-row">
                <div class="font-mono text-xs text-muted" style="width: 4.5rem; flex-shrink: 0">
                  {weekLabel}
                </div>
                <div class="flex-1">
                  <div style={`height: 18px; border-radius: 3px; overflow: hidden; background: var(--color-surface-elevated)`}>
                    <div
                      style={`width: ${barWidth}%; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--visma-turquoise), var(--visma-lime))`}
                    ></div>
                  </div>
                </div>
                <div class="font-mono text-xs" style="width: 2.5rem; text-align: right; color: var(--visma-turquoise)">
                  {w.readers}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div class="empty-state">
          <div class="empty-state-icon">&#9671;</div>
          <div>No reader data available for this article.</div>
        </div>
      )}
    </div>
  );
}
