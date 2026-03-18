# G6 Journey + G7 Signals Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track company engagement stages (exploring → self_sustaining) and individual fluency levels (explorer → master), detect notable engagement signals, and surface both through the chat interface.

**Architecture:** Two new services (`journey-service.ts`, `signals-service.ts`) provide the business logic. Journey stages auto-compute from activities data, with manual overrides. Signals persist to a new `signals` table and are detected during sync. Six new chat intents route through existing handler registry to new HTMX cards.

**Tech Stack:** DuckDB, Bun + Hono, HTMX/JSX cards, existing LLM intent classifier

**Spec:** `docs/specs/2026-03-18-g6-journey-g7-signals-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/index.ts` | Modify | Fix types: JourneyStage, JourneyOverview, MaturitySnapshot, Signal; add FluencyLevel |
| `src/db/schema.sql` | Modify | Add `signals` table + indexes |
| `src/db/client.ts` | Modify | Migrations: fluency columns on contacts, journey_stage value migration, signals table |
| `src/services/journey-service.ts` | Create | Journey stage computation, snapshots, fluency distribution |
| `src/services/signals-service.ts` | Create | Signal detection, query, dismiss |
| `src/services/materialize.ts` | Modify | Hook journey + signals after materialize |
| `src/services/local-llm.ts` | Modify | Add journey/signals/fluency intents + regex fallback |
| `src/web/routes/handlers/journey-handlers.tsx` | Create | Journey + fluency chat handlers |
| `src/web/routes/handlers/signal-handlers.tsx` | Create | Signals chat handler |
| `src/web/routes/chat-handlers.tsx` | Modify | Register new handlers |
| `src/web/cards/journey-overview.tsx` | Create | Journey overview card |
| `src/web/cards/company-journey.tsx` | Create | Company journey detail card |
| `src/web/cards/signals-feed.tsx` | Create | Signals feed card |
| `src/web/cards/company-profile.tsx` | Modify | Add journey section to profile |

---

## Chunk 1: Types + Schema + Migrations

### Task 1: Update TypeScript types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Update types**

Replace the G6/G7 type block (lines 355-395) with:

```typescript
// --- G6: AI Maturity Journey ---

export type FluencyLevel = "explorer" | "practitioner" | "integrator" | "architect" | "master";

export type JourneyStage = "exploring" | "assessing" | "training" | "scaling" | "self_sustaining";

export interface MaturitySnapshot {
  id: string;
  company_id: string;
  snapshot_date: string;
  trigger_type: string;
  total_respondents: number;
  beginner_count: number;
  developing_count: number;
  intermediate_count: number;
  advanced_count: number;
  leader_count: number;
  avg_score: number | null;
  notes: string | null;
  created_at: string;
}

export interface JourneyOverview {
  exploring: number;
  assessing: number;
  training: number;
  scaling: number;
  self_sustaining: number;
  total: number;
}

export interface CompanyJourney {
  company_id: string;
  company_name: string;
  stage: JourneyStage | null;
  stage_override: boolean;
  fluency_distribution: Record<FluencyLevel, number>;
  snapshots: MaturitySnapshot[];
  total_contacts: number;
}

export interface FluencyDistribution {
  explorer: number;
  practitioner: number;
  integrator: number;
  architect: number;
  master: number;
  unset: number;
}

// --- G7: Engagement Signals ---

export type SignalType = "new_survey" | "score_change" | "content_binge" | "cooling_off" | "new_person";

export interface Signal {
  id: string;
  signal_type: SignalType;
  company_id: string;
  company_name?: string;
  title: string;
  detail: string | null;
  detected_at: string;
  dismissed: boolean;
  created_at: string;
}
```

- [ ] **Step 2: Add `stage` and `level` to QueryUnderstanding entities**

In the `QueryUnderstanding` interface, add to the `entities` object:

```typescript
    stage?: string;
    level?: string;
```

- [ ] **Step 3: Add fluency fields to Contact and ContactRow**

In the `Contact` interface, add after `notes`:

```typescript
  fluency_level: FluencyLevel | null;
  fluency_certified_at: string | null;
```

In the `Company` interface, add (after `briefing_at`):

```typescript
  journey_stage: JourneyStage | null;
  journey_override: boolean;
```

In the `CompanyRow` interface, add the same fields:

```typescript
  journey_stage: string | null;
  journey_override: boolean;
```

- [ ] **Step 4: Commit**

```bash
cd /c/Projects/contact-intelligence
git add src/types/index.ts
git commit -m "feat(journey): update types for G6 journey stages + G7 signals"
```

---

### Task 2: Add signals table to schema

**Files:**
- Modify: `src/db/schema.sql`

- [ ] **Step 1: Append signals table to schema.sql**

Add at the end of `src/db/schema.sql`:

```sql
-- G7: Engagement Signals
CREATE TABLE IF NOT EXISTS signals (
  id VARCHAR PRIMARY KEY,
  signal_type VARCHAR NOT NULL,
  company_id VARCHAR NOT NULL,
  title VARCHAR NOT NULL,
  detail VARCHAR,
  detected_at VARCHAR NOT NULL,
  dismissed BOOLEAN DEFAULT false,
  created_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR)
);

CREATE INDEX IF NOT EXISTS idx_signals_company ON signals(company_id);
CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_signals_dismissed ON signals(dismissed)
```

- [ ] **Step 2: Commit**

```bash
git add src/db/schema.sql
git commit -m "feat(signals): add signals table to schema"
```

---

### Task 3: Add migrations to client.ts

**Files:**
- Modify: `src/db/client.ts`

- [ ] **Step 1: Add migrations to the migrations array**

Add to the `migrations` array in `src/db/client.ts` (after the existing briefing migrations):

