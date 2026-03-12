# G-Refactor: LM Studio Integration & Chat Dispatch

Design spec for refactoring the LLM integration layer before adding G6 (Journey Model) and G7 (Signals).

---

## Problem

`local-llm.ts` (574 lines) and `chat.tsx` (590 lines) have grown organically through G1-G4. They work, but adding more intents (G6 journey queries, G7 signal queries) will compound existing issues:

1. **21 intents in one classifier prompt** — approaching saturation for a 4B model. Every new intent degrades accuracy for all others.
2. **19-case switch statement** in chat.tsx — the entity-lookup pattern (search → 0/1/many → render) is copy-pasted 6 times across `company`, `contact`, `contacts`, `dimensions`, `timeline`, `lookup`.
3. **Two LM Studio call functions** — `callLMStudio()` (JSON schema) and `callLMStudioFreeform()` (freeform) share 80% boilerplate (URL, headers, fetch, error handling, timeout).
4. **LM Studio is hardcoded** — when the system goes hybrid/cloud, the LLM interface needs to be swappable without rewriting every caller. LM Studio stays default (privacy boundary for PII), but the abstraction should exist.
5. **No category routing** — all 21 intents compete equally in a flat list. "show dashboard" and "run full sync" have nothing in common but share the same classifier.

---

## Goals

