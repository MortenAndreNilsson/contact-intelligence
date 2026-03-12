import type { SurveyDetailData } from "../../types/index.ts";
import { relativeDate } from "./helpers.tsx";
import { maturityBadge, maturityBadgeClass } from "./surveys-analytics.tsx";

const maturityOrder = ["Beginner", "Developing", "Intermediate", "Advanced", "Leader"];

export function SurveyDetailCard({ data }: { data: SurveyDetailData }) {
  const displayTitle = data.title || data.slug;
  const maxMaturity = data.maturity_distribution.length > 0
    ? Math.max(...data.maturity_distribution.map((d) => d.count))
    : 0;

  return (
    <div>
      {/* Breadcrumb + header */}
      <div class="card">
        <div class="flex items-center gap-xs mb-sm">
          <span
            class="text-sm card-clickable"
            style="color: var(--color-accent)"
            hx-get="/analytics/surveys"
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            Surveys
          </span>
          <span class="text-xs text-muted">/</span>
          <span class="text-sm text-secondary">{displayTitle}</span>
        </div>
        <div class="card-title">{displayTitle}</div>

        <div class="stat-grid mt-sm" style="grid-template-columns: repeat(3, 1fr)">
          <div class="stat-box">
            <div class="stat-value">{data.response_count}</div>
            <div class="stat-label">Responses</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">{data.avg_score != null ? data.avg_score.toFixed(1) : "—"}</div>
            <div class="stat-label">{data.is_scored ? "Avg Score" : "No scoring"}</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">
              {data.is_scored
                ? <span class="badge badge-lime" style="font-size: 0.7rem">Scored</span>
                : <span class="badge badge-yellow" style="font-size: 0.7rem">Pulse</span>}
            </div>
            <div class="stat-label">Type</div>
          </div>
        </div>
      </div>

      {/* Maturity distribution (scored only) */}
      {data.is_scored && data.maturity_distribution.length > 0 && (
        <div class="card">
          <div class="card-label mb-xs">Maturity Distribution</div>
          {maturityOrder.map((level) => {
            const entry = data.maturity_distribution.find((d) => d.level === level);
            const count = entry?.count ?? 0;
            const pct = maxMaturity > 0 ? (count / maxMaturity) * 100 : 0;
            const cls = maturityBadgeClass[level] || "badge-green";
            return (
              <div class="table-row" style="padding: 6px 0">
                <div style="width: 100px">
                  <span class={`badge ${cls}`}>{level}</span>
                </div>
                <div class="flex-1">
                  <div class="score-bar" style="height: 20px">
                    <div class="score-bar-fill" style={`width: ${pct}%`}></div>
                  </div>
                </div>
                <div class="font-mono text-sm" style="width: 40px; text-align: right; font-weight: 600">
                  {count}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Answer distributions */}
      {data.question_distributions.length > 0 && (
        <div class="card">
          <div class="card-label mb-xs">Answer Distributions</div>
          {data.question_distributions.map((q) => {
            const maxCount = q.answers.length > 0 ? Math.max(...q.answers.map((a) => a.count)) : 0;
            return (
              <div style="margin-bottom: var(--space-md); padding-bottom: var(--space-md); border-bottom: 1px solid var(--color-border)">
                <div class="text-sm" style="font-weight: 600; margin-bottom: var(--space-xs)">
                  Q{q.question_index}
                </div>
                {q.answers.map((a) => {
                  const barPct = maxCount > 0 ? (a.count / maxCount) * 100 : 0;
                  return (
                    <div class="flex items-center gap-xs" style="margin-bottom: 4px">
                      <div class="text-xs" style="width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap" title={a.label}>
                        {a.label}
                      </div>
                      <div class="flex-1">
                        <div class="score-bar" style="height: 16px">
                          <div class="score-bar-fill" style={`width: ${barPct}%`}></div>
                        </div>
                      </div>
                      <div class="font-mono text-xs" style="width: 60px; text-align: right">
                        {a.count} ({a.percentage}%)
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Recent completions */}
      {data.recent_completions.length > 0 && (
        <div class="card">
          <div class="card-label mb-xs">Recent Completions</div>
          {data.recent_completions.map((c) => (
            <div
              class="table-row card-clickable"
              hx-get={`/contacts/by-email/${encodeURIComponent(c.contact_email)}`}
              hx-target="#canvas"
              hx-swap="innerHTML"
            >
              <div class="flex-1">
                <div style="font-weight: 600; font-size: 0.9rem">{c.contact_name || c.contact_email}</div>
                <div class="text-xs text-muted">
                  {[c.company_name, c.contact_email].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div style="text-align: right">
                <div class="flex gap-xs items-center" style="justify-content: flex-end">
                  {c.score != null && c.score > 0 && (
                    <span class="font-mono text-sm" style="color: var(--visma-turquoise)">{c.score.toFixed(1)}</span>
                  )}
                  {c.maturity_level ? maturityBadge(c.maturity_level) : null}
                </div>
                <div class="text-xs text-muted" style="margin-top: 2px">{relativeDate(c.completed_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