```typescript
    // G6: Fluency level on contacts
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fluency_level VARCHAR",
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fluency_certified_at VARCHAR",
    // G6: Migrate old journey_stage values to new names
    "UPDATE companies SET journey_stage = CASE journey_stage WHEN 'awareness' THEN 'exploring' WHEN 'assessed' THEN 'assessing' WHEN 'workshop' THEN 'training' WHEN 'courses' THEN 'scaling' WHEN 'custom_engagement' THEN 'self_sustaining' ELSE journey_stage END WHERE journey_stage IS NOT NULL",
```

- [ ] **Step 2: Verify server starts cleanly**

```bash
cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true
```

Expected: No schema or migration errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/client.ts
git commit -m "feat(journey): add fluency columns + journey_stage value migration"
```

---

## Chunk 2: Journey Service

### Task 4: Create journey-service.ts

**Files:**
- Create: `src/services/journey-service.ts`

- [ ] **Step 1: Create the journey service**

```typescript
/**
 * G6: AI Maturity Journey — company stage tracking, fluency distribution, snapshots.
 */

import { generateId, queryAll, queryOne, run } from "../db/client.ts";
import type {
  JourneyStage,
  JourneyOverview,
  MaturitySnapshot,
  CompanyJourney,
  FluencyLevel,
  FluencyDistribution,
} from "../types/index.ts";

const VALID_STAGES: JourneyStage[] = ["exploring", "assessing", "training", "scaling", "self_sustaining"];
const VALID_FLUENCY: FluencyLevel[] = ["explorer", "practitioner", "integrator", "architect", "master"];

// --- Journey stage computation ---

/**
 * Auto-compute journey stage from activity data.
 * Only auto-advances exploring → assessing (on first survey).
 * Returns null if no activity data exists.
 */
export async function computeJourneyStage(companyId: string): Promise<JourneyStage | null> {
  // Check if company has manual override
  const company = await queryOne<{ journey_stage: string | null; journey_override: boolean }>(
    `SELECT journey_stage, journey_override FROM companies WHERE id = $id`,
    { $id: companyId }
  );
  if (!company) return null;
  if (company.journey_override) return company.journey_stage as JourneyStage | null;

  // Check for survey completions
  const hasSurvey = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM activities WHERE company_id = $id AND activity_type = 'survey_completed'`,
    { $id: companyId }
  );

  // Check for any content activity
  const hasActivity = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM activities WHERE company_id = $id`,
    { $id: companyId }
  );

  if (!hasActivity || hasActivity.cnt === 0) return null;

  if (hasSurvey && hasSurvey.cnt > 0) return "assessing";
  return "exploring";
}

/**
 * Update journey stage and persist. If manual=true, sets journey_override.
 */
export async function updateJourneyStage(companyId: string, stage: JourneyStage, manual = false): Promise<void> {
  if (!VALID_STAGES.includes(stage)) throw new Error(`Invalid journey stage: ${stage}`);
  await run(
    `UPDATE companies SET journey_stage = $stage, journey_override = $override, updated_at = CAST(current_timestamp AS VARCHAR) WHERE id = $id`,
    { $id: companyId, $stage: stage, $override: manual }
  );
}

/**
 * Auto-compute and persist journey stages for all companies, or a specific one.
 * Skips companies with journey_override = true.
 */
export async function recomputeJourneyStages(companyId?: string): Promise<number> {
  let companies: { id: string }[];
  if (companyId) {
    companies = [{ id: companyId }];
  } else {
    companies = await queryAll<{ id: string }>(
      `SELECT id FROM companies WHERE journey_override = false OR journey_override IS NULL`
    );
  }

  let updated = 0;
  for (const c of companies) {
    const stage = await computeJourneyStage(c.id);
    if (stage) {
      const current = await queryOne<{ journey_stage: string | null }>(
        `SELECT journey_stage FROM companies WHERE id = $id`, { $id: c.id }
      );
      if (current?.journey_stage !== stage) {
        await updateJourneyStage(c.id, stage, false);
        updated++;
      }
    }
  }
  return updated;
}

// --- Journey overview ---

export async function getJourneyOverview(): Promise<JourneyOverview> {
  const rows = await queryAll<{ journey_stage: string; cnt: number }>(
    `SELECT journey_stage, COUNT(*) AS cnt FROM companies WHERE journey_stage IS NOT NULL GROUP BY journey_stage`
  );
  const overview: JourneyOverview = { exploring: 0, assessing: 0, training: 0, scaling: 0, self_sustaining: 0, total: 0 };
  for (const r of rows) {
    const stage = r.journey_stage as keyof JourneyOverview;
    if (stage in overview && stage !== "total") {
      overview[stage] = r.cnt;
      overview.total += r.cnt;
    }
  }
  return overview;
}

// --- Fluency distribution ---

export async function getFluencyDistribution(companyId: string): Promise<FluencyDistribution> {
  const rows = await queryAll<{ fluency_level: string | null; cnt: number }>(
    `SELECT fluency_level, COUNT(*) AS cnt FROM contacts WHERE company_id = $id GROUP BY fluency_level`,
    { $id: companyId }
  );
  const dist: FluencyDistribution = { explorer: 0, practitioner: 0, integrator: 0, architect: 0, master: 0, unset: 0 };
  for (const r of rows) {
    if (r.fluency_level && r.fluency_level in dist) {
      dist[r.fluency_level as FluencyLevel] = r.cnt;
    } else {
      dist.unset += r.cnt;
    }
  }
  return dist;
}

export async function setContactFluencyLevel(contactId: string, level: FluencyLevel): Promise<void> {
  if (!VALID_FLUENCY.includes(level)) throw new Error(`Invalid fluency level: ${level}`);
  await run(
    `UPDATE contacts SET fluency_level = $level, fluency_certified_at = CAST(current_timestamp AS VARCHAR), updated_at = CAST(current_timestamp AS VARCHAR) WHERE id = $id`,
    { $id: contactId, $level: level }
  );
}

