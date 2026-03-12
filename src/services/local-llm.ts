/**
 * LLM-powered query understanding, filter parsing, and entity briefings.
 * Uses the LLM provider abstraction (default: LM Studio for PII privacy).
 * Falls back to regex if provider is unavailable.
 */

import type { QueryUnderstanding, ConversationTurn, FilterCriteria } from "../types/index.ts";
import { getProvider } from "./llm-provider.ts";

// --- Convenience wrapper ---

async function isAvailable(): Promise<boolean> {
  return getProvider().isAvailable();
}

async function complete(
  messages: { role: string; content: string }[],
  options?: { maxTokens?: number; temperature?: number; jsonSchema?: object; timeout?: number },
): Promise<string | null> {
  return getProvider().complete({ messages, ...options });
}

// --- Conversation history (in-memory, per session) ---

const sessions = new Map<string, { turns: ConversationTurn[]; lastAccess: number }>();
const MAX_TURNS = 5;
const SESSION_TTL = 30 * 60 * 1000;

export function getHistory(sessionId: string): ConversationTurn[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  session.lastAccess = Date.now();
  return session.turns;
}

export function addTurn(sessionId: string, turn: ConversationTurn): void {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { turns: [], lastAccess: Date.now() };
    sessions.set(sessionId, session);
  }
  session.lastAccess = Date.now();
  session.turns.push(turn);
  if (session.turns.length > MAX_TURNS * 2) {
    session.turns = session.turns.slice(-MAX_TURNS * 2);
  }
}

// Cleanup expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// --- Intent classification JSON schema ---

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string" },
    entities: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        domain: { type: "string" },
        industry: { type: "string" },
        country: { type: "string" },
        days: { type: "number" },
        limit: { type: "number" },
        listName: { type: "string" },
        slug: { type: "string" },
      },
      additionalProperties: false,
    },
    confidence: { type: "number" },
    resolvedFromContext: { type: "boolean" },
  },
  required: ["intent", "entities", "confidence", "resolvedFromContext"],
  additionalProperties: false,
};

// --- System prompt for intent classification ---

const SYSTEM_PROMPT = `You are an intent classifier for a contact intelligence system. Given a user message, classify the intent and extract entities.

Available intents:
- dashboard: overview, stats, how are we doing
- companies: list companies, show all companies
- company: show a specific company (needs name)
- contacts: list contacts, show all contacts, "who works at [company]?" (needs company name in entities)
- contact: show a specific contact (needs name or email)
- articles: top articles, what's being read
- views: page views, most viewed
- surveys: survey results, maturity scores
- engagement: who's engaged, hot leads
- dimensions: survey dimensions for a company, breakdown
- timeline: timeline for a company, activity over time
- article_trend: trend for a specific article
- lists: show lists, segments
- list: show a specific list (needs listName)
- research: research a company, deep dive (needs name)
- enrich: enrich contacts, look up everyone
- sync: run a sync, refresh data, pull latest data, run full sync
- sync_status: show sync status, when was last sync, sync log
- help: help, what can you do
- lookup: ambiguous person/company reference (needs name or email)
- unknown: cannot determine intent

Context resolution rules:
- Pronouns like "them", "they", "it", "their", "that company", "that person" should resolve from conversation history
- After viewing a company: "who works there?" = contacts intent for that company
- After viewing a company: "how are their surveys?" = dimensions intent for that company
- After viewing a contact: "where do they work?" = company intent for that contact's company

Entity fields (include only those that apply):
- name: company or contact name (a person's full name or a company name, NOT a description)
- email: email address (must contain @)
- domain: website domain (e.g., "visma.com")
- industry: industry category (e.g., "Software", "Healthcare", "Financial Services")
- country: country name (e.g., "Norway", "Sweden", "Netherlands")
- days: time filter as an INTEGER number of days ("this week" = 7, "this month" = 30, "last 3 days" = 3)
- limit: number of results as an INTEGER (e.g., "top 5" = 5)
- listName: name of a specific list
- slug: article slug

IMPORTANT: days and limit MUST be numbers, not strings. Only include entity fields you are confident about.

Respond with ONLY a JSON object:
{"intent": "...", "entities": {...}, "confidence": 0.0-1.0, "resolvedFromContext": false}`;

