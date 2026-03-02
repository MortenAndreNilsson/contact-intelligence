/**
 * CLI wrapper: bun run scripts/enrich-contacts.ts
 */
import { enrichContacts } from "../src/services/enrich-contacts.ts";

try {
  console.log("=== People Enrichment ===");
  const result = await enrichContacts();
  console.log(`Done: ${result.processed} processed, ${result.enriched} enriched, ${result.failed} failed, ${result.companiesCreated} companies created`);
} catch (err: any) {
  console.error("Enrichment failed:", err.message);
  process.exit(1);
}