// --- Maturity snapshots ---

export async function createSnapshot(companyId: string, trigger: string): Promise<MaturitySnapshot | null> {
  // Count respondents at each maturity level from survey activities
  const levels = await queryAll<{ maturityLevel: string; cnt: number }>(
    `SELECT json_extract_string(a.detail, '$.maturityLevel') AS maturityLevel, COUNT(*) AS cnt
     FROM activities a
     WHERE a.company_id = $id AND a.activity_type = 'survey_completed'
       AND json_extract_string(a.detail, '$.maturityLevel') IS NOT NULL
     GROUP BY maturityLevel`,
    { $id: companyId }
  );

  if (levels.length === 0) return null;

  const avgRow = await queryOne<{ avg_score: number | null }>(
    `SELECT AVG(CAST(json_extract_string(a.detail, '$.avgScore') AS DOUBLE)) AS avg_score
     FROM activities a WHERE a.company_id = $id AND a.activity_type = 'survey_completed'`,
    { $id: companyId }
  );

  const levelMap: Record<string, number> = {};
  let total = 0;
  for (const r of levels) {
    levelMap[r.maturityLevel?.toLowerCase() || "unknown"] = r.cnt;
    total += r.cnt;
  }

  const id = generateId();
  await run(
    `INSERT INTO maturity_snapshots (id, company_id, snapshot_date, trigger_type, total_respondents, beginner_count, developing_count, intermediate_count, advanced_count, leader_count, avg_score)
     VALUES ($id, $companyId, current_date, $trigger, $total, $beginner, $developing, $intermediate, $advanced, $leader, $avg)`,
    {
      $id: id,
      $companyId: companyId,
      $trigger: trigger,
      $total: total,
      $beginner: levelMap["beginner"] || 0,
      $developing: levelMap["developing"] || 0,
      $intermediate: levelMap["intermediate"] || 0,
      $advanced: levelMap["advanced"] || 0,
      $leader: levelMap["leader"] || 0,
      $avg: avgRow?.avg_score ?? null,
    }
  );

  return queryOne<MaturitySnapshot>(`SELECT * FROM maturity_snapshots WHERE id = $id`, { $id: id });
}

export async function getSnapshots(companyId: string): Promise<MaturitySnapshot[]> {
  return queryAll<MaturitySnapshot>(
    `SELECT * FROM maturity_snapshots WHERE company_id = $id ORDER BY snapshot_date DESC`,
    { $id: companyId }
  );
}

/**
 * Create a snapshot only if there are new survey activities since the last snapshot.
 */
export async function autoSnapshotIfNeeded(companyId: string): Promise<boolean> {
  const lastSnapshot = await queryOne<{ snapshot_date: string }>(
    `SELECT snapshot_date FROM maturity_snapshots WHERE company_id = $id ORDER BY snapshot_date DESC LIMIT 1`,
    { $id: companyId }
  );

  const newSurveys = await queryOne<{ cnt: number }>(
    lastSnapshot
      ? `SELECT COUNT(*) AS cnt FROM activities WHERE company_id = $id AND activity_type = 'survey_completed' AND occurred_at > $since`
      : `SELECT COUNT(*) AS cnt FROM activities WHERE company_id = $id AND activity_type = 'survey_completed'`,
    lastSnapshot ? { $id: companyId, $since: lastSnapshot.snapshot_date } : { $id: companyId }
  );

  if (newSurveys && newSurveys.cnt > 0) {
    await createSnapshot(companyId, "survey");
    return true;
  }
  return false;
}

// --- Full company journey view ---