// --- Main entry point: intent classification ---

export async function understandQuery(
  message: string,
  history: ConversationTurn[] = [],
): Promise<QueryUnderstanding> {
  if (!(await isAvailable())) {
    return regexFallback(message);
  }

  const contextMessages: { role: string; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  const recentHistory = history.slice(-6);
  for (const turn of recentHistory) {
    contextMessages.push({
      role: turn.role,
      content:
        turn.role === "assistant"
          ? `[Showed ${turn.intent || "result"}${turn.entityName ? ` for ${turn.entityName}` : ""}${turn.entityType ? ` (${turn.entityType})` : ""}]: ${turn.content}`
          : turn.content,
    });
  }

  contextMessages.push({ role: "user", content: message });

  const raw = await complete(contextMessages, {
    maxTokens: 200,
    temperature: 0.1,
    jsonSchema: INTENT_SCHEMA,
    timeout: 10000,
  });
  if (!raw) {
    return regexFallback(message);
  }

  try {
    const parsed = JSON.parse(raw);
    const validIntents = [
      "dashboard", "companies", "company", "contacts", "contact",
      "articles", "views", "surveys", "engagement", "dimensions",
      "timeline", "article_trend", "lists", "list", "research",
      "enrich", "sync", "sync_status", "help", "lookup", "unknown",
    ];

    if (!validIntents.includes(parsed.intent)) {
      parsed.intent = "unknown";
    }

    if (typeof parsed.confidence === "number" && parsed.confidence < 0.4) {
      parsed.intent = "unknown";
    }

    const entities = parsed.entities || {};
    if (entities.days !== undefined) {
      const n = Number(entities.days);
      entities.days = Number.isFinite(n) ? n : undefined;
    }
    if (entities.limit !== undefined) {
      const n = Number(entities.limit);
      entities.limit = Number.isFinite(n) ? n : undefined;
    }

    return {
      intent: parsed.intent || "unknown",
      entities,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      resolvedFromContext: parsed.resolvedFromContext === true,
    };
  } catch {
    console.warn("Failed to parse LLM JSON response:", raw);
    return regexFallback(message);
  }
}

// --- NL-to-filter parsing (G3) ---

const FILTER_SYSTEM_PROMPT = `You are a filter parser for a contact intelligence system. Given a natural language description of a contact list, extract filter criteria as JSON.

Available filter fields:
- industry: string — company industry (e.g. "SaaS", "Healthcare", "Financial Services")
- country: string — company country (e.g. "Norway", "Sweden")
- tag: string — contact or company tag
- min_engagement: number — minimum engagement score (integer)
- has_survey: boolean — has completed any survey
- read_section: string — has read articles in a section ("explore", "learn", "blog")
- completed_survey: string — has completed a specific survey (kebab-case slug, e.g. "ai-maturity", "ai-pulse")
- min_score: number — minimum survey score (range 1-5)
- max_score: number — maximum survey score (range 1-5)
- active_days: number — was active within the last N days

Only include fields that are clearly mentioned. Respond with ONLY a JSON object containing the matching fields.
Example: {"industry": "software", "min_score": 3, "read_section": "explore"}`;

export async function parseListFilter(input: string): Promise<FilterCriteria | null> {
  if (!(await isAvailable())) return null;

  const raw = await complete(
    [
      { role: "system", content: FILTER_SYSTEM_PROMPT },
      { role: "user", content: input },
    ],
    { maxTokens: 300, temperature: 0.3, timeout: 15000 },
  );
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const criteria: FilterCriteria = {};
    if (typeof parsed.industry === "string") criteria.industry = parsed.industry;
    if (typeof parsed.country === "string") criteria.country = parsed.country;
    if (typeof parsed.tag === "string") criteria.tag = parsed.tag;
    if (typeof parsed.min_engagement === "number") criteria.min_engagement = parsed.min_engagement;
    if (parsed.has_survey === true) criteria.has_survey = true;
    if (typeof parsed.read_section === "string") criteria.read_section = parsed.read_section;
    if (typeof parsed.completed_survey === "string") criteria.completed_survey = parsed.completed_survey;
    if (typeof parsed.min_score === "number") criteria.min_score = parsed.min_score;
    if (typeof parsed.max_score === "number") criteria.max_score = parsed.max_score;
    if (typeof parsed.active_days === "number") criteria.active_days = parsed.active_days;
    return Object.keys(criteria).length > 0 ? criteria : null;
  } catch {
    console.warn("Failed to parse filter JSON from LLM:", raw);
    return null;
  }
}

