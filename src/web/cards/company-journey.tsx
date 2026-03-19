import type { CompanyJourney, JourneyStage, FluencyLevel } from "../../types/index.ts";

const stageLabels: Record<JourneyStage, string> = {
  exploring: "Exploring",
  assessing: "Assessing",
  training: "Training",
  scaling: "Scaling",
  self_sustaining: "Self-Sustaining",
};

const fluencyLabels: Record<FluencyLevel, string> = {
  explorer: "Explorer",
  practitioner: "Practitioner",
  integrator: "Integrator",
  architect: "Architect",
  master: "Master",
};

const fluencyColors: Record<FluencyLevel, string> = {
  explorer: "#6b7280",
  practitioner: "var(--visma-turquoise)",
  integrator: "var(--visma-lime)",
  architect: "var(--visma-purple, #8b5cf6)",
  master: "var(--visma-gold, #f59e0b)",
};

export function CompanyJourneyCard({ journey }: { journey: CompanyJourney }) {
  const levels: FluencyLevel[] = ["explorer", "practitioner", "integrator", "architect", "master"];
  const totalFluency = levels.reduce((sum, l) => sum + journey.fluency_distribution[l], 0);

  return (
    <div class="card">
      <div class="card-label mb-xs">Journey: {journey.company_name}</div>

      {/* Stage badge */}
      <div class="mb-sm">
        <span class="text-xs text-muted">Stage: </span>
        <span class="text-sm" style="font-weight: 600">
          {journey.stage ? stageLabels[journey.stage] : "Not started"}
        </span>
        {journey.stage_override && <span class="text-xs text-muted"> (manual)</span>}
      </div>

      {/* Fluency distribution */}
      <div class="section-title" style="font-size: 0.7rem; margin-bottom: 4px">
        Fluency Levels ({totalFluency} of {journey.total_contacts} contacts)
      </div>
      {totalFluency > 0 ? (
        <div style="display: flex; height: 20px; border-radius: 4px; overflow: hidden; margin-bottom: 12px">
          {levels.map((l) => {
            const count = journey.fluency_distribution[l];
            if (count === 0) return null;
            const pct = (count / totalFluency) * 100;
            return (
              <div
                style={`width: ${pct}%; background: ${fluencyColors[l]}; display: flex; align-items: center; justify-content: center`}
                title={`${fluencyLabels[l]}: ${count}`}
              >
                <span class="text-xs" style="color: white; font-weight: 600">{count}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div class="text-xs text-muted mb-sm">No fluency levels set yet</div>
      )}

      {/* Snapshot history */}
      {journey.snapshots.length > 0 && (
        <div>
          <div class="section-title" style="font-size: 0.7rem; margin-bottom: 4px">
            Maturity Snapshots ({journey.snapshots.length})
          </div>
          {journey.snapshots.slice(0, 5).map((s) => (
            <div class="table-row">
              <div class="text-xs text-muted" style="width: 80px">{String(s.snapshot_date).slice(0, 10)}</div>
              <div class="text-xs flex-1">
                B:{s.beginner_count} D:{s.developing_count} I:{s.intermediate_count} A:{s.advanced_count} L:{s.leader_count}
              </div>
              <div class="text-xs" style="color: var(--visma-turquoise); width: 50px; text-align: right">
                {s.avg_score !== null ? s.avg_score.toFixed(1) : "\u2014"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
