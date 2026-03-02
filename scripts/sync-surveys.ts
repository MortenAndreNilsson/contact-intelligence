/**
 * CLI wrapper: bun run scripts/sync-surveys.ts
 */
import { syncSurveys } from "../src/services/sync-surveys.ts";

try {
  console.log("=== Survey Responses Sync ===");
  const result = await syncSurveys();
  console.log(`Done: ${result.processed} processed, ${result.created} created, ${result.skipped} skipped`);
} catch (err: any) {
  console.error("Sync failed:", err.message);
  process.exit(1);
}
