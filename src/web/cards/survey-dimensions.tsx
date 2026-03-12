export function SurveyDimensionsCard({ data, companyId }: {
  data: { company_name: string; dimensions: { name: string; avg_score: number }[]; completions: number };
  companyId: string;
}) {
  return (
    <div>
      <div class="card">
        <div class="flex items-center gap-xs mb-sm">
          <span
            class="text-sm card-clickable"
            style="color: var(--color-accent)"
            hx-get="/analytics/surveys"
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            Surveys (all)
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
          <span class="text-sm text-secondary">Dimensions</span>
        </div>
        <div class="card-title">{data.company_name} — Survey Dimensions</div>
        <div class="text-sm text-muted mt-sm">{data.completions} survey completion{data.completions !== 1 ? "s" : ""}</div>
      </div>

      {data.dimensions.length > 0 ? (
        <div class="card">
          <div class="card-label mb-xs">Dimension Scores</div>
          {data.dimensions.map((d) => {
            const pct = Math.min((d.avg_score / 5) * 100, 100);
            return (
              <div class="table-row">
                <div class="flex-1">
                  <div style="font-weight: 600; font-size: 0.9rem; text-transform: capitalize">
                    {d.name.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim()}
                  </div>
                  <div class="score-bar mt-sm" style="max-width: 200px">
                    <div class="score-bar-fill" style={`width: ${pct}%`}></div>
                  </div>
                </div>
                <div style="text-align: right">
                  <div class="font-mono" style="font-size: 1.25rem; font-weight: 700; color: var(--visma-turquoise)">
                    {d.avg_score.toFixed(1)}
                  </div>
                  <div class="text-xs text-muted">/ 5.0</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div class="empty-state">
          <div class="empty-state-icon">&#9671;</div>
          <div>No dimension data available for this company.</div>
        </div>
      )}
    </div>
  );
}
