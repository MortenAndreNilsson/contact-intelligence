import type { ActivityWithNames } from "../../types/index.ts";

function typeColor(type: string): string {
  switch (type) {
    case "survey_completed": return "var(--visma-turquoise)";
    case "note_added": return "var(--visma-orange)";
    case "article_view": return "var(--visma-lime)";
    case "outreach_email": return "var(--visma-blue, #3B82F6)";
    case "outreach_slack": return "var(--visma-purple, #8B5CF6)";
    case "outreach_linkedin": return "var(--visma-blue, #3B82F6)";
    default: return "var(--color-text-muted)";
  }
}

function typeBadgeClass(type: string): string {
  switch (type) {
    case "survey_completed": return "badge badge-turquoise";
    case "note_added": return "badge badge-orange";
    case "article_view": return "badge badge-lime";
    case "outreach_email": return "badge badge-green";
    case "outreach_slack": return "badge badge-green";
    case "outreach_linkedin": return "badge badge-green";
    default: return "badge badge-green";
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case "survey_completed": return "Survey";
    case "note_added": return "Note";
    case "article_view": return "Article";
    case "outreach_email": return "Email sent";
    case "outreach_slack": return "Slack sent";
    case "outreach_linkedin": return "LinkedIn sent";
    default: return type.replace(/_/g, " ");
  }
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "—";
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function ActivityTimeline({ activities }: { activities: ActivityWithNames[] }) {
  if (activities.length === 0) {
    return <div class="text-sm text-muted" style="padding: var(--space-xs) 0">No activities recorded.</div>;
  }

  return (
    <div>
      {activities.map((a) => (
        <div class="timeline-item">
          <div class="timeline-dot" style={`background: ${typeColor(a.activity_type)}`}></div>
          <div class="flex-1">
            <div class="flex items-center justify-between gap-xs">
              <span class={typeBadgeClass(a.activity_type)}>{typeLabel(a.activity_type)}</span>
              <span class="text-xs text-muted font-mono">{relativeTime(a.occurred_at)}</span>
            </div>
            <div class="text-sm mt-sm" style="line-height: 1.5">
              {a.title || "—"}
            </div>
            {(a.contact_name || a.company_name) && (
              <div class="text-xs text-muted" style="margin-top: 2px">
                {[a.contact_name, a.company_name].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