export async function getCompanyJourney(companyId: string): Promise<CompanyJourney | null> {
  const company = await queryOne<{ id: string; name: string; journey_stage: string | null; journey_override: boolean }>(
    `SELECT id, name, journey_stage, journey_override FROM companies WHERE id = $id`,
    { $id: companyId }
  );
  if (!company) return null;

  const contactCount = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM contacts WHERE company_id = $id`,
    { $id: companyId }
  );

  const fluency = await getFluencyDistribution(companyId);
  const snapshots = await getSnapshots(companyId);

  return {
    company_id: company.id,
    company_name: company.name,
    stage: company.journey_stage as JourneyStage | null,
    stage_override: company.journey_override,
    fluency_distribution: fluency,
    snapshots,
    total_contacts: contactCount?.cnt ?? 0,
  };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /c/Projects/contact-intelligence && bun build src/services/journey-service.ts --no-bundle 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/services/journey-service.ts
git commit -m "feat(journey): add journey service — stages, snapshots, fluency distribution"
```

---

## Chunk 3: Signals Service

### Task 5: Create signals-service.ts

**Files:**
- Create: `src/services/signals-service.ts`

- [ ] **Step 1: Create the signals service**

```typescript
/**
 * G7: Engagement Signals — detect notable events from activity data.
 * Signals are persisted so each is shown only once.
 */

import { generateId, queryAll, queryOne, run } from "../db/client.ts";
import type { Signal, SignalType } from "../types/index.ts";

// --- Signal detection ---

/**
 * Detect all new signals. Each detector returns new signals to persist.
 * Called after materialize during sync pipeline.
 */
export async function detectSignals(): Promise<Signal[]> {
  const all: Signal[] = [];

  const detectors = [
    detectNewSurvey,
    detectScoreChange,
    detectContentBinge,
    detectCoolingOff,
    detectNewPerson,
  ];

  for (const detect of detectors) {
    try {
      const signals = await detect();
      for (const s of signals) {
        await run(
          `INSERT INTO signals (id, signal_type, company_id, title, detail, detected_at)
           VALUES ($id, $type, $companyId, $title, $detail, CAST(current_timestamp AS VARCHAR))`,
          { $id: s.id, $type: s.signal_type, $companyId: s.company_id, $title: s.title, $detail: s.detail }
        );
        all.push(s);
      }
    } catch (err: any) {
      console.warn(`Signal detection error (${detect.name}):`, err.message);
    }
  }

  return all;
}

// --- Individual detectors ---

async function detectNewSurvey(): Promise<Signal[]> {
  // Survey activities not yet signalled (dedup by activity ID stored in signal.detail)
  const rows = await queryAll<{ activity_id: string; company_id: string; company_name: string; title: string; occurred_at: string }>(
    `SELECT a.id AS activity_id, a.company_id, c.name AS company_name, a.title, a.occurred_at
     FROM activities a
     JOIN companies c ON a.company_id = c.id
     WHERE a.activity_type = 'survey_completed'
       AND a.company_id IS NOT NULL
       AND a.id NOT IN (
         SELECT detail FROM signals WHERE signal_type = 'new_survey' AND detail IS NOT NULL
       )
     ORDER BY a.occurred_at DESC`
  );

  return rows.map((r) => ({
    id: generateId(),
    signal_type: "new_survey" as SignalType,
    company_id: r.company_id,
    company_name: r.company_name,
    title: `New survey completion at ${r.company_name}`,
    detail: r.activity_id,
    detected_at: new Date().toISOString(),
    dismissed: false,
    created_at: new Date().toISOString(),
  }));
}

async function detectScoreChange(): Promise<Signal[]> {
  // Companies where avg score changed by >0.5 between last two snapshots
  const rows = await queryAll<{
    company_id: string;
    company_name: string;
    old_score: number;
    new_score: number;
  }>(
    `WITH ranked AS (
      SELECT ms.company_id, ms.avg_score, ms.snapshot_date,
        ROW_NUMBER() OVER (PARTITION BY ms.company_id ORDER BY ms.snapshot_date DESC) AS rn
      FROM maturity_snapshots ms
      WHERE ms.avg_score IS NOT NULL
    )
    SELECT r1.company_id, c.name AS company_name, r2.avg_score AS old_score, r1.avg_score AS new_score
    FROM ranked r1
    JOIN ranked r2 ON r1.company_id = r2.company_id AND r2.rn = 2
    JOIN companies c ON r1.company_id = c.id
    WHERE r1.rn = 1
      AND ABS(r1.avg_score - r2.avg_score) > 0.5
      AND r1.company_id NOT IN (
        SELECT company_id FROM signals WHERE signal_type = 'score_change'
          AND detected_at > CAST(r1.snapshot_date AS VARCHAR)
      )`
  );

  return rows.map((r) => {
    const direction = r.new_score > r.old_score ? "up" : "down";
    const delta = Math.abs(r.new_score - r.old_score).toFixed(1);
    return {
      id: generateId(),
      signal_type: "score_change" as SignalType,
      company_id: r.company_id,
      company_name: r.company_name,
      title: `${r.company_name} maturity score ${direction} by ${delta}`,
      detail: `${r.old_score.toFixed(1)} → ${r.new_score.toFixed(1)}`,
      detected_at: new Date().toISOString(),
      dismissed: false,
      created_at: new Date().toISOString(),
    };
  });
}

async function detectContentBinge(): Promise<Signal[]> {
  // Contacts who read 5+ articles in the last 7 days, not yet signalled
  const rows = await queryAll<{
    contact_id: string;
    contact_name: string;
    company_id: string;
    company_name: string;
    article_count: number;
  }>(
    `SELECT a.contact_id, ct.name AS contact_name, a.company_id, c.name AS company_name,
       COUNT(*) AS article_count
     FROM activities a
     JOIN contacts ct ON a.contact_id = ct.id
     JOIN companies c ON a.company_id = c.id
     WHERE a.activity_type = 'article_view'
       AND a.occurred_at >= CAST(current_timestamp - INTERVAL '7 days' AS VARCHAR)
       AND a.company_id IS NOT NULL
     GROUP BY a.contact_id, ct.name, a.company_id, c.name
     HAVING COUNT(*) >= 5`
  );

  // Filter out already-signalled contacts (by contact_id in detail)
  const existing = await queryAll<{ detail: string }>(
    `SELECT detail FROM signals WHERE signal_type = 'content_binge'
     AND detected_at >= CAST(current_timestamp - INTERVAL '7 days' AS VARCHAR)`
  );
  const signalled = new Set(existing.map((e) => e.detail));

  return rows
    .filter((r) => !signalled.has(r.contact_id))
    .map((r) => ({
      id: generateId(),
      signal_type: "content_binge" as SignalType,
      company_id: r.company_id,
      company_name: r.company_name,
      title: `${r.contact_name || "Someone"} at ${r.company_name} read ${r.article_count} articles this week`,
      detail: r.contact_id,
      detected_at: new Date().toISOString(),
      dismissed: false,
      created_at: new Date().toISOString(),
    }));
}

async function detectCoolingOff(): Promise<Signal[]> {
  // Companies with 3+ activities in previous 30 days but none in last 14
  const rows = await queryAll<{ company_id: string; company_name: string; prev_count: number }>(
    `SELECT c.id AS company_id, c.name AS company_name, prev.cnt AS prev_count
     FROM companies c
     JOIN (
       SELECT company_id, COUNT(*) AS cnt FROM activities
       WHERE occurred_at >= CAST(current_timestamp - INTERVAL '30 days' AS VARCHAR)
         AND occurred_at < CAST(current_timestamp - INTERVAL '14 days' AS VARCHAR)
       GROUP BY company_id HAVING COUNT(*) >= 3
     ) prev ON c.id = prev.company_id
     LEFT JOIN (
       SELECT DISTINCT company_id FROM activities
       WHERE occurred_at >= CAST(current_timestamp - INTERVAL '14 days' AS VARCHAR)
     ) recent ON c.id = recent.company_id
     WHERE recent.company_id IS NULL
       AND c.id NOT IN (
         SELECT company_id FROM signals WHERE signal_type = 'cooling_off'
           AND detected_at >= CAST(current_timestamp - INTERVAL '14 days' AS VARCHAR)
       )`
  );

  return rows.map((r) => ({
    id: generateId(),
    signal_type: "cooling_off" as SignalType,
    company_id: r.company_id,
    company_name: r.company_name,
    title: `${r.company_name} going quiet — no activity in 14 days`,
    detail: `Had ${r.prev_count} activities in the prior 16 days`,
    detected_at: new Date().toISOString(),
    dismissed: false,
    created_at: new Date().toISOString(),
  }));
}

async function detectNewPerson(): Promise<Signal[]> {
  // Contacts created in the last 7 days at companies that already existed
  const rows = await queryAll<{
    contact_id: string;
    contact_email: string;
    contact_name: string;
    company_id: string;
    company_name: string;
  }>(
    `SELECT ct.id AS contact_id, ct.email AS contact_email, ct.name AS contact_name,
       ct.company_id, c.name AS company_name
     FROM contacts ct
     JOIN companies c ON ct.company_id = c.id
     WHERE ct.created_at >= CAST(current_timestamp - INTERVAL '7 days' AS VARCHAR)
       AND c.created_at < ct.created_at
       AND ct.id NOT IN (
         SELECT detail FROM signals WHERE signal_type = 'new_person' AND detail IS NOT NULL
       )`
  );

  return rows.map((r) => ({
    id: generateId(),
    signal_type: "new_person" as SignalType,
    company_id: r.company_id,
    company_name: r.company_name,
    title: `New person at ${r.company_name}: ${r.contact_name || r.contact_email}`,
    detail: r.contact_id,
    detected_at: new Date().toISOString(),
    dismissed: false,
    created_at: new Date().toISOString(),
  }));
}

// --- Query + dismiss ---

export async function getActiveSignals(limit = 20): Promise<Signal[]> {
  const rows = await queryAll<Signal & { company_name: string }>(
    `SELECT s.*, c.name AS company_name
     FROM signals s
     JOIN companies c ON s.company_id = c.id
     WHERE s.dismissed = false
     ORDER BY s.detected_at DESC
     LIMIT $limit`,
    { $limit: limit }
  );
  return rows;
}

export async function dismissSignal(id: string): Promise<void> {
  await run(`UPDATE signals SET dismissed = true WHERE id = $id`, { $id: id });
}

export async function dismissAllForCompany(companyId: string): Promise<void> {
  await run(`UPDATE signals SET dismissed = true WHERE company_id = $id AND dismissed = false`, { $id: companyId });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /c/Projects/contact-intelligence && bun build src/services/signals-service.ts --no-bundle 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/services/signals-service.ts
git commit -m "feat(signals): add signal detection service — 5 signal types"
```

---

## Chunk 4: Integration Hooks

### Task 6: Hook into materialize pipeline

**Files:**
- Modify: `src/services/materialize.ts`

- [ ] **Step 1: Add imports**

At the top of `materialize.ts`, add:

```typescript
import { recomputeJourneyStages, autoSnapshotIfNeeded } from "./journey-service.ts";
import { detectSignals } from "./signals-service.ts";
```

- [ ] **Step 2: Add journey + signals steps to materialize()**

At the end of the `materialize()` function, before the sync log INSERT, add:

```typescript
  // G6: Recompute journey stages for all non-override companies
  let journeyUpdated = 0;
  try {
    journeyUpdated = await recomputeJourneyStages();
  } catch (err: any) {
    console.warn("Journey stage computation error:", err.message);
  }

  // G6: Auto-snapshot companies with new survey data
  let snapshotsCreated = 0;
  if (surveyActivities > 0) {
    const companiesWithSurveys = await queryAll<{ company_id: string }>(
      `SELECT DISTINCT company_id FROM activities WHERE activity_type = 'survey_completed' AND company_id IS NOT NULL`
    );
    for (const c of companiesWithSurveys) {
      try {
        const created = await autoSnapshotIfNeeded(c.company_id);
        if (created) snapshotsCreated++;
      } catch (err: any) {
        console.warn(`Snapshot error for ${c.company_id}:`, err.message);
      }
    }
  }

  // G7: Detect new signals
  let signalsDetected = 0;
  try {
    const signals = await detectSignals();
    signalsDetected = signals.length;
  } catch (err: any) {
    console.warn("Signal detection error:", err.message);
  }
```

- [ ] **Step 3: Update the MaterializeResult interface and return**

Add to the `MaterializeResult` interface:

```typescript
  journeyUpdated: number;
  snapshotsCreated: number;
  signalsDetected: number;
```

Update the return statement to include the new fields:

```typescript
  return { companies, contacts, cmsActivities, surveyActivities, activitiesRepaired, journeyUpdated, snapshotsCreated, signalsDetected };
```

- [ ] **Step 4: Update sync handler summary**

In `src/web/routes/handlers/action-handlers.tsx`, update the Materialize step summary (line ~41) to include journey/signal counts:

```typescript
    steps.push({ label: "Materialize", ok: true, summary: `+${matResult.companies} companies, +${matResult.contacts} contacts, +${matResult.cmsActivities + matResult.surveyActivities} activities, ${matResult.journeyUpdated} stages, ${matResult.snapshotsCreated} snapshots, ${matResult.signalsDetected} signals` });
```

- [ ] **Step 5: Commit**

```bash
git add src/services/materialize.ts src/web/routes/handlers/action-handlers.tsx
git commit -m "feat(journey): hook journey stages + signals into materialize pipeline"
```

---

## Chunk 5: Chat Interface — Intent Classification

### Task 7: Add journey/signals intents to classifier

**Files:**
- Modify: `src/services/local-llm.ts`

- [ ] **Step 1: Update CATEGORY_PROMPT**

In the categories list within `CATEGORY_PROMPT`, update `action` and `view_data`:

Replace:
```
- view_data: user wants to see data (dashboard, articles, page views, surveys, engagement scores, lists overview)
```
With:
```
- view_data: user wants to see data (dashboard, articles, page views, surveys, engagement scores, lists overview, journey overview, signals feed)
```

Replace:
```
- action: user wants to DO something (run sync, enrich contacts, research a company)
```
With:
```
- action: user wants to DO something (run sync, enrich contacts, research a company, set journey stage, set fluency level, take a snapshot)
```

Add `stage` and `level` to entity fields in the prompt:

```
- stage: journey stage (exploring, assessing, training, scaling, self_sustaining)
- level: fluency level (explorer, practitioner, integrator, architect, master)
```

- [ ] **Step 2: Update CATEGORY_SCHEMA**

In the `CATEGORY_SCHEMA` object, add `stage` and `level` to the entities properties (alongside existing fields like `name`, `email`, etc.):

```typescript
        stage: { type: "string" },
        level: { type: "string" },
```

No `validCategories` change needed — journey/signals intents use existing categories (`view_data`, `action`).

- [ ] **Step 3: Update sub-classifiers**

In `subClassifyViewData`, add:

```typescript
  if (/\b(journey|journeys|maturity journey|company stages?)\b/.test(lower)) return "journey_overview";
  if (/\b(signals?|alerts?|what.s new|what happened|notable)\b/.test(lower)) return "signals";
```

In `subClassifyEntityLookup`, add before the `if (entities.email)` line:

```typescript
  if (/\b(journey|maturity journey)\b/.test(lower)) return "journey_company";
```

In `subClassifyAction`, add before the `return "sync"` default:

```typescript
  if (/\b(set.*to\s+(exploring|assessing|training|scaling|self.sustaining))\b/.test(lower)) return "journey_set";
  if (/\b(set.*to\s+(explorer|practitioner|integrator|architect|master))\b/.test(lower)) return "fluency_set";
  if (/\b(snapshot|take snapshot|create snapshot)\b/.test(lower)) return "journey_snapshot";
```

- [ ] **Step 4: Add regex fallback patterns**

In `regexFallback`, add before the `// Help` section:

```typescript
  // Journey
  if (/\b(journey|maturity journey|company stages?)\b/.test(slashStripped) && !/\b(set|to)\b/.test(slashStripped)) {
    return { intent: "journey_overview", entities: {}, confidence: 0.9 };
  }

  // Signals
  if (/\b(signals?|alerts?|what.s new|what happened)\b/.test(slashStripped)) {
    return { intent: "signals", entities: {}, confidence: 0.9 };
  }

  // Journey set: "set Visma to training"
  const journeySetMatch = slashStripped.match(/set\s+(.+?)\s+to\s+(exploring|assessing|training|scaling|self.sustaining)/);
  if (journeySetMatch) {
    return { intent: "journey_set", entities: { name: journeySetMatch[1]!.trim(), stage: journeySetMatch[2] }, confidence: 0.9 };
  }

  // Fluency set: "set Hanne to practitioner"
  const fluencySetMatch = slashStripped.match(/set\s+(.+?)\s+to\s+(explorer|practitioner|integrator|architect|master)/);
  if (fluencySetMatch) {
    return { intent: "fluency_set", entities: { name: fluencySetMatch[1]!.trim(), level: fluencySetMatch[2] }, confidence: 0.9 };
  }

  // Snapshot
  if (/\bsnapshot\b/.test(slashStripped)) {
    const name = slashStripped.replace(/snapshot\s*/, "").trim();
    return { intent: "journey_snapshot", entities: name ? { name } : {}, confidence: 0.9 };
  }
```

Also add slash commands near the bottom:

```typescript
  if (slashStripped === "journey" || slashStripped === "journeys") {
    return { intent: "journey_overview", entities: {}, confidence: 1.0 };
  }
  if (slashStripped.startsWith("journey ")) {
    return { intent: "journey_company", entities: { name: slashStripped.slice(8).trim() }, confidence: 1.0 };
  }
  if (slashStripped === "signals") {
    return { intent: "signals", entities: {}, confidence: 1.0 };
  }
  if (slashStripped.startsWith("snapshot ")) {
    return { intent: "journey_snapshot", entities: { name: slashStripped.slice(9).trim() }, confidence: 1.0 };
  }
```

- [ ] **Step 5: Commit**

```bash
git add src/services/local-llm.ts
git commit -m "feat(journey): add journey/signals/fluency intents to classifier"
```

---

## Chunk 6: Chat Interface — Cards + Handlers

### Task 8: Create HTMX cards

**Files:**
- Create: `src/web/cards/journey-overview.tsx`
- Create: `src/web/cards/company-journey.tsx`
- Create: `src/web/cards/signals-feed.tsx`

- [ ] **Step 1: Create journey overview card**

```tsx
import type { JourneyOverview, JourneyStage } from "../../types/index.ts";

interface CompanyInStage {
  id: string;
  name: string;
  contact_count: number;
}

const stageLabels: Record<JourneyStage, string> = {
  exploring: "Exploring",
  assessing: "Assessing",
  training: "Training",
  scaling: "Scaling",
  self_sustaining: "Self-Sustaining",
};

const stageColors: Record<JourneyStage, string> = {
  exploring: "var(--color-text-muted)",
  assessing: "var(--visma-turquoise)",
  training: "var(--visma-lime)",
  scaling: "var(--visma-purple, #8b5cf6)",
  self_sustaining: "var(--visma-gold, #f59e0b)",
};

export function JourneyOverviewCard({
  overview,
  companiesByStage,
}: {
  overview: JourneyOverview;
  companiesByStage: Record<string, CompanyInStage[]>;
}) {
  const stages: JourneyStage[] = ["exploring", "assessing", "training", "scaling", "self_sustaining"];

  return (
    <div class="card">
      <div class="card-label mb-xs">AI Maturity Journey</div>
      <div class="stat-grid" style="grid-template-columns: repeat(5, 1fr); margin-bottom: 12px">
        {stages.map((s) => (
          <div class="stat-box">
            <div class="stat-value" style={`font-size: 1.5rem; color: ${stageColors[s]}`}>{overview[s]}</div>
            <div class="stat-label">{stageLabels[s]}</div>
          </div>
        ))}
      </div>

      {stages.map((s) => {
        const companies = companiesByStage[s] || [];
        if (companies.length === 0) return null;
        return (
          <div class="mb-sm">
            <div class="text-xs" style={`color: ${stageColors[s]}; font-weight: 600; margin-bottom: 4px`}>
              {stageLabels[s]} ({companies.length})
            </div>
            {companies.map((c) => (
              <div
                class="table-row"
                style="cursor: pointer"
                hx-post="/chat"
                hx-target="#canvas"
                hx-swap="innerHTML"
                hx-vals={`{"message": "journey ${c.name}"}`}
              >
                <div class="flex-1 text-sm">{c.name}</div>
                <div class="text-xs text-muted">{c.contact_count} contacts</div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create company journey card**

```tsx
import type { CompanyJourney, JourneyStage, FluencyLevel } from "../../types/index.ts";

const stageLabels: Record<JourneyStage, string> = {
  exploring: "Exploring",
  assessing: "Assessing",
  training: "Training",
  scaling: "Scaling",
  self_sustaining: "Self-Sustaining",
};

const fluencyLabels: Record<FluencyLevel, string> = {
  explorer: "Explorer",
  practitioner: "Practitioner",
  integrator: "Integrator",
  architect: "Architect",
  master: "Master",
};

const fluencyColors: Record<FluencyLevel, string> = {
  explorer: "#6b7280",
  practitioner: "var(--visma-turquoise)",
  integrator: "var(--visma-lime)",
  architect: "var(--visma-purple, #8b5cf6)",
  master: "var(--visma-gold, #f59e0b)",
};

export function CompanyJourneyCard({ journey }: { journey: CompanyJourney }) {
  const levels: FluencyLevel[] = ["explorer", "practitioner", "integrator", "architect", "master"];
  const totalFluency = levels.reduce((sum, l) => sum + journey.fluency_distribution[l], 0);

  return (
    <div class="card">
      <div class="card-label mb-xs">Journey: {journey.company_name}</div>

      {/* Stage badge */}
      <div class="mb-sm">
        <span class="text-xs text-muted">Stage: </span>
        <span class="text-sm" style="font-weight: 600">
          {journey.stage ? stageLabels[journey.stage] : "Not started"}
        </span>
        {journey.stage_override && <span class="text-xs text-muted"> (manual)</span>}
      </div>

      {/* Fluency distribution */}
      <div class="section-title" style="font-size: 0.7rem; margin-bottom: 4px">
        Fluency Levels ({totalFluency} of {journey.total_contacts} contacts)
      </div>
      {totalFluency > 0 ? (
        <div style="display: flex; height: 20px; border-radius: 4px; overflow: hidden; margin-bottom: 12px">
          {levels.map((l) => {
            const count = journey.fluency_distribution[l];
            if (count === 0) return null;
            const pct = (count / totalFluency) * 100;
            return (
              <div
                style={`width: ${pct}%; background: ${fluencyColors[l]}; display: flex; align-items: center; justify-content: center`}
                title={`${fluencyLabels[l]}: ${count}`}
              >
                <span class="text-xs" style="color: white; font-weight: 600">{count}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div class="text-xs text-muted mb-sm">No fluency levels set yet</div>
      )}

      {/* Snapshot history */}
      {journey.snapshots.length > 0 && (
        <div>
          <div class="section-title" style="font-size: 0.7rem; margin-bottom: 4px">
            Maturity Snapshots ({journey.snapshots.length})
          </div>
          {journey.snapshots.slice(0, 5).map((s) => (
            <div class="table-row">
              <div class="text-xs text-muted" style="width: 80px">{String(s.snapshot_date).slice(0, 10)}</div>
              <div class="text-xs flex-1">
                B:{s.beginner_count} D:{s.developing_count} I:{s.intermediate_count} A:{s.advanced_count} L:{s.leader_count}
              </div>
              <div class="text-xs" style="color: var(--visma-turquoise); width: 50px; text-align: right">
                {s.avg_score !== null ? s.avg_score.toFixed(1) : "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create signals feed card**

```tsx
import type { Signal, SignalType } from "../../types/index.ts";

const signalIcons: Record<SignalType, string> = {
  new_survey: "\ud83d\udcca",
  score_change: "\ud83d\udcc8",
  content_binge: "\ud83d\udcda",
  cooling_off: "\u2744\ufe0f",
  new_person: "\ud83d\udc64",
};

const signalColors: Record<SignalType, string> = {
  new_survey: "var(--visma-turquoise)",
  score_change: "var(--visma-lime)",
  content_binge: "var(--visma-purple, #8b5cf6)",
  cooling_off: "var(--visma-coral)",
  new_person: "var(--visma-turquoise)",
};

export function SignalsFeedCard({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return (
      <div class="card">
        <div class="card-label mb-xs">Signals</div>
        <div class="text-sm text-muted">No new signals. Run /sync to check for updates.</div>
      </div>
    );
  }

  return (
    <div class="card">
      <div class="card-label mb-xs">Signals ({signals.length} active)</div>
      {signals.map((s) => (
        <div class="table-row" style="align-items: flex-start">
          <div style={`width: 24px; color: ${signalColors[s.signal_type]}`}>
            {signalIcons[s.signal_type]}
          </div>
          <div class="flex-1">
            <div class="text-sm" style="font-weight: 500">{s.title}</div>
            {s.detail && s.signal_type === "score_change" && (
              <div class="text-xs text-muted">{s.detail}</div>
            )}
            <div class="text-xs text-muted">{s.detected_at.slice(0, 10)}</div>
          </div>
          <button
            class="text-xs"
            style="background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 2px 6px"
            hx-post={`/signals/${s.id}/dismiss`}
            hx-target="#canvas"
            hx-swap="innerHTML"
            hx-vals='{"message": "signals"}'
          >
            dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/web/cards/journey-overview.tsx src/web/cards/company-journey.tsx src/web/cards/signals-feed.tsx
git commit -m "feat(journey): add journey overview, company journey, and signals feed cards"
```

---

### Task 9: Create handler files

**Files:**
- Create: `src/web/routes/handlers/journey-handlers.tsx`
- Create: `src/web/routes/handlers/signal-handlers.tsx`

- [ ] **Step 1: Create journey handlers**

```tsx
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
```

- [ ] **Step 2: Create signal handlers**

```tsx
/**
 * Signal handlers — view and dismiss engagement signals.
 */

import type { IntentHandler } from "../chat-handlers.tsx";
import { SignalsFeedCard } from "../../cards/signals-feed.tsx";
import { getActiveSignals, dismissSignal } from "../../../services/signals-service.ts";

export const handleSignals: IntentHandler = async () => {
  const signals = await getActiveSignals();
  return {
    html: <SignalsFeedCard signals={signals} />,
    summary: `${signals.length} active signals`,
  };
};

export const handleDismissSignal: IntentHandler = async (entities) => {
  // This is called via htmx POST from the dismiss button, not from chat
  // The signal ID comes through a different path — see the route handler below
  return handleSignals(entities);
};
```

- [ ] **Step 3: Commit**

```bash
git add src/web/routes/handlers/journey-handlers.tsx src/web/routes/handlers/signal-handlers.tsx
git commit -m "feat(journey): add journey + signal chat handlers"
```

---

### Task 10: Register handlers + add dismiss route

**Files:**
- Modify: `src/web/routes/chat-handlers.tsx`

- [ ] **Step 1: Add imports**

Add to the imports in `chat-handlers.tsx`:

```typescript
import { handleJourneyOverview, handleJourneyCompany, handleJourneySet, handleJourneySnapshot, handleFluencySet } from "./handlers/journey-handlers.tsx";
import { handleSignals } from "./handlers/signal-handlers.tsx";
```

- [ ] **Step 2: Register in handler map**

Add to the `handlers` object:

```typescript
  // journey (G6)
  journey_overview: handleJourneyOverview,
  journey_company: handleJourneyCompany,
  journey_set: handleJourneySet,
  journey_snapshot: handleJourneySnapshot,
  fluency_set: handleFluencySet,
  // signals (G7)
  signals: handleSignals,
```

- [ ] **Step 3: Add dismiss route to chat.tsx**

In `src/web/routes/chat.tsx`, add a route for signal dismissal:

```typescript
import { dismissSignal } from "../../services/signals-service.ts";
import { getActiveSignals } from "../../services/signals-service.ts";
import { SignalsFeedCard } from "../cards/signals-feed.tsx";

app.post("/signals/:id/dismiss", async (c) => {
  const id = c.req.param("id");
  await dismissSignal(id);
  const signals = await getActiveSignals();
  return c.html(<SignalsFeedCard signals={signals} />);
});
```

- [ ] **Step 4: Update HelpCard**

In `src/web/routes/handlers/admin-handlers.tsx`, add to the HelpCard JSX:

```tsx
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/journey</span> — AI maturity journey overview</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/journey [company]</span> — company journey detail</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/signals</span> — engagement signals feed</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">set [company] to [stage]</span> — set journey stage</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">set [contact] to [level]</span> — set fluency level</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">snapshot [company]</span> — create maturity snapshot</div>
```

- [ ] **Step 5: Commit**

```bash
git add src/web/routes/chat-handlers.tsx src/web/routes/chat.tsx src/web/routes/handlers/admin-handlers.tsx
git commit -m "feat(journey): register journey + signal handlers, add dismiss route"
```

---

## Chunk 7: End-to-End Verification

### Task 11: Manual end-to-end test

- [ ] **Step 1: Start the server**

```bash
cd /c/Projects/contact-intelligence && bun run src/index.ts
```

- [ ] **Step 2: Test journey overview (should show current state)**

In chat at `http://localhost:3002`, type: `/journey`

Expected: Shows companies grouped by stage. Most will have no stage yet until sync runs.

- [ ] **Step 3: Test sync to populate journey stages**

Type: `/sync`

Expected: Sync completes, materialize shows journey stage updates and signal detection counts.

- [ ] **Step 4: Test journey overview again**

Type: `/journey`

Expected: Companies now appear under "Exploring" or "Assessing" based on their activity data.

- [ ] **Step 5: Test company journey detail**

Type: `/journey [company name]` (pick one that has survey data)

Expected: Shows stage, fluency distribution (all unset initially), and snapshots.

- [ ] **Step 6: Test manual stage set**

Type: `set [company] to training`

Expected: Stage updates, shows "(manual)" indicator.

- [ ] **Step 7: Test snapshot**

Type: `snapshot [company]`

Expected: Creates a snapshot showing maturity level distribution from survey data.

- [ ] **Step 8: Test signals**

Type: `/signals`

Expected: Shows signals detected during sync (new surveys, new people, etc.).

- [ ] **Step 9: Test signal dismiss**

Click "dismiss" on a signal.

Expected: Signal disappears from the feed.

- [ ] **Step 10: Test fluency set**

Type: `set [contact name] to explorer`

Expected: Confirms fluency level was set.

- [ ] **Step 11: Commit any fixes**

```bash
git add -A
git commit -m "feat(journey): G6 journey + G7 signals complete"
```

- [ ] **Step 12: Push**

```bash
git push
```