/** Generate a human-readable description from filter criteria */
export function generateListDescription(criteria: FilterCriteria): string {
  const parts: string[] = [];
  if (criteria.industry) parts.push(`in the ${criteria.industry} industry`);
  if (criteria.country) parts.push(`based in ${criteria.country}`);
  if (criteria.tag) parts.push(`tagged "${criteria.tag}"`);
  if (criteria.min_engagement) parts.push(`with engagement score above ${criteria.min_engagement}`);
  if (criteria.has_survey) parts.push(`who completed a survey`);
  if (criteria.read_section) parts.push(`who read ${criteria.read_section} articles`);
  if (criteria.completed_survey) parts.push(`who completed the "${criteria.completed_survey}" survey`);
  if (criteria.min_score) parts.push(`with score above ${criteria.min_score}`);
  if (criteria.max_score) parts.push(`with score below ${criteria.max_score}`);
  if (criteria.active_days) parts.push(`active in the last ${criteria.active_days} days`);
  if (parts.length === 0) return "All contacts";
  return "Contacts " + parts.join(", ");
}

// --- G4: Entity briefings ---

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
    { maxTokens: 300, temperature: 0.3, timeout: 15000 },
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
    { maxTokens: 800, temperature: 0.3, timeout: 15000 },
  );
}

// --- Regex fallback (extracted from original normalizeMessage) ---

