import type { ContactWithDetails, ActivityWithNames } from "../../types/index.ts";
import { ActivityTabs } from "./activity-tabs.tsx";
import { InlineSummary } from "./briefing-card.tsx";

function consentBadge(status: string) {
  switch (status) {
    case "given":
      return <span class="badge badge-lime">Consent Given</span>;
    case "withdrawn":
      return <span class="badge badge-coral">Consent Withdrawn</span>;
    default:
      return <span class="badge badge-orange">Consent Unknown</span>;
  }
}

function editableField(
  contactId: string,
  field: string,
  value: string | null,
  placeholder: string,
) {
  const safeValue = (value || "").replace(/'/g, "\\'");
  return (
    <span
      x-data={`{ editing: false, value: '${safeValue}' }`}
      class="editable-field"
    >
      <span
        x-show="!editing"
        x-on:click="editing = true; $nextTick(() => $refs.input.focus())"
        class="editable-display"
      >
        <span x-text={`value || '${placeholder}'`} style={!value ? "color: var(--color-text-muted); font-style: italic" : undefined}></span>
        <span class="edit-icon">&#9998;</span>
      </span>
      <form
        x-show="editing"
        x-cloak
        style="display: inline"
        hx-patch={`/contacts/${contactId}`}
        hx-target="#canvas"
        hx-swap="innerHTML"
      >
        <input
          type="text"
          name={field}
          x-ref="input"
          x-bind:value="value"
          x-on:blur="editing = false; $el.closest('form').requestSubmit()"
          x-on:keydown="if ($event.key === 'Escape') { editing = false; }"
          class="editable-input"
          placeholder={placeholder}
        />
      </form>
    </span>
  );
}

function tagEditor(contactId: string, tags: string[]) {
  const tagsJson = JSON.stringify(tags).replace(/'/g, "\\'");
  return (
    <div
      x-data={`{ tags: JSON.parse('${tagsJson}'), newTag: '' }`}
      style="display: inline-flex; gap: 0.35rem; align-items: center; flex-wrap: wrap"
    >
      <template x-for="(tag, i) in tags" x-bind:key="i">
        <span class="badge badge-turquoise" style="display: inline-flex; align-items: center; gap: 0.3rem">
          <span x-text="tag"></span>
          <span
            x-on:click={`tags.splice(i, 1); $nextTick(() => {
              const form = $el.closest('[x-data]').querySelector('.tag-save-form');
              form.querySelector('input[name=tags]').value = JSON.stringify(tags);
              form.requestSubmit();
            })`}
            style="cursor: pointer; opacity: 0.7; font-size: 0.8em"
          >&times;</span>
        </span>
      </template>
      <form
        class="tag-save-form"
        style="display: inline-flex; gap: 0.25rem"
        hx-patch={`/contacts/${contactId}`}
        hx-target="#canvas"
        hx-swap="innerHTML"

      >
        <input type="hidden" name="tags" x-bind:value="JSON.stringify(tags)" />
        <input
          type="text"
          x-model="newTag"
          x-on:keydown={`if ($event.key === 'Enter') { $event.preventDefault(); if (newTag.trim()) { tags.push(newTag.trim()); newTag = '';
            $el.closest('form').querySelector('input[name=tags]').value = JSON.stringify(tags);
            $el.closest('form').requestSubmit(); } }`}
          placeholder="+ tag"
          class="editable-input"
          style="width: 5rem; font-size: 0.7rem"
        />
      </form>
    </div>
  );
}

export function ContactProfileCard({
  contact,
  activities,
  summary,
}: {
  contact: ContactWithDetails;
  activities: ActivityWithNames[];
  summary?: string | null;
}) {
  return (
    <div>
      <div class="card">
        <div class="flex items-center justify-between mb-sm">
          <div>
            <div class="card-title">{contact.name || contact.email}</div>
            <div class="text-sm text-secondary" style="display: flex; align-items: center; gap: 0.25rem">
              {editableField(contact.id, "job_title", contact.job_title, "Job title")}
              {contact.job_title && <span style="color: var(--color-text-muted)"> · </span>}
              <span>{contact.email}</span>
            </div>
            {contact.company_name && (
              <div
                class="text-sm mt-sm"
                style="cursor: pointer; color: var(--color-accent)"
                hx-get={`/companies/${contact.company_id}`}
                hx-target="#canvas"
                hx-swap="innerHTML"
              >
                {contact.company_name}
              </div>
            )}
          </div>
          <div class="flex gap-xs items-center">
            <button
              class="period-btn"
              style="font-size: 0.7rem; padding: 0.3rem 0.6rem"
              hx-post={`/contacts/${contact.id}/enrich`}
              hx-target="#canvas"
              hx-swap="innerHTML"
              hx-disabled-elt="this"
            >
              <span class="btn-label">Re-enrich</span>
              <span class="btn-loading"><span class="spinner"></span></span>
            </button>
            {consentBadge(contact.consent_status)}
          </div>
        </div>

        <div class="flex gap-xs items-center" style="margin-top: var(--space-xs)">
          <span class="badge badge-green">{contact.source}</span>
          {tagEditor(contact.id, contact.tags)}
        </div>

        <div style="margin-top: var(--space-sm)">
          <InlineSummary summary={summary ?? null} />
        </div>

        {/* Briefing button */}
        <div style="margin-bottom: var(--space-sm)">
          <button
            class="period-btn"
            style="font-size: 0.75rem; padding: 0.35rem 0.75rem"
            hx-post={`/contacts/${contact.id}/briefing`}
            hx-target="#canvas"
            hx-swap="innerHTML"
            hx-disabled-elt="this"
          >
            <span class="btn-label">Get Briefing</span>
            <span class="btn-loading"><span class="spinner"></span></span>
          </button>
        </div>

        {/* Notes — editable */}
        <div class="mt-sm">
          <div class="card-label mb-xs" style="font-size: 0.65rem">Notes</div>
          {editableField(contact.id, "notes", contact.notes, "Click to add notes...")}
        </div>

        {/* Add note activity */}
        <form
          class="flex gap-xs mt-sm"
          hx-post={`/contacts/${contact.id}/note`}
          hx-target="#canvas"
          hx-swap="innerHTML"
        >
          <input
            type="text"
            name="note"
            class="chat-input"
            placeholder="Add a note to timeline..."
            style="font-size: 0.85rem; padding: 0.5rem 0.75rem"
            required
          />
          <button
            type="submit"
            class="chat-submit"
            style="padding: 0.5rem 0.75rem; font-size: 0.8rem; white-space: nowrap"
          >
            Add
          </button>
        </form>
      </div>

      {activities.length > 0 && (
        <ActivityTabs activities={activities} />
      )}
    </div>
  );
}
