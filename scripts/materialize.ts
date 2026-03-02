/**
 * CLI wrapper: bun run scripts/materialize.ts
 */
import { materialize } from "../src/services/materialize.ts";

try {
  console.log("=== Identity Resolution (Materialize) ===");
  const result = await materialize();
  console.log(`\nDone:`);
  console.log(`  Companies: +${result.companies}`);
  console.log(`  Contacts: +${result.contacts}`);
  console.log(`  CMS activities: +${result.cmsActivities}`);
  console.log(`  Survey activities: +${result.surveyActivities}`);
} catch (err: any) {
  console.error("Materialize failed:", err.message);
  process.exit(1);
}
