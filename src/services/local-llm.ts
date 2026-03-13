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

// --- Category-based intent classification ---
// Level 1: LLM classifies into 5 categories (simpler prompt, more reliable)
// Level 2: Keyword/regex sub-classifies within category (fast, deterministic)

const CATEGORY_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string" },
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
  required: ["category", "entities", "confidence", "resolvedFromContext"],
  additionalProperties: false,
};

const CATEGORY_PROMPT = `You are a query classifier for a contact intelligence CRM. Classify the user message into one of these categories and extract entities.

Categories:
- view_data: user wants to see data (dashboard, articles, page views, surveys, engagement scores, lists overview)
- entity_lookup: user wants to see a specific company, contact, list, or asks about a named entity ("show Visma", "who is Hanne?", "who works at Spotify?", "timeline for Acme", "survey dimensions for Visma")
- action: user wants to DO something (run sync, enrich contacts, research a company)
- admin: help, commands, sync status
- unknown: cannot determine

Context resolution rules:
- Pronouns ("them", "they", "it", "that company") resolve from conversation history
- After viewing a company: "who works there?" = entity_lookup for that company
- After viewing a company: "how are their surveys?" = entity_lookup for that company
- After viewing a contact: "where do they work?" = entity_lookup for that contact's company

Entity fields (include only those that apply):
- name: company or contact name (NOT a description)
- email: email address (must contain @)
- domain: website domain
- industry: industry category
- country: country name
- days: time filter as INTEGER days ("this week"=7, "this month"=30)
- limit: number of results as INTEGER ("top 5"=5)
- listName: name of a specific list
- slug: article slug

IMPORTANT: days and limit MUST be numbers. Only include entity fields you are confident about.

Respond with ONLY a JSON object:
{"category": "...", "entities": {...}, "confidence": 0.0-1.0, "resolvedFromContext": false}`;

// --- Level 2: keyword sub-classification within categories ---

function subClassifyViewData(msg: string): string {
  const lower = msg.toLowerCase();
  if (/\b(dashboard|overview|summary|stats|numbers|how are we doing)\b/.test(lower)) return "dashboard";
  if (/\b(articles|top articles|what.s being read|popular content|most read)\b/.test(lower)) return "articles";
  if (/\b(views|page views|top pages|most viewed|traffic)\b/.test(lower)) return "views";
  if (/\b(surveys|survey results|maturity|survey scores)\b/.test(lower)) return "surveys";
  if (/\b(engagement|who.s engaged|hot leads|rising|most active)\b/.test(lower)) return "engagement";
  if (/\b(lists|my lists|segments|segmentation|all lists)\b/.test(lower)) return "lists";
  return "dashboard"; // safe default for view_data
}

function subClassifyEntityLookup(msg: string, entities: QueryUnderstanding["entities"]): string {
  const lower = msg.toLowerCase();
  if (entities.listName || /\b(list\s)\b/.test(lower)) return "list";
  if (/\b(who works|contacts at|employees|people at|team at)\b/.test(lower)) return "contacts";
  if (/\b(dimensions?|breakdown|survey scores? for|survey.* for)\b/.test(lower)) return "dimensions";
  if (/\b(timeline|activity over time|history for)\b/.test(lower)) return "timeline";
  if (entities.email) return "contact";
  // If we have a name, default to "lookup" (ambiguous — handler tries contact then company)
  if (entities.name) return "lookup";
  return "company";
}

function subClassifyAction(msg: string): string {
  const lower = msg.toLowerCase();
  if (/\b(briefing|brief me|brief on|get briefing)\b/.test(lower)) return "briefing";
  if (/\b(research|deep dive|deep research|profile)\b/.test(lower)) return "research";
  if (/\b(enrich|enrichment|look ?up everyone)\b/.test(lower)) return "enrich";
  if (/\b(sync|synchronize|refresh|pull data|update data|fetch data)\b/.test(lower)) return "sync";
  return "sync"; // safe default
}

function subClassifyAdmin(msg: string): string {
  const lower = msg.toLowerCase();
  if (/\b(sync status|sync log|when.* last sync|last sync)\b/.test(lower)) return "sync_status";
  return "help";
}

// --- Main entry point: intent classification ---

export async function understandQuery(
  message: string,
  history: ConversationTurn[] = [],
): Promise<QueryUnderstanding> {
  if (!(await isAvailable())) {
    return regexFallback(message);
  }

  const contextMessages: { role: string; content: string }[] = [
    { role: "system", content: CATEGORY_PROMPT },
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
    jsonSchema: CATEGORY_SCHEMA,
    timeout: 30000,
  });
  if (!raw) {
    return regexFallback(message);
  }

  try {
    const parsed = JSON.parse(raw);
    const validCategories = ["view_data", "entity_lookup", "action", "admin", "unknown"];
    const category = validCategories.includes(parsed.category) ? parsed.category : "unknown";

    if (typeof parsed.confidence === "number" && parsed.confidence < 0.4) {
      return regexFallback(message);
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

    // Level 2: sub-classify within category
    let intent: string;
    switch (category) {
      case "view_data": intent = subClassifyViewData(message); break;
      case "entity_lookup": intent = subClassifyEntityLookup(message, entities); break;
      case "action": intent = subClassifyAction(message); break;
      case "admin": intent = subClassifyAdmin(message); break;
      default: intent = "unknown";
    }

    return {
      intent,
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
    { maxTokens: 300, temperature: 0.3, timeout: 60000 },
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
  if (slashStripped.startsWith("briefing ")) {
    return { intent: "briefing", entities: { name: slashStripped.slice(9).trim() }, confidence: 1.0 };
  }

  return { intent: "unknown", entities: {}, confidence: 0 };
}
