import type { ListWithStats } from "../../types/index.ts";
import { relativeDate } from "./helpers.tsx";

function listTypeBadge(type: string) {
  if (type === "smart") return <span class="badge badge-lime">Smart</span>;
  return <span class="badge badge-green">Manual</span>;
}

export function ListsCard({ lists }: { lists: ListWithStats[] }) {
  return (
    <div>
      <div class="card">
        <div class="flex items-center justify-between mb-sm">
          <div class="card-label">Lists ({lists.length})</div>
          <button
            class="period-btn"
            hx-get="/lists/new"
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            + New List
          </button>
        </div>
      </div>

      {lists.length > 0 ? (
        <div class="card">
          {lists.map((l) => (
            <div
              class="table-row card-clickable"
              hx-get={`/lists/${l.id}`}
              hx-target="#canvas"
              hx-swap="innerHTML"
            >
              <div class="flex-1">
                <div class="flex gap-xs items-center">
                  <span style="font-weight: 600">{l.name}</span>
                  {listTypeBadge(l.list_type)}
                </div>
                {l.description && (
                  <div class="text-xs text-muted" style="margin-top: 2px">{l.description}</div>
                )}
              </div>
              <div style="text-align: right">
                <div class="font-mono" style="font-size: 1.25rem; font-weight: 700; color: var(--visma-turquoise)">
                  {l.member_count}
                </div>
                <div class="text-xs text-muted">
                  {l.list_type === "smart" ? "matching" : "members"}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div class="empty-state">
          <div class="empty-state-icon">&#9671;</div>
          <div>No lists yet. Create one to start segmenting contacts.</div>
        </div>
      )}
    </div>
  );
}
