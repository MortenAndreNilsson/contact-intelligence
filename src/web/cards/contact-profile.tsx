import type { ContactWithDetails, ActivityWithNames } from "../../types/index.ts";
import { ActivityTimeline } from "./activity-timeline.tsx";

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
          <div>{consentBadge(contact.consent_status)}</div>
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
      </div>

      {activities.length > 0 && (
        <div class="card">
          <div class="card-label mb-xs">Activity Timeline</div>
          <ActivityTimeline activities={activities} />
        </div>
      )}
    </div>
  );
}
