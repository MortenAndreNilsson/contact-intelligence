/**
 * Journey + fluency handlers — stage management, snapshots, fluency levels.
 */

import type { IntentHandler } from "../chat-handlers.tsx";
import { JourneyOverviewCard } from "../../cards/journey-overview.tsx";
import { CompanyJourneyCard } from "../../cards/company-journey.tsx";
import {
  getJourneyOverview,
  getCompanyJourney,
  updateJourneyStage,
  createSnapshot,
  setContactFluencyLevel,
} from "../../../services/journey-service.ts";
import { resolveCompany, resolveAndRenderContact, CompanyListFragment } from "../../helpers/entity-resolver.tsx";
import { queryAll } from "../../../db/client.ts";
import type { JourneyStage, FluencyLevel } from "../../../types/index.ts";

export const handleJourneyOverview: IntentHandler = async () => {
  const overview = await getJourneyOverview();

  // Get companies grouped by stage
  const rows = await queryAll<{ id: string; name: string; journey_stage: string; contact_count: number }>(
    `SELECT c.id, c.name, c.journey_stage,
       (SELECT COUNT(*) FROM contacts WHERE company_id = c.id) AS contact_count
     FROM companies c WHERE c.journey_stage IS NOT NULL ORDER BY c.name`
  );

  const companiesByStage: Record<string, { id: string; name: string; contact_count: number }[]> = {};
  for (const r of rows) {
    (companiesByStage[r.journey_stage] ??= []).push({ id: r.id, name: r.name, contact_count: r.contact_count });
  }

  return {
    html: <JourneyOverviewCard overview={overview} companiesByStage={companiesByStage} />,
    summary: `Journey overview: ${overview.total} companies tracked`,
  };
};

export const handleJourneyCompany: IntentHandler = async (entities) => {
  const name = entities.name;
  if (!name) {
    return { html: <div class="card"><div class="text-sm text-muted">Which company? Try: "journey Visma"</div></div>, summary: "Asked for company name" };
  }

  const result = await resolveCompany(name);
  if (result.type === "not_found") {
    return { html: <div class="card"><div class="text-sm text-muted">No company found matching "{name}".</div></div>, summary: `No company for "${name}"` };
  }
  if (result.type === "multiple") {
    return { html: <CompanyListFragment companies={result.items!} />, summary: `Found ${result.items!.length} matches` };
  }

  const journey = await getCompanyJourney(result.item!.id);
  if (!journey) {
    return { html: <div class="card"><div class="text-sm text-muted">Could not load journey data.</div></div>, summary: "Journey load failed" };
  }

  return {
    html: <CompanyJourneyCard journey={journey} />,
    summary: `Journey for ${journey.company_name}: ${journey.stage || "not started"}`,
    entityId: journey.company_id, entityName: journey.company_name, entityType: "company",
  };
};

export const handleJourneySet: IntentHandler = async (entities) => {
  const name = entities.name;
  const stage = entities.stage as JourneyStage | undefined;
  if (!name || !stage) {
    return { html: <div class="card"><div class="text-sm text-muted">Usage: "set Visma to training"</div></div>, summary: "Asked for company + stage" };
  }

  const result = await resolveCompany(name);
  if (result.type !== "found") {
    return { html: <div class="card"><div class="text-sm text-muted">No company found matching "{name}".</div></div>, summary: `No company for "${name}"` };
  }

  await updateJourneyStage(result.item!.id, stage, true);
  const journey = await getCompanyJourney(result.item!.id);

  return {
    html: journey ? <CompanyJourneyCard journey={journey} /> : <div class="card"><div class="text-sm">Stage set to {stage}</div></div>,
    summary: `Set ${result.item!.name} to ${stage}`,
    entityId: result.item!.id, entityName: result.item!.name, entityType: "company",
  };
};

export const handleJourneySnapshot: IntentHandler = async (entities) => {
  const name = entities.name;
  if (!name) {
    return { html: <div class="card"><div class="text-sm text-muted">Which company? Try: "snapshot Visma"</div></div>, summary: "Asked for company name" };
  }

  const result = await resolveCompany(name);
  if (result.type !== "found") {
    return { html: <div class="card"><div class="text-sm text-muted">No company found matching "{name}".</div></div>, summary: `No company for "${name}"` };
  }

  const snapshot = await createSnapshot(result.item!.id, "manual");
  if (!snapshot) {
    return { html: <div class="card"><div class="text-sm text-muted">No survey data to snapshot for {result.item!.name}.</div></div>, summary: "No survey data" };
  }

  const journey = await getCompanyJourney(result.item!.id);
  return {
    html: journey ? <CompanyJourneyCard journey={journey} /> : <div class="card"><div class="text-sm">Snapshot created</div></div>,
    summary: `Created snapshot for ${result.item!.name}: avg ${snapshot.avg_score?.toFixed(1) || "N/A"}`,
    entityId: result.item!.id, entityName: result.item!.name, entityType: "company",
  };
};

export const handleFluencySet: IntentHandler = async (entities) => {
  const name = entities.name;
  const level = entities.level as FluencyLevel | undefined;
  if (!name || !level) {
    return { html: <div class="card"><div class="text-sm text-muted">Usage: "set Hanne to practitioner"</div></div>, summary: "Asked for contact + level" };
  }

  const contactResult = await resolveAndRenderContact(name, undefined);
  if (!contactResult.entityId) {
    return { html: <div class="card"><div class="text-sm text-muted">No contact found matching "{name}".</div></div>, summary: `No contact for "${name}"` };
  }

  await setContactFluencyLevel(contactResult.entityId, level);
  return {
    html: <div class="card"><div class="text-sm" style="color: var(--visma-turquoise)">Set {contactResult.entityName || name} to {level}</div></div>,
    summary: `Set ${contactResult.entityName || name} fluency to ${level}`,
    entityId: contactResult.entityId, entityName: contactResult.entityName, entityType: "contact",
  };
};