- Make adding a new intent a 1-file change (register handler + optional system prompt update)
- Extract duplicated entity-lookup into a shared helper
- Reduce classifier prompt to ~10 category-level intents, with sub-classification where needed
- Unify LM Studio calls into one parameterized function
- Abstract LLM interface so LM Studio is one implementation, not the only one
- Keep regex fallback working (it's the safety net)
- Preserve all existing behavior — this is a refactor, not a feature change

---

## Design

### 1. Unified LLM call function

Replace `callLMStudio()` and `callLMStudioFreeform()` with one function:

```typescript
// src/services/local-llm.ts

interface LLMCallOptions {
  messages: { role: string; content: string }[];
  maxTokens?: number;       // default 200
  temperature?: number;     // default 0.1
  jsonSchema?: object;      // if provided, uses structured output
  timeout?: number;         // default 10000
}

async function callLLM(options: LLMCallOptions): Promise<string | null>
```

All callers (`understandQuery`, `parseListFilter`, `summarizeActivities`, `generateBriefing`) use this single function. The `jsonSchema` parameter controls whether the response format is structured or freeform.

### 2. Category-based intent routing

Replace the flat 21-intent classifier with a two-level system:

**Level 1 — Category classifier** (always runs, ~8 categories):

| Category | Sub-intents it covers |
|----------|----------------------|
| `view_data` | dashboard, articles, views, surveys, engagement, lists |
| `entity_lookup` | company, contact, contacts, dimensions, timeline, list, lookup |
| `action` | sync, enrich, research |
| `admin` | sync_status, help |
| `unknown` | fallback |

The category prompt is short and reliable. The model picks one of 5 categories, not 21 intents.

**Level 2 — Sub-classification** (only for categories that need it):

- `view_data` → determine which data view (dashboard/articles/views/surveys/engagement/lists)
- `entity_lookup` → determine entity type (company/contact/list) + extract name/email
- `action` → determine which action (sync/enrich/research) + extract target

Level 2 can be a second LLM call with a focused prompt, OR simple keyword matching (most sub-intents within a category are easily distinguishable by keywords).

**Hybrid approach**: Use the category LLM call, then keyword/regex for sub-classification within the category. This keeps LLM calls to 1 per message (no latency increase) while making the prompt much simpler.

```typescript
// Pseudocode
const category = await classifyCategory(message, history); // LLM call — 5 categories
const intent = resolveSubIntent(category, message);        // regex — fast, deterministic
const result = await dispatch(intent, entities);            // handler
```

### 3. Entity lookup helper

Extract the repeated pattern into a shared function:

```typescript
// src/web/helpers/entity-resolver.ts

interface ResolveResult<T> {
  type: "found" | "multiple" | "not_found";
  item?: T;
  items?: T[];
}

async function resolveCompany(query: string): Promise<ResolveResult<CompanyWithStats>>
async function resolveContact(query: string): Promise<ResolveResult<ContactWithDetails>>

// Renders the appropriate card for each case
async function resolveAndRenderCompany(query: string): Promise<DispatchResult>
async function resolveAndRenderContact(query: string | undefined, email: string | undefined): Promise<DispatchResult>
```

The `company`, `contact`, `dimensions`, `timeline`, `research`, and `lookup` handlers all call these instead of duplicating the search → disambiguate → render logic.

### 4. Intent handler registry

Replace the switch statement with a handler map:

```typescript
// src/web/routes/chat-handlers.ts

interface IntentHandler {
  (entities: QueryUnderstanding["entities"]): Promise<DispatchResult>;
}

const handlers: Record<string, IntentHandler> = {
  dashboard: handleDashboard,
  companies: handleCompanies,
  company: handleCompany,
  // ... etc
};

// In chat.tsx:
const handler = handlers[understanding.intent] || handlers.unknown;
const result = await handler(understanding.entities);
```

New intents (G6: `journey`, G7: `signals`) just add an entry to the map + a handler function. No switch statement to maintain.

### 5. LLM provider abstraction

Light interface that LM Studio implements. Not over-engineered — just enough to swap later.

```typescript
// src/services/llm-provider.ts

interface LLMProvider {
  isAvailable(): Promise<boolean>;
  complete(options: LLMCallOptions): Promise<string | null>;
}

// src/services/providers/lm-studio.ts — current implementation
// src/services/providers/gemini.ts — future, for cloud deployment
// src/services/providers/mock.ts — for testing

let provider: LLMProvider = new LMStudioProvider();

export function setProvider(p: LLMProvider) { provider = p; }
export function getProvider(): LLMProvider { return provider; }
```

All callers (`understandQuery`, `parseListFilter`, `summarizeActivities`, `generateBriefing`) go through `getProvider().complete(...)` instead of calling `callLMStudio()` directly.

Default is LM Studio (privacy boundary). Can be swapped via env var:
```env
LLM_PROVIDER=lm-studio   # default — local, PII stays on machine
LLM_PROVIDER=gemini       # cloud — for hosted deployment
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/services/local-llm.ts` | Merge call functions, extract category classifier, keep as LM Studio provider |
| `src/services/llm-provider.ts` | **New** — provider interface + getter/setter |
| `src/services/providers/lm-studio.ts` | **New** — LM Studio implementation (extracted from local-llm.ts) |
| `src/web/routes/chat.tsx` | Replace switch with handler registry, use entity resolver |
| `src/web/helpers/entity-resolver.ts` | **New** — shared entity lookup + disambiguation |
| `src/web/routes/chat-handlers.ts` | **New** — individual intent handler functions |

### Files NOT changed

- `src/types/index.ts` — QueryUnderstanding, DispatchResult stay the same
- All card components — no UI changes
- All service files — no business logic changes
- Routes other than chat.tsx — no changes

---

## Migration Strategy

Refactor in 3 PRs to keep each reviewable:

### PR 1: Unify LLM calls + provider abstraction
- Merge `callLMStudio()` and `callLMStudioFreeform()` into `callLLM()`
- Create `llm-provider.ts` interface
- Extract `providers/lm-studio.ts`
- All existing callers updated to use new interface
- **Test**: all existing chat/filter/briefing behavior unchanged

### PR 2: Entity resolver + handler registry
- Extract `entity-resolver.ts`
- Extract `chat-handlers.ts` with handler map
- Simplify `chat.tsx` to ~50 lines (session management + dispatch)
- **Test**: all 21 intents still work, same responses

### PR 3: Category-based routing
- Replace flat 21-intent prompt with category classifier
- Add keyword sub-classification within categories
- Update regex fallback to use same category structure
- **Test**: chat accuracy maintained or improved

---

## What This Enables

After the refactor, adding G6 journey intents looks like:

```typescript
// chat-handlers.ts — just add:
handlers.journey = handleJourney;

// entity-resolver.ts — already has resolveCompany()
async function handleJourney(entities): Promise<DispatchResult> {
  const company = await resolveCompany(entities.name);
  if (company.type !== "found") return entityNotFound(entities.name);
  const journey = await getCompanyJourney(company.item.id);
  return { html: <JourneyCard company={company.item} journey={journey} />, summary: "..." };
}
```

One file touched. No prompt changes needed (journey falls under `entity_lookup` category).

---

## Skipped (by design)

- **Conversation summarization** — the 10-turn hard cap is fine for now. Revisit if multi-turn quality degrades
- **Intent caching** — not worth the complexity at current query volume
- **Streaming responses** — LM Studio supports it but HTMX swap model doesn't benefit
- **Multiple LLM providers simultaneously** — one provider at a time is enough. No router needed
