import type { TopPageWithMovement } from "../../types/index.ts";
import { relativeDate, sectionBadge } from "./helpers.tsx";

export function ViewsCard({ pages }: { pages: TopPageWithMovement[] }) {
  const totalViews = pages.reduce((s, p) => s + p.view_count, 0);
  const newThisWeek = pages.reduce((s, p) => s + p.new_views_7d, 0);

  return (
    <div>
      <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr)">
        <div class="stat-box">
          <div class="stat-value">{pages.length}</div>
          <div class="stat-label">Pages</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{totalViews}</div>
          <div class="stat-label">Total Views</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style={newThisWeek > 0 ? "color: var(--visma-lime)" : undefined}>
            {newThisWeek > 0 ? `+${newThisWeek}` : "0"}
          </div>
          <div class="stat-label">Views This Week</div>
        </div>
      </div>

      {pages.length > 0 ? (
        <div class="card">
          <div class="card-label mb-xs">Pages by View Count</div>
          {pages.map((p) => (
            <div class="table-row">
              <div class="flex-1">
                <div style="font-weight: 600; font-size: 0.9rem">{p.title}</div>
                <div class="flex gap-xs items-center" style="margin-top: 2px">
                  {sectionBadge(p.section)}
                  <span class="text-xs text-muted">Last viewed {relativeDate(p.last_viewed)}</span>
                </div>
              </div>
              <div style="text-align: right">
                <div class="font-mono" style="font-size: 1.25rem; font-weight: 700; color: var(--visma-turquoise)">
                  {p.view_count}
                </div>
                <div class="text-xs text-muted">{p.unique_visitors} unique</div>
                {p.new_views_7d > 0 && (
                  <div class="text-xs font-mono" style="color: var(--visma-lime)">+{p.new_views_7d} this week</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div class="empty-state">
          <div class="empty-state-icon">&#9671;</div>
          <div>No page views recorded yet.</div>
        </div>
      )}
    </div>
  );
}
