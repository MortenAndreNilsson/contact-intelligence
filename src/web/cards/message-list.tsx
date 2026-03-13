import type { Message, MessageChannel } from "../../types/index.ts";

const CHANNEL_ICONS: Record<MessageChannel, string> = {
  email: "✉",
  slack: "💬",
  linkedin: "🔗",
};

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
  return `${Math.floor(days / 30)}mo ago`;
}

export function MessageListCard({
  messages,
  activeChannel,
}: {
  messages: Message[];
  activeChannel?: string;
}) {
  const channels: (MessageChannel | "all")[] = ["all", "email", "slack", "linkedin"];

  return (
    <div class="card">
      <div class="flex items-center justify-between mb-sm">
        <div class="card-label">Messages ({messages.length})</div>
        <button
          class="btn btn-sm btn-primary"
          hx-get="/messages/new"
          hx-target="#canvas"
          hx-swap="innerHTML"
        >
          + New message
        </button>
      </div>

      <div class="flex gap-xs mb-sm">
        {channels.map((ch) => (
          <button
            class={`badge ${(!activeChannel && ch === "all") || activeChannel === ch ? "badge-turquoise" : "badge-green"}`}
            hx-get={`/messages${ch === "all" ? "" : `?channel=${ch}`}`}
            hx-target="#canvas"
            hx-swap="innerHTML"
            style="cursor: pointer"
          >
            {ch === "all" ? "All" : `${CHANNEL_ICONS[ch]} ${ch.charAt(0).toUpperCase() + ch.slice(1)}`}
          </button>
        ))}
      </div>

      {messages.length === 0 ? (
        <div class="empty-state">
          <div class="empty-state-icon">✉</div>
          <div>No messages yet. Create your first one.</div>
        </div>
      ) : (
        <div>
          {messages.map((m) => (
            <div
              class="table-row card-clickable"
              hx-get={`/messages/${m.id}`}
              hx-target="#canvas"
              hx-swap="innerHTML"
            >
              <div style="font-size: 1.2em; width: 2em; text-align: center">
                {CHANNEL_ICONS[m.channel]}
              </div>
              <div class="flex-1">
                <div style="font-weight: 600">
                  {m.title || m.objective || "Untitled message"}
                </div>
                <div class="text-xs text-muted">
                  {m.recipient_name || "No recipient"}
                </div>
              </div>
              <div style="text-align: right">
                <span
                  class={`badge ${m.status === "completed" ? "badge-turquoise" : "badge-orange"}`}
                >
                  {m.status}
                </span>
                <div class="text-xs text-muted" style="margin-top: 2px">
                  {relativeTime(m.updated_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
