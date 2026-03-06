/**
 * LM Studio integration for intent classification.
 * Replaces regex-based normalizeMessage() with LLM-powered understanding.
 * Falls back to regex if LM Studio is unavailable.
 */

import type { QueryUnderstanding, ConversationTurn } from "../types/index.ts";

const baseUrl = Bun.env.LMSTUDIO_BASE_URL || "http://localhost:1234";
const defaultModel = Bun.env.LMSTUDIO_MODEL || "gemma-3-4b-it";

// --- Availability check with 30s cache ---

let availableCache: { value: boolean; expires: number } | null = null;

export async function isAvailable(): Promise<boolean> {
  if (availableCache && Date.now() < availableCache.expires) {
    return availableCache.value;
  }
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(1000),
    });
    const ok = res.ok;
    availableCache = { value: ok, expires: Date.now() + 30_000 };
    return ok;
  } catch {
    availableCache = { value: false, expires: Date.now() + 30_000 };
    return false;
  }
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

// --- LM Studio call ---

async function callLMStudio(
  messages: { role: string; content: string }[],
): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: defaultModel,
        messages,
        temperature: 0.1,
        max_tokens: 200,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "intent_classification",
            strict: true,
            schema: {
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
            },
          },
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`LM Studio error (${res.status})`);
      return null;
    }

    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.warn("LM Studio call failed:", (err as Error).message);
    return null;
  }
}

// --- Main entry point ---

export async function understandQuery(
  message: string,
  history: ConversationTurn[] = [],
): Promise<QueryUnderstanding> {
  if (!(await isAvailable())) {
    return regexFallback(message);
  }

  // Build conversation context from recent history
  const contextMessages: { role: string; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // Add last few turns for context resolution
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

  const raw = await callLMStudio(contextMessages);
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

    // Coerce days/limit to numbers if the model returned strings
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
    console.warn("Failed to parse LM Studio JSON response:", raw);
    return regexFallback(message);
  }
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

  // Exact slash commands that might come through
  if (slashStripped === "dashboard" || slashStripped === "stats" || slashStripped === "home") {
    return { intent: "dashboard", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "companies") {
    return { intent: "companies", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "contacts") {
    return { intent: "contacts", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "articles") {
    return { intent: "articles", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "views") {
    return { intent: "views", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "surveys") {
    return { intent: "surveys", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "engagement") {
    return { intent: "engagement", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "lists") {
    return { intent: "lists", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "enrich") {
    return { intent: "enrich", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "sync") {
    return { intent: "sync", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "sync status") {
    return { intent: "sync_status", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "help" || slashStripped === "?") {
    return { intent: "help", entities: {}, confidence: 1.0 };
  }
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
