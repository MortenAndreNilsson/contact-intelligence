import type { SurveyOverview, SurveyIndexEntry } from "../../types/index.ts";
import { relativeDate, PeriodToggle } from "./helpers.tsx";
import type { Period } from "./helpers.tsx";

export const maturityBadgeClass: Record<string, string> = {
  Beginner: "badge-coral",
  Developing: "badge-orange",
  Intermediate: "badge-yellow",
  Advanced: "badge-lime",
  Leader: "badge-turquoise",
};

export function maturityBadge(level: string) {
  const cls = maturityBadgeClass[level] || "badge-green";
  return <span class={`badge ${cls}`}>{level}</span>;
}

function sourceBadge(source: string | null) {
  if (source === "et-cms") return <span class="badge badge-turquoise" style="font-size: 0.6rem; padding: 1px 4px">ET-CMS</span>;
  if (source === "lighthouse-view") return <span class="badge badge-muted" style="font-size: 0.6rem; padding: 1px 4px">Lighthouse</span>;
  return null;
}

export function SurveysCard({ data, surveys, period = "all" }: { data: SurveyOverview; surveys: SurveyIndexEntry[]; period?: Period }) {
  return (
    <div>
      <PeriodToggle current={period} basePath="/analytics/surveys" />

      <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr)">
        <div class="stat-box">
          <div class="stat-value">{data.total_completions}</div>
          <div class="stat-label">Completions</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{data.avg_overall_score ? data.avg_overall_score.toFixed(1) : "—"}</div>
          <div class="stat-label">Avg Score</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{data.companies_surveyed}</div>
          <div class="stat-label">Companies</div>
        </div>
      </div>

      {surveys.length > 0 ? (
        <>
          <div class="card">
            <div class="card-label mb-xs">Surveys</div>
            {surveys.map((s) => (
              <div
                class="table-row card-clickable"
                hx-get={`/analytics/surveys/${encodeURIComponent(s.slug)}`}
                hx-target="#canvas"
                hx-swap="innerHTML"
              >
                <div class="flex-1">
                  <div style="font-weight: 600">{s.title || s.slug}</div>
                  <div class="flex gap-xs items-center" style="margin-top: 4px">
                    {s.is_scored
                      ? <span class="badge badge-lime" style="font-size: 0.6rem; padding: 1px 4px">Scored</span>
                      : <span class="badge badge-yellow" style="font-size: 0.6rem; padding: 1px 4px">Pulse</span>}
                    {sourceBadge(s.source)}
                    <span class="text-xs text-muted">{s.response_count} response{s.response_count !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div style="text-align: right">
                  <div class="font-mono" style="font-size: 1.25rem; font-weight: 700; color: var(--visma-turquoise)">
                    {s.avg_score != null ? s.avg_score.toFixed(1) : "—"}
                  </div>
                  <div class="text-xs text-muted">{relativeDate(s.latest_completion)}</div>
                </div>
              </div>
            ))}
          </div>

          {data.company_rankings.length > 0 && (
            <div class="card">
              <div class="card-label mb-xs">Company Rankings</div>
              {data.company_rankings.map((r) => (
                <div
                  class="table-row card-clickable"
                  hx-get={`/analytics/company/${r.company_id}/survey-dimensions`}
                  hx-target="#canvas"
                  hx-swap="innerHTML"
                >
                  <div class="flex-1">
                    <div style="font-weight: 600">{r.company_name}</div>
                    <div class="flex gap-xs items-center" style="margin-top: 4px">
                      {maturityBadge(r.maturity_level)}
                      <span class="text-xs text-muted">{r.completion_count} completion{r.completion_count !== 1 ? "s" : ""}</span>
                    </div>
                    <div class="score-bar mt-sm" style="max-width: 160px">
                      <div class="score-bar-fill" style={`width: ${Math.min(r.avg_score / 5 * 100, 100)}%`}></div>
                    </div>
                  </div>
                  <div style="text-align: right">
                    <div class="font-mono" style="font-size: 1.25rem; font-weight: 700; color: var(--visma-turquoise)">
                      {r.avg_score.toFixed(1)}
                    </div>
                    <div class="text-xs text-muted">avg score</div>
                  </div>
                </div>
              ))}
            </div>
          )}

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
                      <span class="font-mono text-sm" style="color: var(--visma-turquoise)">{c.score != null ? c.score.toFixed(1) : "—"}</span>
                      {c.maturity_level ? maturityBadge(c.maturity_level) : null}
                    </div>
                    <div class="text-xs text-muted" style="margin-top: 2px">{relativeDate(c.completed_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div class="empty-state">
          <div class="empty-state-icon">&#9671;</div>
          <div>No survey completions recorded{period !== "all" ? " in this period" : " yet"}.</div>
        </div>
      )}
    </div>
  );
}
