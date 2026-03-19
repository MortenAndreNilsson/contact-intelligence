import type { JourneyOverview, JourneyStage } from "../../types/index.ts";

interface CompanyInStage {
  id: string;
  name: string;
  contact_count: number;
}

const stageLabels: Record<JourneyStage, string> = {
  exploring: "Exploring",
  assessing: "Assessing",
  training: "Training",
  scaling: "Scaling",
  self_sustaining: "Self-Sustaining",
};

const stageColors: Record<JourneyStage, string> = {
  exploring: "var(--color-text-muted)",
  assessing: "var(--visma-turquoise)",
  training: "var(--visma-lime)",
  scaling: "var(--visma-purple, #8b5cf6)",
  self_sustaining: "var(--visma-gold, #f59e0b)",
};

export function JourneyOverviewCard({
  overview,
  companiesByStage,
}: {
  overview: JourneyOverview;
  companiesByStage: Record<string, CompanyInStage[]>;
}) {
  const stages: JourneyStage[] = ["exploring", "assessing", "training", "scaling", "self_sustaining"];

  return (
    <div class="card">
      <div class="card-label mb-xs">AI Maturity Journey</div>
      <div class="stat-grid" style="grid-template-columns: repeat(5, 1fr); margin-bottom: 12px">
        {stages.map((s) => (
          <div class="stat-box">
            <div class="stat-value" style={`font-size: 1.5rem; color: ${stageColors[s]}`}>{overview[s]}</div>
            <div class="stat-label">{stageLabels[s]}</div>
          </div>
        ))}
      </div>

      {stages.map((s) => {
        const companies = companiesByStage[s] || [];
        if (companies.length === 0) return null;
        return (
          <div class="mb-sm">
            <div class="text-xs" style={`color: ${stageColors[s]}; font-weight: 600; margin-bottom: 4px`}>
              {stageLabels[s]} ({companies.length})
            </div>
            {companies.map((c) => (
              <div
                class="table-row"
                style="cursor: pointer"
                hx-post="/chat"
                hx-target="#canvas"
                hx-swap="innerHTML"
                hx-vals={`{"message": "journey ${c.name}"}`}
              >
                <div class="flex-1 text-sm">{c.name}</div>
                <div class="text-xs text-muted">{c.contact_count} contacts</div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
