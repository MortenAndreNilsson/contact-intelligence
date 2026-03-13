import type { Message } from "../../types/index.ts";

export function MessageDraftCard({ message }: { message: Message }) {
  const content = message.final_content || message.draft_content || "";

  return (
    <div class="card" id="message-content">
      <div class="flex items-center justify-between mb-sm">
        <div class="card-label">
          Draft — {message.channel.charAt(0).toUpperCase() + message.channel.slice(1)}
        </div>
        <span class={`badge ${message.status === "completed" ? "badge-turquoise" : "badge-orange"}`}>
          {message.status}
        </span>
      </div>

      {message.recipient_name && (
        <div class="text-xs text-muted mb-sm">
          To: {message.recipient_name}
        </div>
      )}

      <form
        id="draft-form"
        hx-put={`/messages/${message.id}`}
        hx-swap="none"
      >
        {/* Subject line (email only) */}
        {message.channel === "email" && (
          <div class="mb-sm">
            <div class="text-xs text-muted mb-xs">Subject</div>
            <input
              type="text"
              name="subject_line"
              value={message.subject_line || ""}
              class="input"
              style="width: 100%; font-weight: 600"
            />
          </div>
        )}

        {/* Message body */}
        <div class="mb-sm">
          <div class="text-xs text-muted mb-xs">Message</div>
          <textarea
            name="final_content"
            class="input"
            style="width: 100%; min-height: 300px; resize: vertical; line-height: 1.7; white-space: pre-wrap"
          >{content.trim()}</textarea>
        </div>

        {/* Prompt (collapsible, for regeneration) */}
        <details class="mb-sm" style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-xs)">
          <summary class="text-xs text-muted" style="cursor: pointer">
            View / edit prompt
          </summary>
          <textarea
            name="prompt"
            class="input font-mono"
            style="width: 100%; min-height: 150px; resize: vertical; margin-top: var(--space-xs); font-size: 12px"
          >{(message.prompt || "").trim()}</textarea>
        </details>
      </form>

      {/* Actions */}
      <div class="flex items-center justify-between">
        <div class="flex gap-xs">
          <button
            class="btn btn-sm"
            hx-post={`/messages/${message.id}/regenerate`}
            hx-target="#message-content"
            hx-swap="outerHTML"
            hx-include="#draft-form"
          >
            ↻ Regenerate
          </button>
          <div x-data={`{ showTones: false }`} style="position: relative">
            <button class="btn btn-sm" type="button" x-on:click="showTones = !showTones">
              🎯 Adjust tone
            </button>
            <div x-show="showTones" {...{"x-on:click.outside": "showTones = false"}} style="position: absolute; top: 100%; left: 0; background: var(--color-bg-card); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-xs); z-index: 10; display: flex; gap: 4px;">
              {(["professional", "warm", "direct", "casual"] as const).map((t) => (
                <button
                  class="badge badge-green"
                  style="cursor: pointer"
                  hx-post={`/messages/${message.id}/generate`}
                  hx-target="#message-content"
                  hx-swap="outerHTML"
                  hx-include="#draft-form"
                  hx-vals={`{"tone": "${t}"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div class="flex gap-xs">
          <button
            class="btn btn-sm"
            hx-put={`/messages/${message.id}`}
            hx-include="#draft-form"
            hx-swap="none"
          >
            Save draft
          </button>
          <button
            class="btn btn-sm btn-primary"
            x-data
            x-on:click={`
              const form = document.getElementById('draft-form');
              const content = form.querySelector('[name=final_content]').value;
              const subject = form.querySelector('[name=subject_line]')?.value || '';
              const prompt = form.querySelector('[name=prompt]')?.value || '';
              const full = subject ? 'Subject: ' + subject + '\\n\\n' + content : content;

              // Save edits first, then complete
              const formData = new FormData();
              formData.append('final_content', content);
              if (subject) formData.append('subject_line', subject);
              if (prompt) formData.append('prompt', prompt);

              fetch('/messages/${message.id}', { method: 'PUT', body: formData })
                .then(() => {
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(full).then(() => {
                      fetch('/messages/${message.id}/complete', { method: 'POST', headers: { 'HX-Request': 'true' } })
                        .then(() => htmx.ajax('GET', '/messages', { target: '#canvas', swap: 'innerHTML' }));
                    });
                  } else {
                    // Clipboard not available — show copyable textarea
                    const fallback = document.getElementById('clipboard-fallback');
                    if (fallback) {
                      fallback.innerHTML = '<div class=\"card\" style=\"margin-top: var(--space-sm)\"><div class=\"text-xs text-muted mb-xs\">Clipboard not available. Copy manually:</div><textarea readonly style=\"width: 100%; min-height: 150px; font-size: 13px\">' + full.replace(/</g, '&lt;') + '</textarea><button class=\"btn btn-sm\" onclick=\"this.previousElementSibling.select()\">Select all</button></div>';
                    }
                    fetch('/messages/${message.id}/complete', { method: 'POST', headers: { 'HX-Request': 'true' } });
                  }
                });
            `}
          >
            ✓ Complete & copy
          </button>
        </div>
      </div>

      {/* Clipboard fallback area */}
      <div id="clipboard-fallback"></div>
    </div>
  );
}

export function MessageErrorCard({ error, message }: { error: string; message?: Message }) {
  return (
    <div class="card" id="message-content">
      <div class="text-sm" style="color: var(--visma-coral); margin-bottom: var(--space-sm)">
        {error}
      </div>
      {message && (
        <div class="flex gap-xs">
          <button
            class="btn btn-sm"
            hx-get={`/messages/${message.id}`}
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            ← Back to compose
          </button>
        </div>
      )}
    </div>
  );
}