export function regexFallback(msg: string): QueryUnderstanding {
  const lower = msg.toLowerCase().trim();
  const slashStripped = lower.startsWith("/") ? lower.slice(1) : lower;

  // Dashboard
  if (/\b(dashboard|overview|summary|statistics|numbers|how are we doing|what.s going on)\b/.test(slashStripped)) {
    return { intent: "dashboard", entities: {}, confidence: 0.9 };
  }

  // Enrich
  if (/\b(enrich|enrichment|look ?up everyone|enrich contacts)\b/.test(slashStripped)) {
    return { intent: "enrich", entities: {}, confidence: 0.9 };
  }

  // Sync status (check before sync action)
  if (/\b(sync status|sync log|when.* last sync|last sync)\b/.test(slashStripped)) {
    return { intent: "sync_status", entities: {}, confidence: 0.9 };
  }

  // Sync action
  if (/\b(sync|synchronize|refresh data|pull data|update data|fetch data|run.* sync|full sync)\b/.test(slashStripped)) {
    return { intent: "sync", entities: {}, confidence: 0.9 };
  }

  // Research
  const researchPatterns = [
    /^research\s+(.+)/,
    /(?:deep dive|deep research|profile)\s+(?:on\s+)?(.+)/,
  ];
  for (const pat of researchPatterns) {
    const m = slashStripped.match(pat);
    if (m?.[1]) {
      const name = m[1].replace(/[?.!]+$/, "").trim();
      if (name.length > 0) return { intent: "research", entities: { name }, confidence: 0.85 };
    }
  }

  // Articles
  if (/\b(articles|top articles|what.s being read|popular content|most read)\b/.test(slashStripped) &&
      !/\b(about|on|for)\s+\S/.test(slashStripped)) {
    return { intent: "articles", entities: {}, confidence: 0.9 };
  }

  // Views
  if (/\b(views|page views|top pages|most viewed|traffic)\b/.test(slashStripped) &&
      !/\b(about|on|for)\s+\S/.test(slashStripped)) {
    return { intent: "views", entities: {}, confidence: 0.9 };
  }

  // Surveys
  if (/\b(surveys|survey results|maturity|survey scores)\b/.test(slashStripped)) {
    return { intent: "surveys", entities: {}, confidence: 0.9 };
  }

  // Engagement
  if (/\b(engagement|who.s engaged|hot leads|rising|most active)\b/.test(slashStripped)) {
    return { intent: "engagement", entities: {}, confidence: 0.9 };
  }

  // Lists
  if (/\b(lists|my lists|segments|segmentation|all lists)\b/.test(slashStripped) &&
      !/\b(about|on|for)\s+\S/.test(slashStripped)) {
    return { intent: "lists", entities: {}, confidence: 0.9 };
  }

  // Help
  if (/\b(help|commands|what can you do|how does this work)\b/.test(slashStripped)) {
    return { intent: "help", entities: {}, confidence: 0.9 };
  }

  // Companies list
  if (/\b(companies|all companies|list companies|which companies)\b/.test(slashStripped) &&
      !/\b(about|on|for|at)\s+\S/.test(slashStripped)) {
    return { intent: "companies", entities: {}, confidence: 0.9 };
  }

  // Contacts list
  if (/\b(contacts|all contacts|all people|list contacts|who do we have|everyone)\b/.test(slashStripped) &&
      !/\b(about|on|for)\s+\S/.test(slashStripped)) {
    return { intent: "contacts", entities: {}, confidence: 0.9 };
  }

  // Lookup patterns
  const lookupPatterns = [
    /(?:who is|who's)\s+(.+)/,
    /(?:what do we (?:have|know) (?:on|about))\s+(.+)/,
    /(?:tell me about|info (?:on|about)|details (?:on|about|for))\s+(.+)/,
    /(?:look ?up|find|search for)\s+(.+)/,
    /(?:show|open|display)\s+(.+?)(?:\s+profile)?$/,
  ];
  for (const pat of lookupPatterns) {
    const m = slashStripped.match(pat);
    if (m?.[1]) {
      const name = m[1].replace(/[?.!]+$/, "").trim();
      if (name.length > 0) {
        const entities: QueryUnderstanding["entities"] = {};
        if (name.includes("@")) {
          entities.email = name;
        } else {
          entities.name = name;
        }
        return { intent: "lookup", entities, confidence: 0.7 };
      }
    }
  }

  // Exact slash commands
  if (slashStripped === "dashboard" || slashStripped === "stats" || slashStripped === "home") {
    return { intent: "dashboard", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "companies") return { intent: "companies", entities: {}, confidence: 1.0 };
  if (slashStripped === "contacts") return { intent: "contacts", entities: {}, confidence: 1.0 };
  if (slashStripped === "articles") return { intent: "articles", entities: {}, confidence: 1.0 };
  if (slashStripped === "views") return { intent: "views", entities: {}, confidence: 1.0 };
  if (slashStripped === "surveys") return { intent: "surveys", entities: {}, confidence: 1.0 };
  if (slashStripped === "engagement") return { intent: "engagement", entities: {}, confidence: 1.0 };
  if (slashStripped === "lists") return { intent: "lists", entities: {}, confidence: 1.0 };
  if (slashStripped === "enrich") return { intent: "enrich", entities: {}, confidence: 1.0 };
  if (slashStripped === "sync") return { intent: "sync", entities: {}, confidence: 1.0 };
  if (slashStripped === "sync status") return { intent: "sync_status", entities: {}, confidence: 1.0 };
  if (slashStripped === "help" || slashStripped === "?") return { intent: "help", entities: {}, confidence: 1.0 };
  if (slashStripped.startsWith("company ")) {
    return { intent: "company", entities: { name: slashStripped.slice(8).trim() }, confidence: 1.0 };
  }
  if (slashStripped.startsWith("contact ")) {
    const q = slashStripped.slice(8).trim();
    return { intent: "contact", entities: q.includes("@") ? { email: q } : { name: q }, confidence: 1.0 };
  }
  if (slashStripped.startsWith("list ") && slashStripped !== "list companies" && slashStripped !== "list contacts") {
    return { intent: "list", entities: { listName: slashStripped.slice(5).trim() }, confidence: 1.0 };
  }
  if (slashStripped.startsWith("research ")) {
    return { intent: "research", entities: { name: slashStripped.slice(9).trim() }, confidence: 1.0 };
  }

  return { intent: "unknown", entities: {}, confidence: 0 };
}
