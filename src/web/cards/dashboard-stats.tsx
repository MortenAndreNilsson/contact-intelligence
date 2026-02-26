import type { DashboardStats } from "../../types/index.ts";
import { ActivityTimeline } from "./activity-timeline.tsx";

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
