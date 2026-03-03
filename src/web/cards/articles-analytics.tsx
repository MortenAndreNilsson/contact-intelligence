import type { TopArticleWithMovement } from "../../types/index.ts";
import { relativeDate, sectionBadge } from "./helpers.tsx";

export function ArticlesCard({ articles }: { articles: TopArticleWithMovement[] }) {
  const totalReaders = articles.reduce((s, a) => s + a.reader_count, 0);
  const newThisWeek = articles.reduce((s, a) => s + a.new_readers_7d, 0);

  return (
    <div>
      <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr)">
        <div class="stat-box">
          <div class="stat-value">{articles.length}</div>
          <div class="stat-label">Articles</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{totalReaders}</div>
          <div class="stat-label">Total Readers</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style={newThisWeek > 0 ? "color: var(--visma-lime)" : undefined}>
            {newThisWeek > 0 ? `+${newThisWeek}` : "0"}
          </div>
          <div class="stat-label">New This Week</div>
        </div>
      </div>

      {articles.length > 0 ? (
        <div class="card">
          <div class="card-label mb-xs">Articles by Reader Count</div>
          {articles.map((a) => (
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
                {a.new_readers_7d > 0 && (
                  <div class="text-xs font-mono" style="color: var(--visma-lime)">+{a.new_readers_7d} this week</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div class="empty-state">
          <div class="empty-state-icon">&#9671;</div>
          <div>No article views recorded yet.</div>
        </div>
      )}
    </div>
  );
}
