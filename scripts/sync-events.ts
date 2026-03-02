/**
 * CLI wrapper: bun run scripts/sync-events.ts
 */
import { syncEvents } from "../src/services/sync-events.ts";

try {
  console.log("=== CMS Events Sync ===");
  const result = await syncEvents();
  console.log(`Done: ${result.processed} processed, ${result.created} created, ${result.skipped} skipped`);
} catch (err: any) {
  console.error("Sync failed:", err.message);
  process.exit(1);
}
