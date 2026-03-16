/**
 * LLM-powered entity briefings and activity summaries.
 * Extracted from local-llm.ts to keep concerns separated.
 */

import { complete, isAvailable } from "./local-llm.ts";

/** Summarize recent activities into 1-2 sentences (inline summary) */
export async function summarizeActivities(
  activities: { activity_type: string; title: string | null; occurred_at: string }[],
  entityName: string,
): Promise<string | null> {
  if (!(await isAvailable()) || activities.length === 0) return null;

  const activityText = activities
    .slice(0, 15)
    .map((a) => `${a.activity_type}: ${a.title || "(no title)"} (${a.occurred_at.slice(0, 10)})`)
    .join("\n");

  return complete(
    [
      {
        role: "system",
        content: "Summarize this CRM activity for " + entityName + " into 1-2 factual sentences. No hype, no superlatives. Focus on engagement patterns and what they are interested in.",
      },
      { role: "user", content: activityText },
    ],
    { maxTokens: 300, temperature: 0.3, timeout: 60000 },
  );
}

/** Generate a full structured briefing for a company or contact */
export async function generateBriefing(context: {
  entityType: "company" | "contact";
  entityName: string;
  metadata?: string;
  activities: { activity_type: string; title: string | null; detail: string | null; occurred_at: string }[];
  surveyInfo?: string;
  contacts?: string;
}): Promise<string | null> {
  if (!(await isAvailable())) return null;

  const activityText = context.activities
    .map((a) => `[${a.occurred_at.slice(0, 10)}] ${a.activity_type}: ${a.title || "(no title)"}${a.detail ? " — " + a.detail.slice(0, 100) : ""}`)
    .join("\n");

  const sections = [
    context.metadata ? `Metadata: ${context.metadata}` : "",
    `Activities (${context.activities.length} total):\n${activityText}`,
    context.surveyInfo ? `Survey data: ${context.surveyInfo}` : "",
    context.contacts ? `Contacts: ${context.contacts}` : "",
  ].filter(Boolean).join("\n\n");

  return complete(
    [
      {
        role: "system",
        content: `You are a CRM briefing generator. Write a structured briefing for ${context.entityType} "${context.entityName}".

Format with these sections (use ## headings):
## Engagement Summary
1-2 sentences on overall engagement level and trend.
## Content Interests
What they have been reading, which topics.
## Survey Insights
Scores, maturity level, strengths/gaps (if applicable, otherwise say "No survey data").
${context.entityType === "company" ? "## Key Contacts\nWho is most active.\n" : ""}## Recommendation
One suggested next action.

Be factual, concise, no hype. Northern European professional tone.`,
      },
      { role: "user", content: sections },
    ],
    { maxTokens: 800, temperature: 0.3, timeout: 60000 },
  );
}
