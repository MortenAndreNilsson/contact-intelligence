/**
 * One-time cleanup: remove test/junk companies and contacts from the database.
 * Removes: test.local domain, example.com domain, com.dk domain
 * Also cleans raw sync tables (cms_events, survey_responses) with test emails.
 *
 * Run: bun scripts/cleanup-test-data.ts
 */

import { queryAll, queryOne, run } from "../src/db/client.ts";

const JUNK_DOMAINS = ["test.local", "example.com", "com.dk"];
const JUNK_EMAIL_PATTERNS = ["%@test.local", "%@example.com", "%test%@%"];

async function main() {
  console.log("=== Contact Intelligence: Test Data Cleanup ===\n");

  // 1. Find junk companies
  const junkCompanies = await queryAll<{ id: string; name: string; domain: string | null }>(
    `SELECT id, name, domain FROM companies WHERE domain IN ('test.local', 'example.com', 'com.dk')`
  );
  console.log(`Found ${junkCompanies.length} junk companies:`);
  for (const c of junkCompanies) {
    console.log(`  - ${c.name} (${c.domain}) [${c.id}]`);
  }

  // 2. Find contacts at junk companies + contacts with junk emails
  const junkContacts = await queryAll<{ id: string; email: string; company_id: string | null }>(
    `SELECT id, email, company_id FROM contacts
     WHERE company_id IN (SELECT id FROM companies WHERE domain IN ('test.local', 'example.com', 'com.dk'))
        OR email LIKE '%@test.local'
        OR email LIKE '%@example.com'`
  );
  console.log(`\nFound ${junkContacts.length} junk contacts`);

  // 3. Count activities linked to junk contacts
  const junkContactIds = junkContacts.map(c => `'${c.id}'`).join(",");
  let activityCount = 0;
  if (junkContactIds) {
    const result = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM activities WHERE contact_id IN (${junkContactIds})`
    );
    activityCount = result?.cnt ?? 0;
  }
  console.log(`Found ${activityCount} activities linked to junk contacts`);

  // 4. Count junk raw events
  const junkEvents = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM cms_events WHERE userEmail LIKE '%@test.local' OR userEmail LIKE '%@example.com'`
  );
  console.log(`Found ${junkEvents?.cnt ?? 0} junk cms_events`);

  const junkSurveys = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM survey_responses WHERE email LIKE '%@test.local' OR email LIKE '%@example.com'`
  );
  console.log(`Found ${junkSurveys?.cnt ?? 0} junk survey_responses`);

  // 5. Delete in order (respect FK constraints)
  console.log("\n--- Deleting ---");

  // Delete list memberships for junk contacts
  if (junkContactIds) {
    await run(`DELETE FROM list_members WHERE contact_id IN (${junkContactIds})`);
    console.log("  Deleted list_members for junk contacts");
  }

  // Delete embeddings referencing junk companies/contacts
  for (const c of junkCompanies) {
    await run(`DELETE FROM embeddings WHERE source_id IN (SELECT id FROM embedding_sources WHERE source_ref = $ref)`, { $ref: `company:${c.id}` });
    await run(`DELETE FROM embedding_sources WHERE source_ref = $ref`, { $ref: `company:${c.id}` });
  }
  for (const ct of junkContacts) {
    await run(`DELETE FROM embeddings WHERE source_id IN (SELECT id FROM embedding_sources WHERE source_ref = $ref)`, { $ref: `contact:${ct.id}` });
    await run(`DELETE FROM embedding_sources WHERE source_ref = $ref`, { $ref: `contact:${ct.id}` });
  }
  console.log("  Deleted related embeddings");

  // Delete activities for junk contacts
  if (junkContactIds) {
    await run(`DELETE FROM activities WHERE contact_id IN (${junkContactIds})`);
    console.log(`  Deleted ${activityCount} activities`);
  }

  // Delete activities for junk companies (some may have company_id but no contact_id)
  for (const c of junkCompanies) {
    await run(`DELETE FROM activities WHERE company_id = $id`, { $id: c.id });
  }
  console.log("  Deleted orphan activities for junk companies");

  // Delete signals for junk companies
  for (const c of junkCompanies) {
    await run(`DELETE FROM signals WHERE company_id = $id`, { $id: c.id });
  }
  console.log("  Deleted signals for junk companies");

  // Delete maturity snapshots for junk companies
  for (const c of junkCompanies) {
    await run(`DELETE FROM maturity_snapshots WHERE company_id = $id`, { $id: c.id });
  }
  console.log("  Deleted maturity snapshots for junk companies");

  // Delete contacts
  if (junkContactIds) {
    await run(`DELETE FROM contacts WHERE id IN (${junkContactIds})`);
    console.log(`  Deleted ${junkContacts.length} contacts`);
  }

  // Delete companies
  for (const c of junkCompanies) {
    await run(`DELETE FROM companies WHERE id = $id`, { $id: c.id });
    console.log(`  Deleted company: ${c.name} (${c.domain})`);
  }

  // Clean raw tables
  await run(`DELETE FROM cms_events WHERE userEmail LIKE '%@test.local' OR userEmail LIKE '%@example.com'`);
  console.log(`  Cleaned cms_events`);

  await run(`DELETE FROM survey_responses WHERE email LIKE '%@test.local' OR email LIKE '%@example.com'`);
  console.log(`  Cleaned survey_responses`);

  console.log("\n=== Cleanup complete ===");

  // Verify
  const remaining = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM contacts WHERE email LIKE '%@test.local' OR email LIKE '%@example.com'`
  );
  console.log(`Remaining junk contacts: ${remaining?.cnt ?? 0}`);

  const remainingCo = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM companies WHERE domain IN ('test.local', 'example.com', 'com.dk')`
  );
  console.log(`Remaining junk companies: ${remainingCo?.cnt ?? 0}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
