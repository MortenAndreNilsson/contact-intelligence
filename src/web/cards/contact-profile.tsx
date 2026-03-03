import type { ContactWithDetails, ActivityWithNames } from "../../types/index.ts";
import { ActivityTabs } from "./activity-tabs.tsx";

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

export function ContactProfileCard({
  contact,
  activities,
}: {
  contact: ContactWithDetails;
  activities: ActivityWithNames[];
}) {
  return (
    <div>
      <div class="card">
        <div class="flex items-center justify-between mb-sm">
          <div>
            <div class="card-title">{contact.name || contact.email}</div>
            <div class="text-sm text-secondary">
              {[contact.job_title, contact.email].filter(Boolean).join(" · ")}
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
            {(!contact.name || !contact.job_title) && (
              <button
                class="chat-submit"
                style="padding: 0.35rem 0.7rem; font-size: 0.7rem"
                hx-post={`/contacts/${contact.id}/enrich`}
                hx-target="#canvas"
                hx-swap="innerHTML"
              >
                Lookup
              </button>
            )}
            {consentBadge(contact.consent_status)}
          </div>
        </div>

        <div class="flex gap-xs" style="margin-top: var(--space-xs)">
          <span class="badge badge-green">{contact.source}</span>
          {contact.tags.map((tag) => (
            <span class="badge badge-turquoise">{tag}</span>
          ))}
        </div>

        {contact.notes && (
          <div class="text-sm text-secondary mt-sm" style="line-height: 1.6">
            {contact.notes}
          </div>
        )}

        {/* Add note form */}
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
            placeholder="Add a note..."
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
