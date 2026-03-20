import type { CompanyWithStats, ContactWithDetails } from "../../types/index.ts";
import type { ActivityWithNames } from "../../types/index.ts";
import { ActivityTabs } from "./activity-tabs.tsx";
import { InlineSummary } from "./briefing-card.tsx";

function editableField(
  companyId: string,
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
        hx-patch={`/companies/${companyId}`}
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

function tagEditor(companyId: string, tags: string[]) {
  const tagsJson = JSON.stringify(tags).replace(/'/g, "\\'");
  return (
    <div
      x-data={`{ tags: JSON.parse('${tagsJson}'), newTag: '' }`}
      class="flex gap-xs items-center"
      style="flex-wrap: wrap; margin-bottom: var(--space-sm)"
    >
      <template x-for="(tag, i) in tags" x-bind:key="i">
        <span class="badge badge-green" style="display: inline-flex; align-items: center; gap: 0.3rem">
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
        hx-patch={`/companies/${companyId}`}
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

export function CompanyProfileCard({
  company,
  contacts,
  activities,
  summary,
}: {
  company: CompanyWithStats;
  contacts: ContactWithDetails[];
  activities: ActivityWithNames[];
  summary?: string | null;
}) {
  const scorePct = company.avg_score ? (company.avg_score / 5) * 100 : 0;

  return (
    <div>
      <div class="card">
        <div class="flex items-center justify-between mb-sm">
          <div style="flex: 1">
            <div class="card-title">{company.name}</div>
            <div class="text-sm text-secondary" style="display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center">
              {company.domain && <span>{company.domain}</span>}
              {company.domain && <span style="color: var(--color-text-muted)"> · </span>}
              {editableField(company.id, "industry", company.industry, "Industry")}
              <span style="color: var(--color-text-muted)"> · </span>
              {editableField(company.id, "size_bucket", company.size_bucket, "Size")}
              <span style="color: var(--color-text-muted)"> · </span>
              {editableField(company.id, "country", company.country, "Country")}
            </div>
          </div>
          <div style="text-align: right">
            <div class="font-mono" style="font-size: 2rem; font-weight: 800; color: var(--visma-green)">
              {company.avg_score ? company.avg_score.toFixed(1) : "—"}
            </div>
            <div class="text-xs text-muted">avg score</div>
          </div>
        </div>

        {company.avg_score && (
          <div class="mb-sm">
            <div class="score-bar">
              <div class="score-bar-fill" style={`width: ${scorePct}%`}></div>
            </div>
          </div>
        )}

        <InlineSummary summary={summary ?? null} entityId={company.id} entityType="company" />

        {tagEditor(company.id, company.tags)}

        {/* Briefing — show stored or offer to generate */}
        {company.briefing ? (
          <div style="margin-bottom: var(--space-sm)">
            <div class="card-label mb-xs" style="font-size: 0.65rem; display: flex; align-items: center; gap: 0.5rem">
              Briefing
              {company.briefing_at && <span class="text-xs text-muted" style="text-transform: none; letter-spacing: 0; font-weight: 400">{new Date(company.briefing_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
              <button
                class="period-btn"
                style="font-size: 0.65rem; padding: 0.2rem 0.5rem; margin-left: auto"
                hx-post={`/companies/${company.id}/briefing`}
                hx-target="#canvas"
                hx-swap="innerHTML"
                hx-disabled-elt="this"
              >
                <span class="btn-label">Refresh</span>
                <span class="btn-loading"><span class="spinner"></span></span>
              </button>
            </div>
            <div class="text-sm text-secondary" style="line-height: 1.7; padding: var(--space-sm); background: var(--color-surface-elevated); border-radius: var(--radius-md); border-left: 3px solid var(--visma-orange); white-space: pre-line">
              {company.briefing}
            </div>
          </div>
        ) : (
          <div style="margin-bottom: var(--space-sm)">
            <button
              class="period-btn"
              style="font-size: 0.75rem; padding: 0.35rem 0.75rem"
              hx-post={`/companies/${company.id}/briefing`}
              hx-target="#canvas"
              hx-swap="innerHTML"
              hx-disabled-elt="this"
            >
              <span class="btn-label">Get Briefing</span>
              <span class="btn-loading"><span class="spinner"></span></span>
            </button>
          </div>
        )}

        {company.description ? (
          <div class="text-sm text-secondary" style="margin-top: var(--space-sm); line-height: 1.7; padding: var(--space-sm); background: var(--color-surface-elevated); border-radius: var(--radius-md); border-left: 3px solid var(--visma-turquoise)">
            {company.description}
          </div>
        ) : (
          <div style="margin-top: var(--space-sm)">
            <button
              class="chat-submit"
              style="font-size: 0.8rem; padding: 0.5rem 1rem; background: var(--color-surface-elevated); border: 1px solid var(--color-border-strong); color: var(--color-text-secondary); cursor: pointer; border-radius: var(--radius-md); transition: all 0.15s"
              hx-post={`/companies/${company.id}/research`}
              hx-target="#canvas"
              hx-swap="innerHTML"
              hx-indicator="closest button"
            >
              <span class="htmx-indicator" style="display:none">Researching...</span>
              <span>Research with Gemini</span>
            </button>
          </div>
        )}

        {/* Notes — editable */}
        <div class="mt-sm">
          <div class="card-label mb-xs" style="font-size: 0.65rem">Notes</div>
          {editableField(company.id, "notes", company.notes, "Click to add notes...")}
        </div>

        {/* Add note activity */}
        <form
          class="flex gap-xs mt-sm"
          hx-post={`/companies/${company.id}/note`}
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

      {contacts.length > 0 && (
        <div class="card">
          <div class="card-label mb-xs">Contacts ({contacts.length})</div>
          {contacts.map((ct) => (
            <div
              class="table-row card-clickable"
              hx-get={`/contacts/${ct.id}`}
              hx-target="#canvas"
              hx-swap="innerHTML"
            >
              <div class="flex-1">
                <div style="font-weight: 600">{ct.name || ct.email}</div>
                <div class="text-xs text-muted">
                  {[ct.job_title, ct.email].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div class="text-xs text-muted font-mono">{ct.activity_count} activities</div>
            </div>
          ))}
        </div>
      )}

      {activities.length > 0 && (
        <ActivityTabs activities={activities} />
      )}
    </div>
  );
}
