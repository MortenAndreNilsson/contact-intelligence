import type { EmbeddingSearchResult } from "../../types/index.ts";

function typeLabel(type: string): string {
  switch (type) {
    case "article": return "Article";
    case "note": return "Note";
    case "research": return "Research";
    default: return type;
  }
}

function typeColor(type: string): string {
  switch (type) {
    case "article": return "var(--visma-turquoise)";
    case "note": return "var(--visma-lime)";
    case "research": return "var(--visma-purple, #8b5cf6)";
    default: return "var(--visma-turquoise)";
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "...";
}

export function MemoryResultsCard({ results, query }: { results: EmbeddingSearchResult[]; query: string }) {
  if (results.length === 0) {
    return (
      <div class="card">
        <div class="card-label mb-xs">Memory Search</div>
        <div class="text-sm text-muted">No results found for "{query}". Try embedding articles first: <span class="font-mono">/embed articles</span></div>
      </div>
    );
  }

  // Group by content_type
  const grouped: Record<string, EmbeddingSearchResult[]> = {};
  for (const r of results) {
    (grouped[r.content_type] ??= []).push(r);
  }

  return (
    <div class="card">
      <div class="card-label mb-xs">Memory Search: "{query}"</div>
      <div class="text-xs text-muted mb-sm">{results.length} results found</div>

      {Object.entries(grouped).map(([type, items]) => (
        <div class="mb-sm">
          <div class="section-title" style={`color: ${typeColor(type)}; font-size: 0.75rem; margin-bottom: 0.25rem`}>
            {typeLabel(type)} ({items.length})
          </div>
          {items.map((r) => {
            const meta = r.metadata || {};
            const title = (meta.contentTitle as string) || (meta.company_name as string) || (meta.contact_name as string) || (meta.slug as string) || "Untitled";
            const score = Math.round(r.score * 100);
            return (
              <div class="table-row" style="align-items: flex-start">
                <div class="flex-1">
                  <div class="text-sm" style="font-weight: 600">{title}</div>
                  <div class="text-xs text-muted" style="margin-top: 2px; line-height: 1.4">
                    {truncate(r.content_text, 200)}
                  </div>
                </div>
                <div class="text-xs" style={`color: ${typeColor(type)}; white-space: nowrap; margin-left: 8px`}>
                  {score}%
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function EmbeddingStatsCard({ stats }: { stats: { totalSources: number; totalChunks: number; byType: Record<string, number> } }) {
  return (
    <div class="card">
      <div class="card-label mb-xs">Embedding Stats</div>
      <div class="stat-grid" style="grid-template-columns: repeat(2, 1fr)">
        <div class="stat-box">
          <div class="stat-value" style="font-size: 1.5rem">{stats.totalSources}</div>
          <div class="stat-label">Sources</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style="font-size: 1.5rem">{stats.totalChunks}</div>
          <div class="stat-label">Chunks</div>
        </div>
      </div>
      {Object.entries(stats.byType).length > 0 && (
        <div class="text-xs text-muted mt-sm">
          {Object.entries(stats.byType).map(([type, count]) => (
            <span style="margin-right: 12px">{typeLabel(type)}: {count}</span>
          ))}
        </div>
      )}
    </div>
  );
}
