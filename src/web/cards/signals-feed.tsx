import type { Signal, SignalType } from "../../types/index.ts";

const signalIcons: Record<SignalType, string> = {
  new_survey: "\ud83d\udcca",
  score_change: "\ud83d\udcc8",
  content_binge: "\ud83d\udcda",
  cooling_off: "\u2744\ufe0f",
  new_person: "\ud83d\udc64",
};

const signalColors: Record<SignalType, string> = {
  new_survey: "var(--visma-turquoise)",
  score_change: "var(--visma-lime)",
  content_binge: "var(--visma-purple, #8b5cf6)",
  cooling_off: "var(--visma-coral)",
  new_person: "var(--visma-turquoise)",
};

export function SignalsFeedCard({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return (
      <div class="card">
        <div class="card-label mb-xs">Signals</div>
        <div class="text-sm text-muted">No new signals. Run /sync to check for updates.</div>
      </div>
    );
  }

  return (
    <div class="card">
      <div class="card-label mb-xs">Signals ({signals.length} active)</div>
      {signals.map((s) => (
        <div class="table-row" style="align-items: flex-start">
          <div style={`width: 24px; color: ${signalColors[s.signal_type]}`}>
            {signalIcons[s.signal_type]}
          </div>
          <div class="flex-1">
            <div class="text-sm" style="font-weight: 500">{s.title}</div>
            {s.detail && s.signal_type === "score_change" && (
              <div class="text-xs text-muted">{s.detail}</div>
            )}
            <div class="text-xs text-muted">{s.detected_at.slice(0, 10)}</div>
          </div>
          <button
            class="text-xs"
            style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 2px 6px"
            hx-post={`/signals/${s.id}/dismiss`}
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
