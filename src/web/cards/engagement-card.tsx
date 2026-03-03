import type { CompanyEngagement } from "../../types/index.ts";
import { PeriodToggle } from "./helpers.tsx";
import type { Period } from "./helpers.tsx";

function trendIndicator(trend: CompanyEngagement["trend"]) {
  if (trend === "rising") return <span class="font-mono" style="color: var(--visma-lime)">&#9650;</span>;
  if (trend === "cooling") return <span class="font-mono" style="color: var(--visma-coral)">&#9660;</span>;
  return <span class="font-mono" style="color: var(--color-text-muted)">&#9644;</span>;
}

export function EngagementCard({ companies, period = "all" }: { companies: CompanyEngagement[]; period?: Period }) {
  const avgScore = companies.length > 0
    ? companies.reduce((s, c) => s + c.engagement_score, 0) / companies.length
    : 0;
  const risingCount = companies.filter((c) => c.trend === "rising").length;

  return (
    <div>
      <PeriodToggle current={period} basePath="/analytics/engagement" />

      <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr)">
        <div class="stat-box">
          <div class="stat-value">{companies.length}</div>
          <div class="stat-label">Engaged Companies</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{avgScore > 0 ? avgScore.toFixed(0) : "—"}</div>
          <div class="stat-label">Avg Score</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style={risingCount > 0 ? "color: var(--visma-lime)" : undefined}>
            {risingCount}
          </div>
          <div class="stat-label">Rising</div>
        </div>
      </div>

      {companies.length > 0 ? (
        <div class="card">
          <div class="card-label mb-xs">Engagement Rankings</div>
          {companies.map((c) => (
            <div
              class="table-row card-clickable"
              hx-get={`/companies/${c.company_id}/timeline`}
              hx-target="#canvas"
              hx-swap="innerHTML"
            >
              <div class="flex-1">
                <div class="flex gap-xs items-center">
                  <span style="font-weight: 600">{c.company_name}</span>
                  {trendIndicator(c.trend)}
                </div>
                <div class="text-xs text-muted" style="margin-top: 2px">
                  {c.survey_completions > 0 && <span>{c.survey_completions} surveys · </span>}
                  {c.article_reads > 0 && <span>{c.article_reads} articles · </span>}
                  {c.page_views > 0 && <span>{c.page_views} views</span>}
                </div>
              </div>
              <div style="text-align: right">
                <div class="font-mono" style="font-size: 1.25rem; font-weight: 700; color: var(--visma-turquoise)">
                  {c.engagement_score}
                </div>
                <div class="text-xs text-muted">score</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div class="empty-state">
          <div class="empty-state-icon">&#9671;</div>
          <div>No engagement data{period !== "all" ? " in this period" : " yet"}.</div>
        </div>
      )}
    </div>
  );
}
