/**
 * Intent handler registry for the chat dispatch.
 * Handler implementations live in handlers/*.tsx.
 * Adding a new intent = add handler in the right file + one entry here.
 */

import type { QueryUnderstanding, DispatchResult } from "../../types/index.ts";

// --- Handler type (imported by handler files) ---

export type IntentHandler = (entities: QueryUnderstanding["entities"]) => Promise<DispatchResult>;

// --- Import handlers by category ---

import { handleDashboard, handleArticles, handleViews, handleSurveys, handleEngagement } from "./handlers/view-handlers.tsx";
import { handleCompany, handleContact, handleContacts, handleDimensions, handleTimeline, handleLookup, handleBriefing } from "./handlers/entity-handlers.tsx";
import { handleSync, handleEnrich, handleResearch } from "./handlers/action-handlers.tsx";
import { handleHelp, handleSyncStatus, handleRefreshSummaries, handleUnknown } from "./handlers/admin-handlers.tsx";
import { handleJourneyOverview, handleJourneyCompany, handleJourneySet, handleJourneySnapshot, handleFluencySet } from "./handlers/journey-handlers.tsx";
import { handleSignals } from "./handlers/signal-handlers.tsx";
import { handleMemorySearch, handleEmbedArticles, handleEmbedNotebooks, handleEmbeddingStats, handleBackup, handleNotebook } from "./handlers/memory-handlers.tsx";

// Re-export HelpCard for chat.tsx
export { HelpCard } from "./handlers/admin-handlers.tsx";

// --- Lists handler (uses its own service, doesn't fit neatly into entity-resolver) ---

import { ListsCard } from "../cards/lists-card.tsx";
import { ListDetailCard } from "../cards/list-detail-card.tsx";
import { listLists, getList, getEffectiveMembers } from "../../services/lists.ts";

const handleLists: IntentHandler = async () => {
  const lists = await listLists();
  return { html: <ListsCard lists={lists} />, summary: `Showed ${lists.length} lists` };
};

const handleList: IntentHandler = async (entities) => {
  const query = entities.listName || entities.name;
  if (!query) {
    const lists = await listLists();
    return { html: <ListsCard lists={lists} />, summary: `Showed ${lists.length} lists` };
  }
  const allLists = await listLists();
  const matched = allLists.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()));
  if (matched.length === 1) {
    const list = await getList(matched[0]!.id);
    if (list) {
      const members = await getEffectiveMembers(list);
      return {
        html: <ListDetailCard list={list} members={members} />,
        summary: `Showed list "${list.name}" with ${members.length} members`,
        entityId: list.id, entityName: list.name, entityType: "list",
      };
    }
  }
  if (matched.length > 1) {
    return { html: <ListsCard lists={matched} />, summary: `Found ${matched.length} lists matching "${query}"` };
  }
  return { html: <div class="card"><div class="text-sm text-muted">No list found matching "{query}".</div></div>, summary: `No list found for "${query}"` };
};

// --- Handler registry ---

export const handlers: Record<string, IntentHandler> = {
  // view_data
  dashboard: handleDashboard,
  articles: handleArticles,
  views: handleViews,
  surveys: handleSurveys,
  engagement: handleEngagement,
  // entity_lookup
  company: handleCompany,
  contact: handleContact,
  contacts: handleContacts,
  dimensions: handleDimensions,
  timeline: handleTimeline,
  lookup: handleLookup,
  briefing: handleBriefing,
  lists: handleLists,
  list: handleList,
  // action
  sync: handleSync,
  enrich: handleEnrich,
  research: handleResearch,
  // journey (G6)
  journey_overview: handleJourneyOverview,
  journey_company: handleJourneyCompany,
  journey_set: handleJourneySet,
  journey_snapshot: handleJourneySnapshot,
  fluency_set: handleFluencySet,
  // signals (G7)
  signals: handleSignals,
  // memory (G5)
  memory_search: handleMemorySearch,
  embed_articles: handleEmbedArticles,
  embed_notebooks: handleEmbedNotebooks,
  embedding_stats: handleEmbeddingStats,
  backup: handleBackup,
  notebook: handleNotebook,
  // admin
  refresh_summaries: handleRefreshSummaries,
  help: handleHelp,
  sync_status: handleSyncStatus,
  unknown: handleUnknown,
};

/** Dispatch an intent to the appropriate handler */
export async function dispatchIntent(understanding: QueryUnderstanding): Promise<DispatchResult> {
  const handler = handlers[understanding.intent] || handlers.unknown!;
  return handler(understanding.entities);
}
