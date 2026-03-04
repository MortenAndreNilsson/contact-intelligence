/**
 * Enrich contacts by resolving real person info via Discovery Engine.
 *
 * For each contact missing name or job_title:
 *   1. Call lookupPerson(email) to get org, title, etc.
 *   2. Update the contact record with name + job_title
 *   3. Resolve or create the real company (by org name), reassign company_id
 *   4. Log results to sync_log
 */

import { queryAll, queryOne, run, generateId } from "../db/client.ts";
import { createCompany } from "./companies.ts";
import { lookupPerson } from "./people-lookup.ts";
import type { EnrichResult, PersonInfo } from "../types/index.ts";

interface UnenrichedContact {
  id: string;
  email: string;
  name: string | null;
  job_title: string | null;
  company_id: string | null;
}

/**
 * Find or create a company by organization name.
 * Returns the company ID. When creating, passes country if available.
 */
async function resolveCompany(orgName: string, country?: string | null): Promise<{ id: string; created: boolean }> {
  // Check if a company with this exact name already exists
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM companies WHERE LOWER(name) = LOWER($name)`,
    { $name: orgName }
  );

  if (existing) {
    return { id: existing.id, created: false };
  }

  // Create new company with name + country from Discovery Engine
  const company = await createCompany(orgName, undefined, undefined, undefined, country ?? undefined);
  return { id: company.id, created: true };
}

/**
 * Enrich a single contact by email.
 * Returns true if enrichment succeeded, false otherwise.
 */
export async function enrichSingleContact(
  contactId: string,
  email: string,
  token?: string
): Promise<{ success: boolean; info: PersonInfo | null; companyCreated: boolean }> {
  const info = await lookupPerson(email, token);

  if (!info) {
    return { success: false, info: null, companyCreated: false };
  }

  // Build SET clauses for direct SQL update
  const sets: string[] = [];
  const params: Record<string, unknown> = { $id: contactId };

  if (info.name) { sets.push("name = $name"); params.$name = info.name; }
  if (info.jobTitle) { sets.push("job_title = $jobTitle"); params.$jobTitle = info.jobTitle; }

  // Resolve company if org found — pass country from Discovery Engine
  let companyCreated = false;
  if (info.organization) {
    const company = await resolveCompany(info.organization, info.country);
    sets.push("company_id = $companyId");
    params.$companyId = company.id;
    companyCreated = company.created;
  }

  if (sets.length > 0) {
    sets.push("updated_at = CAST(current_timestamp AS VARCHAR)");

    // DuckDB FK workaround: can't UPDATE a parent row referenced by children.
    // Detach activities temporarily, update contact, then reattach.
    const activityIds = await queryAll<{ id: string }>(
      `SELECT id FROM activities WHERE contact_id = $id`,
      { $id: contactId }
    );
    const listMemberIds = await queryAll<{ list_id: string }>(
      `SELECT list_id FROM list_members WHERE contact_id = $id`,
      { $id: contactId }
    );

    if (activityIds.length > 0) {
      await run(`UPDATE activities SET contact_id = NULL WHERE contact_id = $id`, { $id: contactId });
    }
    if (listMemberIds.length > 0) {
      await run(`DELETE FROM list_members WHERE contact_id = $id`, { $id: contactId });
    }

    await run(`UPDATE contacts SET ${sets.join(", ")} WHERE id = $id`, params);

    // Reattach
    for (const a of activityIds) {
      await run(`UPDATE activities SET contact_id = $cid WHERE id = $aid`, { $cid: contactId, $aid: a.id });
    }
    for (const lm of listMemberIds) {
      await run(
        `INSERT INTO list_members (list_id, contact_id) VALUES ($lid, $cid)`,
        { $lid: lm.list_id, $cid: contactId }
      );
    }
  }

  return { success: true, info, companyCreated };
}

/**
 * Batch-enrich all contacts that are missing name or job_title.
 */
export async function enrichContacts(): Promise<EnrichResult> {
  const unenriched = await queryAll<UnenrichedContact>(
    `SELECT id, email, name, job_title, company_id
     FROM contacts
     WHERE name IS NULL OR job_title IS NULL
     ORDER BY updated_at ASC`
  );

  console.log(`Found ${unenriched.length} contacts to enrich`);

  let processed = 0;
  let enriched = 0;
  let failed = 0;
  let companiesCreated = 0;

  // Get token once for all lookups
  const proc = Bun.spawn(["gcloud.cmd", "auth", "print-access-token"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const token = (await new Response(proc.stdout).text()).trim();
  if (!token) {
    throw new Error("Failed to get access token for enrichment");
  }

  for (const contact of unenriched) {
    processed++;

    try {
      const result = await enrichSingleContact(contact.id, contact.email, token);

      if (result.success) {
        enriched++;
        if (result.companyCreated) companiesCreated++;
        console.log(`  enriched: ${contact.email} → ${result.info?.name ?? "?"} @ ${result.info?.organization ?? "?"}`);
      } else {
        failed++;
        console.log(`  not found: ${contact.email}`);
      }
    } catch (err: any) {
      failed++;
      console.error(`  error: ${contact.email} — ${err.message}`);
    }

    // Rate limit: 200ms between calls
    if (processed < unenriched.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Log to sync_log
  await run(
    `INSERT INTO sync_log (id, source, last_sync_at, records_processed, records_created, records_skipped, status)
     VALUES ($id, 'people_enrichment', CAST(current_timestamp AS VARCHAR), $processed, $enriched, $failed, 'success')`,
    { $id: generateId(), $processed: processed, $enriched: enriched, $failed: failed }
  );

  return { processed, enriched, failed, companiesCreated };
}
