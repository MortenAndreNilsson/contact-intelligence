export function CompanyTimelineCard({ data, companyId }: {
  data: { company_name: string; weeks: { week_start: string; articles: number; pages: number; surveys: number; total: number }[] };
  companyId: string;
}) {
  const maxTotal = Math.max(...data.weeks.map((w) => w.total), 1);

  return (
    <div>
      <div class="card">
        <div class="flex items-center gap-xs mb-sm">
          <span
            class="text-sm card-clickable"
            style="color: var(--color-accent)"
            hx-get="/analytics/engagement"
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            Engagement
          </span>
          <span class="text-xs text-muted">/</span>
          <span
            class="text-sm card-clickable"
            style="color: var(--color-accent)"
            hx-get={`/companies/${companyId}`}
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            {data.company_name}
          </span>
          <span class="text-xs text-muted">/</span>
          <span class="text-sm text-secondary">Timeline</span>
        </div>
        <div class="card-title">{data.company_name} — Activity Timeline</div>
        <div class="text-sm text-muted mt-sm">Last {data.weeks.length} weeks</div>
      </div>

      {data.weeks.length > 0 ? (
        <div class="card">
          <div class="card-label mb-xs">Weekly Activity</div>
          {data.weeks.map((w) => {
            const barWidth = Math.max((w.total / maxTotal) * 100, 2);
            const weekLabel = new Date(w.week_start).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            return (
              <div class="table-row">
                <div class="font-mono text-xs text-muted" style="width: 4.5rem; flex-shrink: 0">
                  {weekLabel}
                </div>
                <div class="flex-1">
                  <div style="display: flex; height: 18px; border-radius: 3px; overflow: hidden; background: var(--color-surface-elevated)">
                    {w.surveys > 0 && (
                      <div
                        style={`width: ${(w.surveys / w.total) * barWidth}%; background: var(--visma-turquoise); min-width: 3px`}
                        title={`${w.surveys} surveys`}
                      ></div>
                    )}
                    {w.articles > 0 && (
                      <div
                        style={`width: ${(w.articles / w.total) * barWidth}%; background: var(--visma-lime); min-width: 3px`}
                        title={`${w.articles} articles`}
                      ></div>
                    )}
                    {w.pages > 0 && (
                      <div
                        style={`width: ${(w.pages / w.total) * barWidth}%; background: var(--visma-green); min-width: 3px; opacity: 0.6`}
                        title={`${w.pages} pages`}
                      ></div>
                    )}
                  </div>
                </div>
                <div class="font-mono text-xs" style="width: 2.5rem; text-align: right; color: var(--visma-turquoise)">
                  {w.total}
                </div>
              </div>
            );
          })}
          <div class="flex gap-sm mt-sm" style="justify-content: center">
            <span class="text-xs text-muted flex items-center gap-xs">
              <span style="width: 10px; height: 10px; border-radius: 2px; background: var(--visma-turquoise); display: inline-block"></span> Surveys
            </span>
            <span class="text-xs text-muted flex items-center gap-xs">
              <span style="width: 10px; height: 10px; border-radius: 2px; background: var(--visma-lime); display: inline-block"></span> Articles
            </span>
            <span class="text-xs text-muted flex items-center gap-xs">
              <span style="width: 10px; height: 10px; border-radius: 2px; background: var(--visma-green); opacity: 0.6; display: inline-block"></span> Pages
            </span>
          </div>
        </div>
      ) : (
        <div class="empty-state">
          <div class="empty-state-icon">&#9671;</div>
          <div>No activity recorded for this company.</div>
        </div>
      )}
    </div>
  );
}
