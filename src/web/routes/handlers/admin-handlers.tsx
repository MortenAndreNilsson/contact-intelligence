/**
 * Admin handlers — help, sync_status, unknown.
 * Minimal handlers + HelpCard component.
 */

import type { IntentHandler } from "../chat-handlers.tsx";

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

export const handleUnknown: IntentHandler = async () => {
  return { html: <HelpCard />, summary: "Showed help (unknown intent)" };
};
