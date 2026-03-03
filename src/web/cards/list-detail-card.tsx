import type { ListWithStats, ListMember, FilterCriteria } from "../../types/index.ts";

function filterDescription(criteria: FilterCriteria): string {
  const parts: string[] = [];
  if (criteria.industry) parts.push(`industry ~ "${criteria.industry}"`);
  if (criteria.country) parts.push(`country ~ "${criteria.country}"`);
  if (criteria.tag) parts.push(`tag = "${criteria.tag}"`);
  if (criteria.min_engagement) parts.push(`engagement >= ${criteria.min_engagement}`);
  if (criteria.has_survey) parts.push("has survey");
  return parts.join(" AND ") || "no filters";
}

export function ListDetailCard({ list, members }: { list: ListWithStats; members: ListMember[] }) {
  const totalEngagement = members.reduce((s, m) => s + m.engagement_score, 0);
  const avgEngagement = members.length > 0 ? totalEngagement / members.length : 0;

  return (
    <div>
      <div class="card">
        <div class="flex items-center gap-xs mb-sm">
          <span
            class="text-sm card-clickable"
            style="color: var(--color-accent)"
            hx-get="/lists"
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            Lists
          </span>
          <span class="text-xs text-muted">/</span>
          <span class="text-sm text-secondary">{list.name}</span>
        </div>
        <div class="card-title">{list.name}</div>
        {list.description && (
          <div class="text-sm text-muted mt-sm">{list.description}</div>
        )}
        {list.list_type === "smart" && list.filter_criteria && (
          <div class="text-xs font-mono mt-sm" style="color: var(--visma-lime); background: rgba(140,181,1,0.1); padding: 0.4rem 0.6rem; border-radius: var(--radius-sm); display: inline-block">
            {filterDescription(list.filter_criteria)}
          </div>
        )}
      </div>

      <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr)">
        <div class="stat-box">
          <div class="stat-value">{members.length}</div>
          <div class="stat-label">{list.list_type === "smart" ? "Matching" : "Members"}</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{avgEngagement > 0 ? avgEngagement.toFixed(0) : "—"}</div>
          <div class="stat-label">Avg Engagement</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{totalEngagement}</div>
          <div class="stat-label">Total Score</div>
        </div>
      </div>

      {list.list_type === "manual" && (
        <div class="card">
          <div class="flex items-center justify-between mb-sm">
            <div class="card-label">Add Contact</div>
          </div>
          <form
            class="flex gap-xs"
            hx-post={`/lists/${list.id}/add`}
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            <input
              type="text"
              name="query"
              class="chat-input"
              placeholder="Search by name or email..."
              style="font-size: 0.85rem; padding: 0.5rem 0.75rem"
            />
            <button type="submit" class="period-btn" style="white-space: nowrap">+ Add</button>
          </form>
        </div>
      )}

      {/* Bulk actions */}
      <div class="card">
        <div class="card-label mb-xs">Bulk Actions</div>
        <div class="flex gap-xs" style="flex-wrap: wrap">
          <button
            class="period-btn"
            hx-post={`/lists/${list.id}/enrich`}
            hx-target="#canvas"
            hx-swap="innerHTML"
            hx-confirm="Enrich all contacts in this list?"
          >
            Enrich All
          </button>
          <button
            class="period-btn"
            hx-post={`/lists/${list.id}/research`}
            hx-target="#canvas"
            hx-swap="innerHTML"
            hx-confirm="Research all companies for this list?"
          >
            Research Companies
          </button>
          <a
            class="period-btn"
            href={`/lists/${list.id}/export.csv`}
            style="text-decoration: none; display: inline-flex; align-items: center"
          >
            Export CSV
          </a>
        </div>
      </div>

      {members.length > 0 ? (
        <div class="card">
          <div class="card-label mb-xs">Members</div>
          {members.map((m) => (
            <div class="table-row">
              <div
                class="flex-1 card-clickable"
                hx-get={`/contacts/${m.contact_id}`}
                hx-target="#canvas"
                hx-swap="innerHTML"
              >
                <div style="font-weight: 600">{m.contact_name || m.contact_email}</div>
                <div class="text-xs text-muted">
                  {[m.job_title, m.company_name, m.contact_email].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div style="text-align: right; display: flex; align-items: center; gap: var(--space-sm)">
                <div>
                  <div class="font-mono text-sm" style="color: var(--visma-turquoise)">{m.engagement_score}</div>
                  <div class="text-xs text-muted">{m.activity_count} acts</div>
                </div>
                {list.list_type === "manual" && (
                  <button
                    class="period-btn"
                    style="font-size: 0.7rem; padding: 0.2rem 0.5rem; color: var(--visma-coral); border-color: var(--visma-coral)"
                    hx-delete={`/lists/${list.id}/members/${m.contact_id}`}
                    hx-target="#canvas"
                    hx-swap="innerHTML"
                  >
                    &#10005;
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div class="empty-state">
          <div class="empty-state-icon">&#9671;</div>
          <div>
            {list.list_type === "smart"
              ? "No contacts match the current filter criteria."
              : "No members yet. Add contacts above."}
          </div>
        </div>
      )}
    </div>
  );
}
