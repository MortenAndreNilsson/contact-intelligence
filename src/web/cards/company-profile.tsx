import type { CompanyWithStats, ContactWithDetails } from "../../types/index.ts";
import type { ActivityWithNames } from "../../types/index.ts";
import { ActivityTimeline } from "./activity-timeline.tsx";

export function CompanyProfileCard({
  company,
  contacts,
  activities,
}: {
  company: CompanyWithStats;
  contacts: ContactWithDetails[];
  activities: ActivityWithNames[];
}) {
  const scorePct = company.avg_score ? (company.avg_score / 5) * 100 : 0;

  return (
    <div>
      <div class="card">
        <div class="flex items-center justify-between mb-sm">
          <div>
            <div class="card-title">{company.name}</div>
            <div class="text-sm text-secondary">
              {[company.domain, company.industry, company.size_bucket, company.country]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div style="text-align: right">
            <div class="font-mono" style="font-size: 2rem; font-weight: 800; color: var(--visma-green)">
              {company.avg_score ? company.avg_score.toFixed(1) : "—"}
            </div>
            <div class="text-xs text-muted">avg score</div>
          </div>
        </div>

        {company.avg_score && (
          <div class="mb-sm">
            <div class="score-bar">
              <div class="score-bar-fill" style={`width: ${scorePct}%`}></div>
            </div>
          </div>
        )}

        {company.tags.length > 0 && (
          <div class="flex gap-xs" style="flex-wrap: wrap; margin-bottom: var(--space-sm)">
            {company.tags.map((tag) => (
              <span class="badge badge-green">{tag}</span>
            ))}
          </div>
        )}

        {company.notes && (
          <div class="text-sm text-secondary" style="margin-top: var(--space-xs); line-height: 1.6">
            {company.notes}
          </div>
        )}
      </div>

      {contacts.length > 0 && (
        <div class="card">
          <div class="card-label mb-xs">Contacts ({contacts.length})</div>
          {contacts.map((ct) => (
            <div
              class="table-row card-clickable"
              hx-get={`/contacts/${ct.id}`}
              hx-target="#canvas"
              hx-swap="innerHTML"
            >
              <div class="flex-1">
                <div style="font-weight: 600">{ct.name || ct.email}</div>
                <div class="text-xs text-muted">
                  {[ct.job_title, ct.email].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div class="text-xs text-muted font-mono">{ct.activity_count} activities</div>
            </div>
          ))}
        </div>
      )}

      {activities.length > 0 && (
        <div class="card">
          <div class="card-label mb-xs">Activity Timeline</div>
          <ActivityTimeline activities={activities} />
        </div>
      )}
    </div>
  );
}
