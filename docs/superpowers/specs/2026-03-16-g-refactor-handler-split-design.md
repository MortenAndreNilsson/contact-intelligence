# G-Refactor: Handler Split & Briefing Extraction

Decompose `chat-handlers.tsx` (481 lines) and extract briefing generators from `local-llm.ts` (519 lines) to prepare for G6/G7 intent additions.

## Context

The original G-Refactor spec (2026-03-12) had 5 items. All were implemented:
1. Unified LLM call — `llm-provider.ts` + `providers/lm-studio.ts`
2. Category-based routing — 5-category L1 classifier + keyword L2
3. Entity resolver — `entity-resolver.tsx`
4. Handler registry — `chat-handlers.tsx` with handlers map
5. Provider abstraction — `LLMProvider` interface

What remains: the handler implementations and briefing generators are concentrated in two large files. Adding G6 journey or G7 signal handlers means touching a 481-line file.

## Design

### Handler split by category

Split `chat-handlers.tsx` into 4 handler files grouped by the category classifier:

| File | Handlers | ~Lines |
|------|----------|--------|
| `handlers/view-handlers.tsx` | dashboard, articles, views, surveys, engagement | 70 |
| `handlers/entity-handlers.tsx` | company, contact, contacts, dimensions, timeline, lookup, briefing | 200 |
| `handlers/action-handlers.tsx` | sync, enrich, research | 130 |
| `handlers/admin-handlers.tsx` | help, sync_status, unknown + HelpCard | 80 |
| `chat-handlers.tsx` (slim) | registry map + dispatchIntent + re-exports | 50 |

Each handler file exports named handler functions. The `IntentHandler` type stays in `chat-handlers.tsx`.

### Briefing extraction

Move `summarizeActivities()` and `generateBriefing()` from `local-llm.ts` to `services/llm-briefings.ts`. Export `complete` and `isAvailable` from `local-llm.ts` so briefings can use the same convenience wrappers.

### File changes

| File | Change |
|------|--------|
| `src/web/routes/handlers/view-handlers.tsx` | NEW |
| `src/web/routes/handlers/entity-handlers.tsx` | NEW |
| `src/web/routes/handlers/action-handlers.tsx` | NEW |
| `src/web/routes/handlers/admin-handlers.tsx` | NEW |
| `src/web/routes/chat-handlers.tsx` | Slim down to registry only |
| `src/services/llm-briefings.ts` | NEW — extracted from local-llm.ts |
| `src/services/local-llm.ts` | Remove briefing functions, export complete/isAvailable |
| `src/web/routes/chat.tsx` | Unchanged |
| `src/web/helpers/entity-resolver.tsx` | Unchanged |
| `src/services/llm-provider.ts` | Unchanged |

### Adding new intents after this refactor

G6 journey: create `handlers/journey-handlers.tsx`, add entry to registry.
G7 signals: create `handlers/signal-handlers.tsx`, add entry to registry.
One file created + one line added to registry per feature.

## Constraints

- Pure decomposition — no behavior changes
- All 21 intents continue to work identically
- No UI changes
- Regex fallback stays in local-llm.ts (tightly coupled to classifier)
