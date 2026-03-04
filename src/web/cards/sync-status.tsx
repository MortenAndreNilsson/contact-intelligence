interface SyncLogEntry {
  id: string;
  source: string;
  last_sync_at: string;
  records_processed: number;
  records_created: number;
  records_skipped: number;
  status: string;
  error_message: string | null;
}

interface SyncCounts {
  cms_events: number;
  survey_responses: number;
}

function formatDate(ts: string | null): string {
  if (!ts) return "Never";
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "success" ? "badge-turquoise" : "badge-coral";
  return <span class={`badge ${cls}`}>{status}</span>;
}

export function SyncStatusCard({
  logs,
  counts,
  running,
}: {
  logs: SyncLogEntry[];
  counts: SyncCounts;
  running?: string | null;
}) {
  const eventLog = logs.find((l) => l.source === "cms_events");
  const surveyLog = logs.find((l) => l.source === "survey_responses");
  const materializeLog = logs.find((l) => l.source === "materialize");
  const enrichLog = logs.find((l) => l.source === "people_enrichment");

  return (
    <div>
      <div class="card">
        <div class="card-label mb-xs">Data Sync</div>
        <div class="section-title">Sync Status</div>

        <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr)">
          <div class="stat-box">
            <div class="stat-value" style="font-size: 1.5rem">{counts.cms_events}</div>
            <div class="stat-label">CMS Events</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" style="font-size: 1.5rem">{counts.survey_responses}</div>
            <div class="stat-label">Survey Responses</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" style="font-size: 1.5rem; color: var(--visma-turquoise)">
              {counts.cms_events + counts.survey_responses}
            </div>
            <div class="stat-label">Total Raw Records</div>
          </div>
        </div>
      </div>

      {/* Sync All */}
      <div class="card" style="text-align: center">
        <button
          class="chat-submit"
          style="padding: 0.6rem 1.5rem; font-size: 0.85rem"
          hx-post="/sync/all"
          hx-target="#canvas"
          hx-swap="innerHTML"
          hx-disabled-elt="this"
        >
          <span class="btn-label">Sync All</span>
          <span class="btn-loading"><span class="spinner" style="margin-right: 0.4rem"></span> Running pipeline...</span>
        </button>
        <div class="text-xs text-muted" style="margin-top: 0.5rem">Events → Surveys → Materialize → Enrich</div>
      </div>

      {/* Sync Sources */}
      <div class="card">
        <div class="card-label mb-xs">Sync Sources</div>

        {/* CMS Events */}
        <div class="table-row">
          <div class="flex-1">
            <div style="font-weight: 600">CMS Events</div>
            <div class="text-xs text-muted">
              Last sync: {formatDate(eventLog?.last_sync_at ?? null)}
              {eventLog ? ` · ${eventLog.records_created} created, ${eventLog.records_skipped} skipped` : ""}
            </div>
          </div>
          <div class="flex gap-xs items-center">
            {eventLog && <StatusBadge status={eventLog.status} />}
            <button
              class="chat-submit"
              style="padding: 0.4rem 0.8rem; font-size: 0.75rem"
              hx-post="/sync/events"
              hx-target="#canvas"
              hx-swap="innerHTML"
              hx-disabled-elt="this"
            >
              <span class="btn-label">Sync</span>
              <span class="btn-loading"><span class="spinner"></span></span>
            </button>
          </div>
        </div>

        {/* Survey Responses */}
        <div class="table-row">
          <div class="flex-1">
            <div style="font-weight: 600">Survey Responses</div>
            <div class="text-xs text-muted">
              ET-CMS (primary) + Lighthouse View (legacy)
            </div>
            <div class="text-xs text-muted">
              Last sync: {formatDate(surveyLog?.last_sync_at ?? null)}
              {surveyLog ? ` · ${surveyLog.records_created} created, ${surveyLog.records_skipped} skipped` : ""}
            </div>
          </div>
          <div class="flex gap-xs items-center">
            {surveyLog && <StatusBadge status={surveyLog.status} />}
            <button
              class="chat-submit"
              style="padding: 0.4rem 0.8rem; font-size: 0.75rem"
              hx-post="/sync/surveys"
              hx-target="#canvas"
              hx-swap="innerHTML"
              hx-disabled-elt="this"
            >
              <span class="btn-label">Sync</span>
              <span class="btn-loading"><span class="spinner"></span></span>
            </button>
          </div>
        </div>

        {/* Materialize */}
        <div class="table-row">
          <div class="flex-1">
            <div style="font-weight: 600">Materialize (Identity Resolution)</div>
            <div class="text-xs text-muted">
              Last run: {formatDate(materializeLog?.last_sync_at ?? null)}
              {materializeLog ? ` · ${materializeLog.records_created} records created` : ""}
            </div>
          </div>
          <div class="flex gap-xs items-center">
            {materializeLog && <StatusBadge status={materializeLog.status} />}
            <button
              class="chat-submit"
              style="padding: 0.4rem 0.8rem; font-size: 0.75rem"
              hx-post="/sync/materialize"
              hx-target="#canvas"
              hx-swap="innerHTML"
              hx-disabled-elt="this"
            >
              <span class="btn-label">Run</span>
              <span class="btn-loading"><span class="spinner"></span></span>
            </button>
          </div>
        </div>

        {/* People Enrichment */}
        <div class="table-row">
          <div class="flex-1">
            <div style="font-weight: 600">People Enrichment (Discovery Engine)</div>
            <div class="text-xs text-muted">
              Last run: {formatDate(enrichLog?.last_sync_at ?? null)}
              {enrichLog ? ` · ${enrichLog.records_created} enriched, ${enrichLog.records_skipped} failed` : ""}
            </div>
          </div>
          <div class="flex gap-xs items-center">
            {enrichLog && <StatusBadge status={enrichLog.status} />}
            <button
              class="chat-submit"
              style="padding: 0.4rem 0.8rem; font-size: 0.75rem"
              hx-post="/sync/enrich"
              hx-target="#canvas"
              hx-swap="innerHTML"
              hx-disabled-elt="this"
            >
              <span class="btn-label">Enrich</span>
              <span class="btn-loading"><span class="spinner"></span></span>
            </button>
          </div>
        </div>
      </div>

      {/* Error details */}
      {logs.filter((l) => l.error_message).length > 0 && (
        <div class="card">
          <div class="card-label mb-xs" style="color: var(--visma-coral)">Recent Errors</div>
          {logs
            .filter((l) => l.error_message)
            .map((l) => (
              <div class="table-row">
                <div>
                  <div class="text-sm" style="font-weight: 600; color: var(--visma-coral)">{l.source}</div>
                  <div class="text-xs text-muted">{formatDate(l.last_sync_at)}</div>
                  <div class="text-xs" style="color: var(--visma-coral); margin-top: 0.25rem">{l.error_message}</div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
