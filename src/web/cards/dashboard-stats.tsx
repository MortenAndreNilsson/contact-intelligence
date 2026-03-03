import type { DashboardStats } from "../../types/index.ts";
import { ActivityTimeline } from "./activity-timeline.tsx";
import { relativeDate, sectionBadge } from "./helpers.tsx";

export function DashboardStatsCard({ stats }: { stats: DashboardStats }) {
  return (
    <div>
      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-value">{stats.totalCompanies}</div>
          <div class="stat-label">Companies</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{stats.totalContacts}</div>
          <div class="stat-label">Contacts</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{stats.totalActivities}</div>
          <div class="stat-label">Activities</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{stats.avgScore ? stats.avgScore.toFixed(1) : "—"}</div>
          <div class="stat-label">Avg Score</div>
        </div>
      </div>

      {/* Top Read Articles */}
      {stats.topArticles.length > 0 && (
        <div class="card">
          <div class="card-label mb-xs">Top Read Articles</div>
          {stats.topArticles.map((a) => (
            <div
              class="table-row card-clickable"
              hx-get={`/articles/${encodeURIComponent(a.slug || a.title)}/readers`}
              hx-target="#canvas"
              hx-swap="innerHTML"
            >
              <div class="flex-1">
                <div style="font-weight: 600; font-size: 0.9rem">{a.title}</div>
                <div class="flex gap-xs items-center" style="margin-top: 2px">
                  {sectionBadge(a.section)}
                  <span class="text-xs text-muted">Last read {relativeDate(a.last_read)}</span>
                </div>
              </div>
              <div style="text-align: right">
                <div class="font-mono" style="font-size: 1.25rem; font-weight: 700; color: var(--visma-turquoise)">
                  {a.reader_count}
                </div>
                <div class="text-xs text-muted">readers</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Content */}
      {stats.newContent.length > 0 && (
        <div class="card">
          <div class="card-label mb-xs">Recently Published</div>
          {stats.newContent.map((c) => (
            <div class="table-row">
              <div class="flex-1">
                <div style="font-weight: 600; font-size: 0.9rem">{c.title}</div>
                <div class="flex gap-xs items-center" style="margin-top: 2px">
                  {sectionBadge(c.section)}
                  <span class="text-xs text-muted">First seen {relativeDate(c.first_seen)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {stats.topCompanies.length > 0 && (
        <div class="card">
          <div class="card-label mb-xs">Top Companies</div>
          {stats.topCompanies.map((c) => (
            <div
              class="table-row card-clickable"
              hx-get={`/companies/${c.id}`}
              hx-target="#canvas"
              hx-swap="innerHTML"
            >
              <div class="flex-1">
                <div style="font-weight: 600">{c.name}</div>
                <div class="text-xs text-muted">
                  {[c.industry, c.country].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div style="text-align: right">
                <div class="font-mono text-sm" style="color: var(--visma-green)">
                  {c.avg_score ? c.avg_score.toFixed(1) : "—"}
                </div>
                <div class="text-xs text-muted">{c.contact_count} contacts</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {stats.recentActivity.length > 0 && (
        <div class="card">
          <div class="card-label mb-xs">Recent Activity</div>
          <ActivityTimeline activities={stats.recentActivity} />
        </div>
      )}

      {stats.totalCompanies === 0 && (
        <div class="empty-state">
          <div class="empty-state-icon">◇</div>
          <div>No data yet. Run <span class="font-mono" style="color: var(--visma-turquoise)">bun run sync:all</span> to populate.</div>
        </div>
      )}
    </div>
  );
}
