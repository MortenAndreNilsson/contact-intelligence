import type { Message, MessageChannel, MessageTone } from "../../types/index.ts";
import type { Contact } from "../../types/index.ts";
import type { CompanyWithStats } from "../../types/index.ts";

interface ComposeProps {
  message?: Message;
  contact?: Contact | null;
  company?: CompanyWithStats | null;
  recipientContext?: string;
  builtPrompt?: string;
}

const CHANNELS: { value: MessageChannel; icon: string; label: string }[] = [
  { value: "email", icon: "✉", label: "Email" },
  { value: "slack", icon: "💬", label: "Slack" },
  { value: "linkedin", icon: "🔗", label: "LinkedIn" },
];

const TONES: { value: MessageTone; label: string }[] = [
  { value: "professional", label: "Professional" },
  { value: "warm", label: "Warm" },
  { value: "direct", label: "Direct" },
  { value: "casual", label: "Casual" },
];

export function MessageComposeCard({
  message,
  contact,
  company,
  recipientContext,
  builtPrompt,
}: ComposeProps) {
  const currentChannel = message?.channel || "email";
  const currentTone = message?.tone || "professional";
  const currentProvider = message?.provider || "lmstudio";
  const refs = message?.content_references || [];
  const refsInitJson = JSON.stringify({ refs, newUrl: "" });

  return (
    <div class="card" id="message-content">
      <div class="card-label mb-sm">
        {message ? "Edit Message" : "New Message"}
      </div>

      <form
        hx-post={message ? `/messages/${message.id}/generate` : "/messages"}
        hx-target="#message-content"
        hx-swap="outerHTML"
      >
        {/* Channel selector */}
        <div class="mb-sm">
          <div class="text-xs text-muted mb-xs">Channel</div>
          <div class="flex gap-xs">
            {CHANNELS.map((ch) => (
              <label
                class={`badge ${ch.value === currentChannel ? "badge-turquoise" : "badge-green"}`}
                style="cursor: pointer"
              >
                <input
                  type="radio"
                  name="channel"
                  value={ch.value}
                  checked={ch.value === currentChannel}
                  style="display: none"
                />
                {ch.icon} {ch.label}
              </label>
            ))}
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-sm)">
          {/* Left column */}
          <div>
            <div class="mb-sm">
              <div class="text-xs text-muted mb-xs">Recipient</div>
              <input
                type="text"
                name="recipient_name"
                value={message?.recipient_name || contact?.name || ""}
                placeholder="Name"
                class="input"
                style="width: 100%"
              />
            </div>

            <div class="mb-sm">
              <div class="text-xs text-muted mb-xs">Recipient context</div>
              <textarea
                name="recipient_context"
                placeholder="Role, company, what you know about them..."
                class="input"
                style="width: 100%; min-height: 80px; resize: vertical"
              >{(message?.recipient_context || recipientContext || "").trim()}</textarea>
            </div>
          </div>

          {/* Right column */}
          <div>
            <div class="mb-sm">
              <div class="text-xs text-muted mb-xs">Tone</div>
              <div class="flex gap-xs" style="flex-wrap: wrap">
                {TONES.map((t) => (
                  <label
                    class={`badge ${t.value === currentTone ? "badge-turquoise" : "badge-green"}`}
                    style="cursor: pointer"
                  >
                    <input
                      type="radio"
                      name="tone"
                      value={t.value}
                      checked={t.value === currentTone}
                      style="display: none"
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </div>

            <div class="mb-sm">
              <div class="text-xs text-muted mb-xs">Objective</div>
              <input
                type="text"
                name="objective"
                value={message?.objective || ""}
                placeholder="e.g. Follow up on AI governance article, suggest a call"
                class="input"
                style="width: 100%"
              />
            </div>

            <div class="mb-sm">
              <div class="text-xs text-muted mb-xs">Content references</div>
              <div
                x-data={refsInitJson}
              >
                <template x-for="(ref, i) in refs" x-bind:key="i">
                  <div class="flex items-center gap-xs mb-xs">
                    <span class="text-xs" x-text="ref.url || ref.title || ref.snippet" style="flex: 1; overflow: hidden; text-overflow: ellipsis"></span>
                    <span x-on:click="refs.splice(i, 1)" style="cursor: pointer; opacity: 0.5">&times;</span>
                  </div>
                </template>
                <div class="flex gap-xs">
                  <input
                    type="text"
                    x-model="newUrl"
                    placeholder="Paste URL or snippet"
                    class="input"
                    style="flex: 1"
                    {...{"x-on:keydown.enter.prevent": "if (newUrl.trim()) { refs.push({ url: newUrl.trim() }); newUrl = ''; }"}}
                  />
                  <button
                    type="button"
                    class="btn btn-sm"
                    x-on:click="if (newUrl.trim()) { refs.push({ url: newUrl.trim() }); newUrl = ''; }"
                  >
                    +
                  </button>
                </div>
                <input type="hidden" name="content_references" x-bind:value="JSON.stringify(refs)" />
              </div>
            </div>

            <div class="mb-sm">
              <div class="text-xs text-muted mb-xs">Additional notes</div>
              <textarea
                name="additional_context"
                placeholder="Meeting notes, background info..."
                class="input"
                style="width: 100%; min-height: 60px; resize: vertical"
              >{(message?.additional_context || "").trim()}</textarea>
            </div>
          </div>
        </div>

        {/* Advanced: prompt editor */}
        <details class="mb-sm" style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-xs)">
          <summary class="text-xs text-muted" style="cursor: pointer">
            View / edit prompt
          </summary>
          <textarea
            name="prompt"
            class="input font-mono"
            style="width: 100%; min-height: 200px; resize: vertical; margin-top: var(--space-xs); font-size: 12px"
          >{(message?.prompt || builtPrompt || "Prompt will be generated from the fields above.").trim()}</textarea>
        </details>

        {/* Footer */}
        <div class="flex items-center justify-between">
          <div class="flex gap-xs">
            <label class={`badge ${currentProvider === "lmstudio" ? "badge-turquoise" : "badge-green"}`} style="cursor: pointer">
              <input type="radio" name="provider" value="lmstudio" checked={currentProvider === "lmstudio"} style="display: none" />
              LM Studio
            </label>
            <label class={`badge ${currentProvider === "gemini" ? "badge-turquoise" : "badge-green"}`} style="cursor: pointer">
              <input type="radio" name="provider" value="gemini" checked={currentProvider === "gemini"} style="display: none" />
              Gemini
            </label>
          </div>

          <button type="submit" class="btn btn-primary">
            Generate Draft →
          </button>
        </div>

        {/* Hidden fields */}
        {contact && <input type="hidden" name="contact_id" value={contact.id} />}
        {company && <input type="hidden" name="company_id" value={company.id} />}
      </form>
    </div>
  );
}
