/**
 * Admin handlers — help, sync_status, unknown, refresh_summaries.
 * Minimal handlers + HelpCard component.
 */

import type { IntentHandler } from "../chat-handlers.tsx";
import { refreshAllSummaries } from "../../../services/summary-refresh.ts";

export function HelpCard() {
  return (
    <div class="card">
      <div class="card-label mb-xs">Available Commands</div>
      <div class="text-sm text-secondary" style="line-height: 1.8">
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/dashboard</span> — overview with stats</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/companies</span> — list all companies</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/company [name]</span> — show company profile</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/contacts</span> — list all contacts</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/contact [name/email]</span> — show contact profile</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/articles</span> — top articles by reader count</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/views</span> — top pages by view count</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/surveys</span> — survey completions and scores</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/engagement</span> — company engagement rankings</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/lists</span> — view all lists and segments</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/list [name]</span> — show a specific list</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/sync</span> — run full sync pipeline (events + surveys + materialize + enrich)</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/enrich</span> — enrich contacts via Discovery Engine</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/research [company]</span> — deep research a company via Gemini</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/briefing [company/contact]</span> — generate CRM briefing via LM Studio</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/journey</span> — AI maturity journey overview</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/journey [company]</span> — company journey detail</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/signals</span> — engagement signals feed</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">set [company] to [stage]</span> — set journey stage</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">set [contact] to [level]</span> — set fluency level</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">snapshot [company]</span> — create maturity snapshot</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/notebook</span> — personal knowledge notebook</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/search [query]</span> — semantic search across articles, notes, research</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/embed articles</span> — index CMS articles for semantic search</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/embed notebooks</span> — index notebook entries for semantic search</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/embedding stats</span> — show embedding statistics</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/backup</span> — backup database locally + GCS</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/refresh-summaries</span> — refresh all cached summaries via LLM</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/help</span> — show this list</div>
        <div class="text-xs text-muted mt-sm">You can also type naturally: "who works at Visma?", "show me their survey scores", "any Norwegian software companies?"</div>
      </div>
    </div>
  );
}

export const handleHelp: IntentHandler = async () => {
  return { html: <HelpCard />, summary: "Showed help" };
};

export const handleSyncStatus: IntentHandler = async () => {
  return {
    html: (
      <div hx-get="/sync/status" hx-trigger="load" hx-target="#canvas" hx-swap="innerHTML">
        <div class="text-sm text-muted">Loading sync status...</div>
      </div>
    ),
    summary: "Showed sync status",
  };
};

export const handleRefreshSummaries: IntentHandler = async () => {
  try {
    const result = await refreshAllSummaries();
    return {
      html: (
        <div class="card">
          <div class="card-label mb-xs" style="color: var(--visma-turquoise)">Summaries Refreshed</div>
          <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr)">
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem; color: var(--visma-turquoise)">{result.companiesUpdated}</div>
              <div class="stat-label">Companies</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem; color: var(--visma-turquoise)">{result.contactsUpdated}</div>
              <div class="stat-label">Contacts</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem; color: var(--visma-coral)">{result.errors}</div>
              <div class="stat-label">Errors</div>
            </div>
          </div>
        </div>
      ),
      summary: `Refreshed ${result.companiesUpdated} companies + ${result.contactsUpdated} contacts`,
    };
  } catch (err: any) {
    return {
      html: <div class="card"><div class="text-sm" style="color: var(--visma-coral)">Refresh failed: {err.message}</div></div>,
      summary: `Refresh failed: ${err.message}`,
    };
  }
};

export const handleUnknown: IntentHandler = async () => {
  return { html: <HelpCard />, summary: "Showed help (unknown intent)" };
};
