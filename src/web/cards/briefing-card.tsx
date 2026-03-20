/** Full briefing display card with copy-to-clipboard (G4) */
export function BriefingCard({
  entityName,
  entityType,
  briefing,
}: {
  entityName: string;
  entityType: "company" | "contact";
  briefing: string;
}) {
  // Convert markdown headings to styled HTML
  const sections = briefing.split(/^## /m).filter(Boolean);

  return (
    <div class="card" x-data="{ copied: false }">
      <div class="flex items-center justify-between mb-sm">
        <div class="card-label">Briefing: {entityName}</div>
        <button
          type="button"
          class="period-btn"
          style="font-size: 0.7rem; padding: 0.3rem 0.6rem"
          x-on:click={`
            navigator.clipboard.writeText(document.getElementById('briefing-text').innerText);
            copied = true;
            setTimeout(() => copied = false, 2000);
          `}
        >
          <span x-show="!copied">Copy</span>
          <span x-show="copied" x-cloak>Copied</span>
        </button>
      </div>

      <div id="briefing-text" class="text-sm text-secondary" style="line-height: 1.7">
        {sections.map((section) => {
          const lines = section.split("\n");
          const heading = lines[0]?.trim();
          const body = lines.slice(1).join("\n").trim();
          return (
            <div style="margin-bottom: var(--space-sm)">
              {heading && (
                <div style="font-weight: 600; font-size: 0.8rem; color: var(--color-text-primary); margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.03em">
                  {heading}
                </div>
              )}
              {body && <div style="white-space: pre-wrap">{body}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Inline summary block for profile cards (G4) */
export function InlineSummary({ summary, entityId, entityType }: { summary: string | null; entityId?: string; entityType?: "company" | "contact" }) {
  const refreshUrl = entityId && entityType
    ? `/${entityType === "company" ? "companies" : "contacts"}/${entityId}/refresh-summary`
    : null;

  if (!summary) {
    if (!refreshUrl) return <></>;
    return (
      <div style="margin-bottom: var(--space-sm)">
        <button
          class="text-xs"
          style="background: none; border: 1px solid var(--color-border); color: var(--visma-turquoise); cursor: pointer; padding: 2px 8px; border-radius: var(--radius-md)"
          hx-post={refreshUrl}
          hx-target="closest div"
          hx-swap="outerHTML"
          hx-indicator="closest div"
        >
          Generate summary
        </button>
      </div>
    );
  }

  return (
    <div
      class="text-sm text-secondary"
      style="line-height: 1.6; padding: var(--space-xs) var(--space-sm); background: var(--color-surface-elevated); border-radius: var(--radius-md); border-left: 3px solid var(--visma-turquoise); margin-bottom: var(--space-sm); font-style: italic; display: flex; align-items: flex-start; gap: 8px"
    >
      <span style="flex: 1">{summary}</span>
      {refreshUrl && (
        <button
          class="text-xs"
          style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 0; flex-shrink: 0"
          title="Refresh summary"
          hx-post={refreshUrl}
          hx-target="closest div"
          hx-swap="outerHTML"
        >
          &#8635;
        </button>
      )}
    </div>
  );
}
