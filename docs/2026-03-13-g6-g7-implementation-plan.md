# G6 + G7: AI Maturity Journey + Engagement Signals — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add company journey tracking (5 stages, hybrid computed/manual), maturity snapshots (headcount-at-level over time), and 5 engagement signal types to Contact Intelligence.

**Architecture:** Thin layer on existing tables — 2 new columns on `companies`, 1 new `maturity_snapshots` table, 3 new activity types in existing `activities` table, signals computed at query time. Journey stage auto-computed from activities with manual override option.

**Tech Stack:** Bun + Hono + HTMX + DuckDB. LM Studio for chat intent classification. JSX components for UI cards.

**Spec:** `docs/2026-03-13-g6-g7-journey-signals.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/services/journey.ts` | Journey stage computation, refresh all stages, journey overview stats |
| `src/services/snapshots.ts` | CRUD for maturity_snapshots, snapshot creation from live survey data |
| `src/services/signals.ts` | 5 signal detection queries, merged + sorted output |
| `src/web/cards/journey-card.tsx` | JourneyFunnel, SignalsFeed, MaturityBar, SnapshotTimeline, JourneyBadge components |
| `src/web/routes/journey.tsx` | Routes: POST snapshot, POST set-stage, POST log-workshop, GET signals |

### Modified files

| File | Changes |
|------|---------|
| `src/db/schema.sql` | Add journey_stage + journey_override columns, CREATE maturity_snapshots table |
| `src/db/client.ts` | Migration: ALTER TABLE companies, CREATE TABLE maturity_snapshots |
| `src/types/index.ts` | Add JourneyStage, MaturitySnapshot, Signal types |
| `src/services/activities.ts` | No code changes needed — new types work with existing createActivity |
| `src/services/dashboard.ts` | Add journey overview + signals to getDashboardStats |
| `src/web/routes/dashboard.tsx` | Render journey funnel + signals feed on dashboard |
| `src/web/routes/companies.tsx` | Journey badge, maturity bar, snapshot timeline, action buttons on company profile |
| `src/services/local-llm.ts` | Add journey/signal intents to sub-classifiers |
| `src/web/routes/chat-handlers.tsx` | Add 6 new intent handlers + register in handlers map |
| `src/web/app.tsx` | Mount journey routes |

---

## Chunk 1: Schema, Types, and Core Services

### Task 1: Schema migration + types

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/client.ts` (migration block ~lines 51-58)
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add schema DDL**

In `src/db/schema.sql`, after the `survey_metadata` table, add:

```sql
-- AI Maturity Journey (G6)
CREATE TABLE IF NOT EXISTS maturity_snapshots (
  id VARCHAR PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  snapshot_date DATE NOT NULL,
  trigger VARCHAR NOT NULL,
  total_respondents INTEGER DEFAULT 0,
  beginner_count INTEGER DEFAULT 0,
  developing_count INTEGER DEFAULT 0,
  intermediate_count INTEGER DEFAULT 0,
  advanced_count INTEGER DEFAULT 0,
  leader_count INTEGER DEFAULT 0,
  avg_score REAL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_company ON maturity_snapshots(company_id);
```

- [ ] **Step 2: Add migration in client.ts**

In `src/db/client.ts`, inside the migration block (after existing ALTER TABLE statements), add:

```typescript
// G6: Journey columns on companies
conn.exec(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS journey_stage VARCHAR`);
conn.exec(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS journey_override BOOLEAN DEFAULT false`);

// G6: Maturity snapshots table
conn.exec(`CREATE TABLE IF NOT EXISTS maturity_snapshots (
  id VARCHAR PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  snapshot_date DATE NOT NULL,
  trigger VARCHAR NOT NULL,
  total_respondents INTEGER DEFAULT 0,
  beginner_count INTEGER DEFAULT 0,
  developing_count INTEGER DEFAULT 0,
  intermediate_count INTEGER DEFAULT 0,
  advanced_count INTEGER DEFAULT 0,
  leader_count INTEGER DEFAULT 0,
  avg_score REAL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);
conn.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_company ON maturity_snapshots(company_id)`);
```

- [ ] **Step 3: Add types in types/index.ts**

At the end of `src/types/index.ts`, add:

```typescript
// --- G6: AI Maturity Journey ---

export type JourneyStage = "awareness" | "assessed" | "workshop" | "courses" | "custom_engagement";

export interface MaturitySnapshot {
  id: string;
  company_id: number;
  snapshot_date: string;
  trigger: string;
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
  awareness: number;
  assessed: number;
  workshop: number;
  courses: number;
  custom_engagement: number;
  total: number;
}

// --- G7: Engagement Signals ---

export type SignalType = "new_survey" | "score_change" | "content_binge" | "cooling_off" | "new_person";

export interface Signal {
  type: SignalType;
  company_id: number;
  company_name: string;
  title: string;
  detail: string;
  detected_at: string;
}
```

- [ ] **Step 4: Run server to verify migration**

Run: `cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true`
Expected: Server starts, no migration errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql src/db/client.ts src/types/index.ts
git commit -m "feat(g6): add journey schema, migration, and types"
```

---

### Task 2: Journey service — stage computation + overview

**Files:**
- Create: `src/services/journey.ts`

- [ ] **Step 1: Create journey.ts**

```typescript
/**
 * Journey stage computation and overview stats.
 * Hybrid model: auto-compute from activities, with manual override.
 */

import { queryAll, queryOne, run } from "../db/client.ts";
import type { JourneyStage, JourneyOverview } from "../types/index.ts";

const STAGE_ORDER: JourneyStage[] = [
  "awareness", "assessed", "workshop", "courses", "custom_engagement",
];

/** Compute journey stage for a company based on its activities. */
export async function computeJourneyStage(companyId: number): Promise<JourneyStage> {
  // Check for override first
  const company = await queryOne<{ journey_stage: string | null; journey_override: boolean }>(
    `SELECT journey_stage, journey_override FROM companies WHERE id = $companyId`,
    { $companyId: companyId },
  );
  if (company?.journey_override && company.journey_stage) {
    return company.journey_stage as JourneyStage;
  }

  // Check highest milestone from activities
  const milestones = await queryOne<{
    has_articles: number;
    has_surveys: number;
    has_workshops: number;
    has_courses: number;
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE activity_type = 'article_view') AS has_articles,
      COUNT(*) FILTER (WHERE activity_type = 'survey_completed') AS has_surveys,
      COUNT(*) FILTER (WHERE activity_type = 'workshop_attended') AS has_workshops,
      COUNT(*) FILTER (WHERE activity_type IN ('course_enrolled', 'course_completed')) AS has_courses
    FROM activities
    WHERE company_id = $companyId
  `, { $companyId: companyId });

  if (!milestones) return "awareness";

  if (milestones.has_courses > 0) return "courses";
  if (milestones.has_workshops > 0) return "workshop";
  if (milestones.has_surveys > 0) return "assessed";
  if (milestones.has_articles > 0) return "awareness";
  return "awareness";
}

/** Update journey_stage column for a single company (skip if override). */
export async function refreshJourneyStage(companyId: number): Promise<JourneyStage> {
  const stage = await computeJourneyStage(companyId);
  const company = await queryOne<{ journey_override: boolean }>(
    `SELECT journey_override FROM companies WHERE id = $companyId`,
    { $companyId: companyId },
  );
  if (!company?.journey_override) {
    await run(
      `UPDATE companies SET journey_stage = $stage WHERE id = $companyId`,
      { $stage: stage, $companyId: companyId },
    );
  }
  return stage;
}

/** Refresh all company journey stages. Called after sync or bulk operations. */
export async function refreshAllJourneyStages(): Promise<void> {
  const companies = await queryAll<{ id: number }>(
    `SELECT id FROM companies WHERE journey_override = false OR journey_override IS NULL`,
  );
  for (const c of companies) {
    const stage = await computeJourneyStage(c.id);
    await run(
      `UPDATE companies SET journey_stage = $stage WHERE id = $companyId`,
      { $stage: stage, $companyId: c.id },
    );
  }
}

/** Set manual override for a company's journey stage. */
export async function setJourneyStage(companyId: number, stage: JourneyStage): Promise<void> {
  await run(
    `UPDATE companies SET journey_stage = $stage, journey_override = true WHERE id = $companyId`,
    { $stage: stage, $companyId: companyId },
  );
}

/** Clear manual override — recomputes from activities. */
export async function clearJourneyOverride(companyId: number): Promise<JourneyStage> {
  await run(
    `UPDATE companies SET journey_override = false WHERE id = $companyId`,
    { $companyId: companyId },
  );
  return refreshJourneyStage(companyId);
}

/** Get company counts per journey stage for dashboard funnel. */
export async function getJourneyOverview(): Promise<JourneyOverview> {
  const rows = await queryAll<{ journey_stage: string | null; count: number }>(`
    SELECT journey_stage, COUNT(*) as count
    FROM companies
    GROUP BY journey_stage
  `);

  const overview: JourneyOverview = {
    awareness: 0, assessed: 0, workshop: 0, courses: 0, custom_engagement: 0, total: 0,
  };

  for (const row of rows) {
    const stage = row.journey_stage as JourneyStage | null;
    if (stage && stage in overview) {
      overview[stage] = Number(row.count);
    } else {
      // NULL or unknown stage counts as awareness
      overview.awareness += Number(row.count);
    }
    overview.total += Number(row.count);
  }

  return overview;
}

export { STAGE_ORDER };
```

- [ ] **Step 2: Verify server starts**

Run: `cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true`
Expected: No import errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/journey.ts
git commit -m "feat(g6): add journey service with stage computation and overview"
```

---

### Task 3: Snapshots service

**Files:**
- Create: `src/services/snapshots.ts`

- [ ] **Step 1: Create snapshots.ts**

```typescript
/**
 * Maturity snapshot CRUD — captures headcount-at-level for a company at a point in time.
 */

import { queryAll, queryOne, run, generateId } from "../db/client.ts";
import { maturityLevel } from "./analytics.ts";
import type { MaturitySnapshot } from "../types/index.ts";

/** Create a snapshot from live survey data for a company. */
export async function createSnapshot(
  companyId: number,
  trigger: string,
  notes?: string,
): Promise<MaturitySnapshot> {
  // Get all survey scores for contacts at this company
  const scores = await queryAll<{ avg_score: number }>(`
    SELECT CAST(json_extract_string(detail, '$.avgScore') AS REAL) AS avg_score
    FROM activities
    WHERE company_id = $companyId
      AND activity_type = 'survey_completed'
      AND json_extract_string(detail, '$.avgScore') IS NOT NULL
  `, { $companyId: companyId });

  // Count per maturity level
  const counts = { beginner: 0, developing: 0, intermediate: 0, advanced: 0, leader: 0 };
  let totalScore = 0;

  for (const s of scores) {
    const level = maturityLevel(s.avg_score).toLowerCase() as keyof typeof counts;
    if (level in counts) counts[level]++;
    totalScore += s.avg_score;
  }

  const id = generateId();
  const avgScore = scores.length > 0 ? totalScore / scores.length : null;

  await run(`
    INSERT INTO maturity_snapshots (id, company_id, snapshot_date, trigger, total_respondents,
      beginner_count, developing_count, intermediate_count, advanced_count, leader_count,
      avg_score, notes)
    VALUES ($id, $companyId, CURRENT_DATE, $trigger, $total,
      $beginner, $developing, $intermediate, $advanced, $leader,
      $avgScore, $notes)
  `, {
    $id: id,
    $companyId: companyId,
    $trigger: trigger,
    $total: scores.length,
    $beginner: counts.beginner,
    $developing: counts.developing,
    $intermediate: counts.intermediate,
    $advanced: counts.advanced,
    $leader: counts.leader,
    $avgScore: avgScore,
    $notes: notes || null,
  });

  return (await queryOne<MaturitySnapshot>(
    `SELECT * FROM maturity_snapshots WHERE id = $id`,
    { $id: id },
  ))!;
}

/** List snapshots for a company, ordered by date DESC. */
export async function listSnapshots(companyId: number): Promise<MaturitySnapshot[]> {
  return queryAll<MaturitySnapshot>(`
    SELECT * FROM maturity_snapshots
    WHERE company_id = $companyId
    ORDER BY snapshot_date DESC
  `, { $companyId: companyId });
}

/** Get the two most recent snapshots for score comparison. */
export async function getLatestSnapshots(companyId: number): Promise<MaturitySnapshot[]> {
  return queryAll<MaturitySnapshot>(`
    SELECT * FROM maturity_snapshots
    WHERE company_id = $companyId
    ORDER BY snapshot_date DESC
    LIMIT 2
  `, { $companyId: companyId });
}
```

- [ ] **Step 2: Verify server starts**

Run: `cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true`

- [ ] **Step 3: Commit**

```bash
git add src/services/snapshots.ts
git commit -m "feat(g6): add maturity snapshots service"
```

---

### Task 4: Signals service

**Files:**
- Create: `src/services/signals.ts`

- [ ] **Step 1: Create signals.ts**

```typescript
/**
 * Engagement signal detection — all computed at query time from activities.
 * No storage table — fresh on every call.
 */

import { queryAll } from "../db/client.ts";
import type { Signal } from "../types/index.ts";

/** Detect new survey completions in last 7 days. */
async function detectNewSurveys(): Promise<Signal[]> {
  const rows = await queryAll<{
    company_id: number;
    company_name: string;
    completions: number;
    avg_score: number;
    latest: string;
  }>(`
    SELECT
      a.company_id,
      c.name AS company_name,
      COUNT(*) AS completions,
      AVG(CAST(json_extract_string(a.detail, '$.avgScore') AS REAL)) AS avg_score,
      MAX(a.occurred_at) AS latest
    FROM activities a
    JOIN companies c ON c.id = a.company_id
    WHERE a.activity_type = 'survey_completed'
      AND a.occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
    GROUP BY a.company_id, c.name
  `);

  return rows.map((r) => ({
    type: "new_survey" as const,
    company_id: Number(r.company_id),
    company_name: r.company_name,
    title: `${r.company_name} completed a survey`,
    detail: `${r.completions} respondent${r.completions > 1 ? "s" : ""} — avg ${r.avg_score?.toFixed(1) || "N/A"}`,
    detected_at: r.latest,
  }));
}

/** Detect content binges: 3+ articles read at a company in last 7 days. */
async function detectContentBinges(): Promise<Signal[]> {
  const rows = await queryAll<{
    company_id: number;
    company_name: string;
    article_count: number;
    reader_count: number;
    latest: string;
  }>(`
    SELECT
      a.company_id,
      c.name AS company_name,
      COUNT(*) AS article_count,
      COUNT(DISTINCT a.contact_id) AS reader_count,
      MAX(a.occurred_at) AS latest
    FROM activities a
    JOIN companies c ON c.id = a.company_id
    WHERE a.activity_type = 'article_view'
      AND a.occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
    GROUP BY a.company_id, c.name
    HAVING COUNT(*) >= 3
  `);

  return rows.map((r) => ({
    type: "content_binge" as const,
    company_id: Number(r.company_id),
    company_name: r.company_name,
    title: `${r.company_name} reading actively`,
    detail: `${r.article_count} articles by ${r.reader_count} people this week`,
    detected_at: r.latest,
  }));
}

/** Detect cooling off: activity in 30-90d window but nothing in last 30 days. */
async function detectCoolingOff(): Promise<Signal[]> {
  const rows = await queryAll<{
    company_id: number;
    company_name: string;
    last_activity: string;
  }>(`
    SELECT c.id AS company_id, c.name AS company_name, MAX(a.occurred_at) AS last_activity
    FROM companies c
    JOIN activities a ON a.company_id = c.id
    GROUP BY c.id, c.name
    HAVING MAX(a.occurred_at) < CURRENT_TIMESTAMP - INTERVAL '30 days'
       AND MAX(a.occurred_at) >= CURRENT_TIMESTAMP - INTERVAL '90 days'
  `);

  return rows.map((r) => ({
    type: "cooling_off" as const,
    company_id: Number(r.company_id),
    company_name: r.company_name,
    title: `${r.company_name} going quiet`,
    detail: `No activity in 30+ days (last: ${r.last_activity?.slice(0, 10)})`,
    detected_at: r.last_activity,
  }));
}

/** Detect new person at a company that's beyond awareness stage. */
async function detectNewPersons(): Promise<Signal[]> {
  const rows = await queryAll<{
    company_id: number;
    company_name: string;
    contact_name: string;
    contact_email: string;
    created_at: string;
  }>(`
    SELECT
      ct.company_id,
      c.name AS company_name,
      ct.name AS contact_name,
      ct.email AS contact_email,
      ct.created_at
    FROM contacts ct
    JOIN companies c ON c.id = ct.company_id
    WHERE ct.created_at >= CURRENT_TIMESTAMP - INTERVAL '14 days'
      AND c.journey_stage IS NOT NULL
      AND c.journey_stage != 'awareness'
  `);

  return rows.map((r) => ({
    type: "new_person" as const,
    company_id: Number(r.company_id),
    company_name: r.company_name,
    title: `New contact at ${r.company_name}`,
    detail: r.contact_name || r.contact_email,
    detected_at: r.created_at,
  }));
}

/** Detect score changes between latest two maturity snapshots. */
async function detectScoreChanges(): Promise<Signal[]> {
  // Get companies with 2+ snapshots, compare latest two
  const rows = await queryAll<{
    company_id: number;
    company_name: string;
    latest_score: number;
    previous_score: number;
    latest_date: string;
  }>(`
    WITH ranked AS (
      SELECT
        ms.company_id,
        c.name AS company_name,
        ms.avg_score,
        ms.snapshot_date,
        ROW_NUMBER() OVER (PARTITION BY ms.company_id ORDER BY ms.snapshot_date DESC) AS rn
      FROM maturity_snapshots ms
      JOIN companies c ON c.id = ms.company_id
      WHERE ms.avg_score IS NOT NULL
    )
    SELECT
      r1.company_id,
      r1.company_name,
      r1.avg_score AS latest_score,
      r2.avg_score AS previous_score,
      r1.snapshot_date AS latest_date
    FROM ranked r1
    JOIN ranked r2 ON r1.company_id = r2.company_id AND r2.rn = 2
    WHERE r1.rn = 1
      AND ABS(r1.avg_score - r2.avg_score) > 0.5
  `);

  return rows.map((r) => {
    const delta = r.latest_score - r.previous_score;
    const direction = delta > 0 ? "improved" : "declined";
    return {
      type: "score_change" as const,
      company_id: Number(r.company_id),
      company_name: r.company_name,
      title: `${r.company_name} score ${direction}`,
      detail: `${r.previous_score.toFixed(1)} → ${r.latest_score.toFixed(1)} (${delta > 0 ? "+" : ""}${delta.toFixed(1)})`,
      detected_at: r.latest_date,
    };
  });
}

/** Get all signals, merged and sorted by detected_at DESC. */
export async function getSignals(limit: number = 20): Promise<Signal[]> {
  const [surveys, binges, cooling, newPersons, scoreChanges] = await Promise.all([
    detectNewSurveys(),
    detectContentBinges(),
    detectCoolingOff(),
    detectNewPersons(),
    detectScoreChanges(),
  ]);

  const all = [...surveys, ...binges, ...cooling, ...newPersons, ...scoreChanges];
  all.sort((a, b) => (b.detected_at || "").localeCompare(a.detected_at || ""));
  return all.slice(0, limit);
}
```

- [ ] **Step 2: Verify server starts**

Run: `cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true`

- [ ] **Step 3: Commit**

```bash
git add src/services/signals.ts
git commit -m "feat(g7): add engagement signals service with 5 detection rules"
```

---

## Chunk 2: UI Cards and Routes

### Task 5: Journey UI cards

**Files:**
- Create: `src/web/cards/journey-card.tsx`

- [ ] **Step 1: Create journey-card.tsx**

Build 5 components for journey/signal rendering. Follow patterns from existing cards (company-profile.tsx, briefing-card.tsx).

```tsx
/**
 * Journey and signal UI components.
 */

import type { JourneyOverview, JourneyStage, MaturitySnapshot, Signal } from "../../types/index.ts";

const STAGE_COLORS: Record<JourneyStage, string> = {
  awareness: "#4CAF50",
  assessed: "#2196F3",
  workshop: "#FF9800",
  courses: "#E91E63",
  custom_engagement: "#9C27B0",
};

const STAGE_LABELS: Record<JourneyStage, string> = {
  awareness: "Awareness",
  assessed: "Assessed",
  workshop: "Workshop",
  courses: "Courses",
  custom_engagement: "Custom",
};

const SIGNAL_COLORS: Record<string, string> = {
  new_survey: "#4CAF50",
  score_change: "#2196F3",
  content_binge: "#FF9800",
  cooling_off: "#E91E63",
  new_person: "#9C27B0",
};

const SIGNAL_LABELS: Record<string, string> = {
  new_survey: "NEW SURVEY",
  score_change: "SCORE CHANGE",
  content_binge: "CONTENT BINGE",
  cooling_off: "COOLING OFF",
  new_person: "NEW PERSON",
};

/** Horizontal funnel bar showing company count per journey stage. */
export function JourneyFunnel({ overview }: { overview: JourneyOverview }) {
  const stages: JourneyStage[] = ["awareness", "assessed", "workshop", "courses", "custom_engagement"];

  return (
    <div class="card">
      <div class="card-label mb-xs">AI Maturity Journey</div>
      <div style="display:flex;gap:4px;margin-bottom:8px">
        {stages.map((stage) => {
          const count = overview[stage];
          if (count === 0 && overview.total > 0) {
            return (
              <div
                style={`flex:0.5;background:${STAGE_COLORS[stage]}22;padding:4px;border-radius:4px;text-align:center;font-size:11px;color:${STAGE_COLORS[stage]};cursor:pointer;min-width:50px`}
                hx-get={`/companies?stage=${stage}`}
                hx-target="#canvas"
                hx-swap="innerHTML"
              >
                {STAGE_LABELS[stage]}<br /><span style="font-size:14px;font-weight:600">0</span>
              </div>
            );
          }
          return (
            <div
              style={`flex:${Math.max(count, 1)};background:${STAGE_COLORS[stage]};padding:4px;border-radius:4px;text-align:center;font-size:11px;color:#000;font-weight:600;cursor:pointer;min-width:50px`}
              hx-get={`/companies?stage=${stage}`}
              hx-target="#canvas"
              hx-swap="innerHTML"
            >
              {STAGE_LABELS[stage]}<br /><span style="font-size:14px">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Signals feed — list of detected engagement signals. */
export function SignalsFeed({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return (
      <div class="card">
        <div class="card-label mb-xs">Signals</div>
        <div class="text-sm text-muted">No signals detected.</div>
      </div>
    );
  }

  return (
    <div class="card">
      <div class="card-label mb-xs">Signals</div>
      {signals.map((s) => (
        <div
          class="table-row card-clickable"
          style={`border-left:3px solid ${SIGNAL_COLORS[s.type] || "#888"};padding-left:10px`}
          hx-get={`/companies/${s.company_id}`}
          hx-target="#canvas"
          hx-swap="innerHTML"
        >
          <div class="flex-1">
            <div class="text-sm">
              <span style={`color:${SIGNAL_COLORS[s.type]};font-weight:600;font-size:10px`}>
                {SIGNAL_LABELS[s.type] || s.type.toUpperCase()}
              </span>
              {" · "}{s.company_name}
            </div>
            <div class="text-xs text-muted">{s.detail}</div>
          </div>
          <div class="text-xs text-muted">{s.detected_at?.slice(0, 10)}</div>
        </div>
      ))}
    </div>
  );
}

/** Journey stage badge for company profile header. */
export function JourneyBadge({ stage }: { stage: JourneyStage | null }) {
  if (!stage) return null;
  return (
    <span style={`background:${STAGE_COLORS[stage] || "#888"};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;text-transform:uppercase`}>
      {STAGE_LABELS[stage] || stage}
    </span>
  );
}

/** Stacked horizontal bar for maturity distribution. */
export function MaturityBar({ snapshot }: { snapshot: MaturitySnapshot }) {
  const levels = [
    { key: "beginner", count: snapshot.beginner_count, color: "#E91E63", label: "Beginner" },
    { key: "developing", count: snapshot.developing_count, color: "#FF9800", label: "Developing" },
    { key: "intermediate", count: snapshot.intermediate_count, color: "#2196F3", label: "Intermediate" },
    { key: "advanced", count: snapshot.advanced_count, color: "#4CAF50", label: "Advanced" },
    { key: "leader", count: snapshot.leader_count, color: "#9C27B0", label: "Leader" },
  ];
  const total = levels.reduce((sum, l) => sum + l.count, 0);
  if (total === 0) return <div class="text-xs text-muted">No survey data for snapshot.</div>;

  return (
    <div>
      <div class="text-xs text-muted mb-xs">
        Maturity Distribution ({snapshot.total_respondents} respondents — {snapshot.trigger})
      </div>
      <div style="display:flex;height:24px;border-radius:4px;overflow:hidden;margin-bottom:4px">
        {levels.filter((l) => l.count > 0).map((l) => (
          <div style={`flex:${l.count};background:${l.color};display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;font-weight:600`}>
            {l.count}
          </div>
        ))}
      </div>
      <div style="display:flex;gap:10px;font-size:10px;color:#888">
        {levels.map((l) => (
          <span><span style={`color:${l.color}`}>■</span> {l.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Timeline of maturity snapshots with score progression. */
export function SnapshotTimeline({ snapshots }: { snapshots: MaturitySnapshot[] }) {
  if (snapshots.length === 0) {
    return <div class="text-xs text-muted">No maturity snapshots yet. Use "Take Snapshot" to capture current state.</div>;
  }

  const sorted = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  return (
    <div>
      <div class="card-label mb-xs">Score Progression</div>
      <div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap">
        {sorted.map((s, i) => {
          const height = s.avg_score ? Math.round((s.avg_score / 5) * 48) : 4;
          const color = s.avg_score && s.avg_score >= 3.5 ? "#4CAF50" : s.avg_score && s.avg_score >= 2.5 ? "#2196F3" : "#FF9800";
          const prev = i > 0 ? sorted[i - 1] : null;
          const delta = prev?.avg_score && s.avg_score ? s.avg_score - prev.avg_score : null;
          return (
            <div style="text-align:center">
              <div style={`background:#333;width:40px;height:48px;border-radius:3px;display:flex;align-items:flex-end`}>
                <div style={`background:${color};width:100%;height:${height}px;border-radius:0 0 3px 3px`} />
              </div>
              <div class="text-xs text-muted" style="margin-top:2px">{s.trigger}</div>
              <div style={`font-size:11px;color:${color};font-weight:600`}>{s.avg_score?.toFixed(1) || "—"}</div>
              {delta !== null && (
                <div style={`font-size:10px;color:${delta >= 0 ? "#4CAF50" : "#E91E63"}`}>
                  {delta >= 0 ? "+" : ""}{delta.toFixed(1)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify no import errors**

Run: `cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true`

- [ ] **Step 3: Commit**

```bash
git add src/web/cards/journey-card.tsx
git commit -m "feat(g6): add journey UI components (funnel, signals, badge, maturity bar, timeline)"
```

---

### Task 6: Journey routes

**Files:**
- Create: `src/web/routes/journey.tsx`
- Modify: `src/web/app.tsx`

- [ ] **Step 1: Create journey.tsx routes**

```tsx
/**
 * Journey-related routes: snapshots, set stage, log workshop.
 */

import { Hono } from "hono";
import { createSnapshot, listSnapshots } from "../../services/snapshots.ts";
import { setJourneyStage, clearJourneyOverride } from "../../services/journey.ts";
import { getSignals } from "../../services/signals.ts";
import { createActivity } from "../../services/activities.ts";
import { getCompany } from "../../services/companies.ts";
import { listContacts } from "../../services/contacts.ts";
import { listActivities } from "../../services/activities.ts";
import { refreshJourneyStage } from "../../services/journey.ts";
import { summarizeActivities } from "../../services/local-llm.ts";
import { CompanyProfileCard } from "../cards/company-profile.tsx";
import { SignalsFeed } from "../cards/journey-card.tsx";
import { generateId } from "../../db/client.ts";
import type { JourneyStage } from "../../types/index.ts";

const app = new Hono();

/** POST /journey/snapshot — create maturity snapshot for a company. */
app.post("/journey/snapshot", async (c) => {
  const body = await c.req.parseBody();
  const companyId = Number(body.company_id);
  const trigger = (body.trigger as string || "manual").trim();
  const notes = (body.notes as string || "").trim() || undefined;

  if (!companyId) return c.html(<div class="card text-sm text-muted">Company ID required.</div>, 400);

  await createSnapshot(companyId, trigger, notes);

  // Re-render company profile to show updated snapshot
  const company = await getCompany(companyId);
  if (!company) return c.html(<div class="card text-sm text-muted">Company not found.</div>, 404);
  const contacts = await listContacts({ companyId });
  const activities = await listActivities({ companyId, limit: 20 });
  const summary = await summarizeActivities(activities, company.name);
  const snaps = await listSnapshots(companyId);

  return c.html(<CompanyProfileCard company={company} contacts={contacts} activities={activities} summary={summary} snapshots={snaps} />);
});

/** POST /journey/set-stage — manually override journey stage. */
app.post("/journey/set-stage", async (c) => {
  const body = await c.req.parseBody();
  const companyId = Number(body.company_id);
  const stage = body.stage as string;

  if (!companyId) return c.html(<div class="card text-sm text-muted">Company ID required.</div>, 400);

  const validStages: JourneyStage[] = ["awareness", "assessed", "workshop", "courses", "custom_engagement"];
  if (stage === "auto") {
    await clearJourneyOverride(companyId);
  } else if (validStages.includes(stage as JourneyStage)) {
    await setJourneyStage(companyId, stage as JourneyStage);
  } else {
    return c.html(<div class="card text-sm text-muted">Invalid stage: {stage}</div>, 400);
  }

  // Re-render company profile
  const company = await getCompany(companyId);
  if (!company) return c.html(<div class="card text-sm text-muted">Company not found.</div>, 404);
  const contacts = await listContacts({ companyId });
  const activities = await listActivities({ companyId, limit: 20 });
  const summary = await summarizeActivities(activities, company.name);
  const snaps = await listSnapshots(companyId);

  return c.html(<CompanyProfileCard company={company} contacts={contacts} activities={activities} summary={summary} snapshots={snaps} />);
});

/** POST /journey/log-workshop — log a workshop activity for a company. */
app.post("/journey/log-workshop", async (c) => {
  const body = await c.req.parseBody();
  const companyId = Number(body.company_id);
  const workshopName = (body.name as string || "AI Fluency Workshop").trim();
  const attendeeCount = Number(body.attendee_count) || 0;

  if (!companyId) return c.html(<div class="card text-sm text-muted">Company ID required.</div>, 400);

  // Create company-level activity
  await createActivity(
    null, companyId, "workshop_attended", "manual", generateId(),
    workshopName,
    JSON.stringify({ name: workshopName, date: new Date().toISOString().slice(0, 10), attendee_count: attendeeCount }),
    new Date().toISOString(),
  );

  // Refresh journey stage
  await refreshJourneyStage(companyId);

  // Re-render company profile
  const company = await getCompany(companyId);
  if (!company) return c.html(<div class="card text-sm text-muted">Company not found.</div>, 404);
  const contacts = await listContacts({ companyId });
  const activities = await listActivities({ companyId, limit: 20 });
  const summary = await summarizeActivities(activities, company.name);
  const snaps = await listSnapshots(companyId);

  return c.html(<CompanyProfileCard company={company} contacts={contacts} activities={activities} summary={summary} snapshots={snaps} />);
});

/** GET /journey/signals — standalone signals feed. */
app.get("/journey/signals", async (c) => {
  const limit = Number(c.req.query("limit")) || 20;
  const signals = await getSignals(limit);
  return c.html(<SignalsFeed signals={signals} />);
});

export default app;
```

- [ ] **Step 2: Mount in app.tsx**

In `src/web/app.tsx`, add import and mount:

```typescript
import journey from "./routes/journey.tsx";
```

Mount before the 404 handler:
```typescript
app.route("/", journey);
```

- [ ] **Step 3: Verify server starts**

Run: `cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true`

- [ ] **Step 4: Commit**

```bash
git add src/web/routes/journey.tsx src/web/app.tsx
git commit -m "feat(g6): add journey routes (snapshot, set-stage, log-workshop, signals)"
```

---

### Task 7: Dashboard integration — journey funnel + signals

**Files:**
- Modify: `src/services/dashboard.ts`
- Modify: `src/web/routes/dashboard.tsx`

- [ ] **Step 1: Extend getDashboardStats**

In `src/services/dashboard.ts`, add imports at top:

```typescript
import { getJourneyOverview } from "./journey.ts";
import { getSignals } from "./signals.ts";
import type { JourneyOverview, Signal } from "../types/index.ts";
```

At the end of `getDashboardStats()`, before the return statement, add:

```typescript
const journeyOverview = await getJourneyOverview();
const signals = await getSignals(10);
```

Add these to the returned object:

```typescript
journeyOverview,
signals,
```

Update the DashboardStats type (or inline type) to include these fields.

- [ ] **Step 2: Update dashboard.tsx rendering**

In `src/web/routes/dashboard.tsx`, add imports:

```typescript
import { JourneyFunnel, SignalsFeed } from "../cards/journey-card.tsx";
```

In the `DashboardStatsCard` component, after the stats summary row and before recent activity, add:

```tsx
<JourneyFunnel overview={stats.journeyOverview} />
<SignalsFeed signals={stats.signals} />
```

- [ ] **Step 3: Verify server starts and dashboard loads**

Run: `cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true`

- [ ] **Step 4: Commit**

```bash
git add src/services/dashboard.ts src/web/routes/dashboard.tsx
git commit -m "feat(g6): add journey funnel and signals feed to dashboard"
```

---

### Task 8: Company profile integration — badge, maturity bar, snapshots, actions

**Files:**
- Modify: `src/web/routes/companies.tsx`
- Modify: `src/web/cards/company-profile.tsx`

- [ ] **Step 1: Update company profile route to load journey data**

In `src/web/routes/companies.tsx`, at `GET /companies/:id` handler (around line 62), add:

```typescript
import { refreshJourneyStage } from "../../services/journey.ts";
import { listSnapshots } from "../../services/snapshots.ts";
```

After loading company/contacts/activities, add:

```typescript
await refreshJourneyStage(Number(id));
const company = await getCompany(Number(id)); // re-fetch after stage refresh
const snapshots = await listSnapshots(Number(id));
```

Pass `snapshots` to `CompanyProfileCard`:

```tsx
<CompanyProfileCard company={company} contacts={contacts} activities={activities} summary={summary} snapshots={snapshots} />
```

- [ ] **Step 2: Update CompanyProfileCard to render journey data**

In `src/web/cards/company-profile.tsx`, add imports:

```typescript
import { JourneyBadge, MaturityBar, SnapshotTimeline } from "./journey-card.tsx";
import type { MaturitySnapshot, JourneyStage } from "../../types/index.ts";
```

Add `snapshots?: MaturitySnapshot[]` to the component props.

In the header area (near company name), add journey badge:

```tsx
<JourneyBadge stage={company.journey_stage as JourneyStage} />
```

After the existing content (contacts list, activities), add a journey section:

```tsx
{/* Maturity & Journey */}
{snapshots && snapshots.length > 0 && (
  <div class="card" style="margin-top:12px">
    <MaturityBar snapshot={snapshots[0]!} />
    <div style="margin-top:16px">
      <SnapshotTimeline snapshots={snapshots} />
    </div>
  </div>
)}

{/* Journey Actions */}
<div style="display:flex;gap:8px;margin-top:12px">
  <form hx-post="/journey/snapshot" hx-target="#canvas" hx-swap="innerHTML" style="display:inline">
    <input type="hidden" name="company_id" value={company.id} />
    <input type="hidden" name="trigger" value="manual" />
    <button type="submit" class="btn btn-sm">Take Snapshot</button>
  </form>
  <form hx-post="/journey/log-workshop" hx-target="#canvas" hx-swap="innerHTML" style="display:inline">
    <input type="hidden" name="company_id" value={company.id} />
    <input type="hidden" name="attendee_count" value="0" />
    <button type="submit" class="btn btn-sm">Log Workshop</button>
  </form>
  <select
    name="stage"
    hx-post="/journey/set-stage"
    hx-target="#canvas"
    hx-swap="innerHTML"
    hx-include="closest div"
    hx-vals={`{"company_id": ${company.id}}`}
    class="btn btn-sm"
    style="background:var(--surface);border:1px solid var(--border)"
  >
    <option value="" disabled selected>Set Stage...</option>
    <option value="awareness">Awareness</option>
    <option value="assessed">Assessed</option>
    <option value="workshop">Workshop</option>
    <option value="courses">Courses</option>
    <option value="custom_engagement">Custom</option>
    <option value="auto">Auto (clear override)</option>
  </select>
</div>
```

- [ ] **Step 3: Add stage filter to company list route**

In `src/web/routes/companies.tsx`, at `GET /companies` handler, read the `stage` query param:

```typescript
const stage = c.req.query("stage");
```

Pass it to `listCompanies` (requires adding stage filter support to `src/services/companies.ts`):

In `src/services/companies.ts`, in the `listCompanies` function, add optional `stage` parameter to the options and a WHERE clause:

```typescript
if (opts?.stage) {
  sql += ` AND c.journey_stage = $stage`;
  params.$stage = opts.stage;
}
```

- [ ] **Step 4: Verify server starts**

Run: `cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true`

- [ ] **Step 5: Commit**

```bash
git add src/web/routes/companies.tsx src/web/cards/company-profile.tsx src/services/companies.ts
git commit -m "feat(g6): add journey badge, maturity bar, snapshots, and actions to company profile"
```

---

## Chunk 3: Chat Integration + Final Wiring

### Task 9: Add journey/signal intents to LLM classification

**Files:**
- Modify: `src/services/local-llm.ts`

- [ ] **Step 1: Update subClassifyViewData**

In the `subClassifyViewData` function, add patterns:

```typescript
if (/journey|stage|funnel|pipeline/i.test(msg)) return "journey_overview";
if (/signal|alert|notice|what.s.new|what.s.happening/i.test(msg)) return "signals";
```

Add these before the existing dashboard fallback.

- [ ] **Step 2: Update subClassifyAction**

In the `subClassifyAction` function, add patterns:

```typescript
if (/log.?workshop|record.?workshop|workshop.?for/i.test(msg)) return "log_workshop";
if (/snapshot|capture.?maturity|take.?snapshot/i.test(msg)) return "take_snapshot";
if (/set.?stage|move.?to|advance.?to|override.?stage/i.test(msg)) return "set_stage";
```

- [ ] **Step 3: Update regexFallback**

In the `regexFallback` function, add patterns for the new intents before the general company/contact patterns:

```typescript
if (/journey|funnel|stage.?overview/i.test(msg)) return { intent: "journey_overview", entities: {}, confidence: 0.7, resolvedFromContext: false };
if (/signal|alert|what.?s.?new|what.?s.?happening/i.test(msg)) return { intent: "signals", entities: {}, confidence: 0.7, resolvedFromContext: false };
if (/log.?workshop/i.test(msg)) {
  const nameMatch = msg.match(/(?:for|at)\s+(.+?)(?:\s+with|\s*$)/i);
  const countMatch = msg.match(/(\d+)\s*attendee/i);
  return { intent: "log_workshop", entities: { name: nameMatch?.[1], limit: countMatch ? parseInt(countMatch[1]) : undefined }, confidence: 0.7, resolvedFromContext: false };
}
if (/snapshot|capture.?maturity/i.test(msg)) {
  const nameMatch = msg.match(/(?:for|at)\s+(.+?)(?:,|\s*$)/i);
  const triggerMatch = msg.match(/(pre|post)[\s-]?(workshop|course|survey)/i);
  return { intent: "take_snapshot", entities: { name: nameMatch?.[1], slug: triggerMatch ? triggerMatch[0].replace(/\s+/g, "-").toLowerCase() : undefined }, confidence: 0.7, resolvedFromContext: false };
}
```

- [ ] **Step 4: Verify server starts**

Run: `cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true`

- [ ] **Step 5: Commit**

```bash
git add src/services/local-llm.ts
git commit -m "feat(g6): add journey and signal intents to LLM classification"
```

---

### Task 10: Add journey/signal chat handlers

**Files:**
- Modify: `src/web/routes/chat-handlers.tsx`

- [ ] **Step 1: Add handler imports**

At the top of `chat-handlers.tsx`, add:

```typescript
import { getJourneyOverview, refreshJourneyStage } from "../../services/journey.ts";
import { createSnapshot, listSnapshots } from "../../services/snapshots.ts";
import { getSignals } from "../../services/signals.ts";
import { createActivity } from "../../services/activities.ts";
import { JourneyFunnel, SignalsFeed, SnapshotTimeline } from "../cards/journey-card.tsx";
import { generateId } from "../../db/client.ts";
```

- [ ] **Step 2: Add handler functions**

```typescript
/** Show journey overview funnel. */
async function handleJourneyOverview(): Promise<DispatchResult> {
  const overview = await getJourneyOverview();
  return {
    html: <JourneyFunnel overview={overview} />,
    summary: `Journey overview: ${overview.total} companies across 5 stages`,
  };
}

/** Show signals feed. */
async function handleSignals(entities: QueryUnderstanding["entities"]): Promise<DispatchResult> {
  const limit = entities.limit || 15;
  const signals = await getSignals(limit);
  return {
    html: <SignalsFeed signals={signals} />,
    summary: `Showing ${signals.length} engagement signals`,
  };
}

/** Log a workshop for a company via chat. */
async function handleLogWorkshop(entities: QueryUnderstanding["entities"]): Promise<DispatchResult> {
  if (!entities.name) {
    return { html: <div class="card"><div class="text-sm text-muted">Which company? Try: "log workshop for Acme with 10 attendees"</div></div>, summary: "Asked for company name" };
  }
  const result = await resolveCompany(entities.name);
  if (result.type !== "found") {
    return { html: <div class="card"><div class="text-sm text-muted">Company "{entities.name}" not found.</div></div>, summary: `No company found for "${entities.name}"` };
  }
  const company = result.item!;
  const attendeeCount = entities.limit || 0;

  await createActivity(
    null, company.id, "workshop_attended", "manual", generateId(),
    "AI Fluency Workshop",
    JSON.stringify({ name: "AI Fluency Workshop", date: new Date().toISOString().slice(0, 10), attendee_count: attendeeCount }),
    new Date().toISOString(),
  );
  await refreshJourneyStage(company.id);

  return {
    html: <div class="card"><div class="text-sm" style="color:var(--visma-green)">Workshop logged for {company.name} with {attendeeCount} attendees. Journey stage updated.</div></div>,
    summary: `Logged workshop for ${company.name}`,
    entityId: company.id, entityName: company.name, entityType: "company",
  };
}

/** Take a maturity snapshot for a company. */
async function handleTakeSnapshot(entities: QueryUnderstanding["entities"]): Promise<DispatchResult> {
  if (!entities.name) {
    return { html: <div class="card"><div class="text-sm text-muted">Which company? Try: "take snapshot for Acme, pre-workshop"</div></div>, summary: "Asked for company name" };
  }
  const result = await resolveCompany(entities.name);
  if (result.type !== "found") {
    return { html: <div class="card"><div class="text-sm text-muted">Company "{entities.name}" not found.</div></div>, summary: `No company found for "${entities.name}"` };
  }
  const company = result.item!;
  const trigger = entities.slug || "manual";

  const snapshot = await createSnapshot(company.id, trigger);
  const allSnapshots = await listSnapshots(company.id);

  return {
    html: (
      <div class="card">
        <div class="text-sm" style="color:var(--visma-green)">Snapshot captured for {company.name} ({trigger}): {snapshot.total_respondents} respondents, avg {snapshot.avg_score?.toFixed(1) || "N/A"}</div>
        <div style="margin-top:12px">
          <SnapshotTimeline snapshots={allSnapshots} />
        </div>
      </div>
    ),
    summary: `Snapshot for ${company.name}: ${snapshot.total_respondents} respondents`,
    entityId: company.id, entityName: company.name, entityType: "company",
  };
}

/** Set journey stage for a company. */
async function handleSetStage(entities: QueryUnderstanding["entities"]): Promise<DispatchResult> {
  if (!entities.name) {
    return { html: <div class="card"><div class="text-sm text-muted">Which company? Try: "set Acme to workshop stage"</div></div>, summary: "Asked for company name" };
  }
  const result = await resolveCompany(entities.name);
  if (result.type !== "found") {
    return { html: <div class="card"><div class="text-sm text-muted">Company "{entities.name}" not found.</div></div>, summary: `No company found for "${entities.name}"` };
  }
  // Extract stage from entity fields — use slug or try to parse from name
  const stageStr = entities.slug || entities.industry; // reuse available fields
  const validStages = ["awareness", "assessed", "workshop", "courses", "custom_engagement"];
  if (!stageStr || !validStages.includes(stageStr)) {
    return { html: <div class="card"><div class="text-sm text-muted">Valid stages: awareness, assessed, workshop, courses, custom_engagement</div></div>, summary: "Asked for valid stage" };
  }
  const company = result.item!;
  const { setJourneyStage } = await import("../../services/journey.ts");
  await setJourneyStage(company.id, stageStr as any);

  return {
    html: <div class="card"><div class="text-sm" style="color:var(--visma-green)">{company.name} set to "{stageStr}" stage (manual override).</div></div>,
    summary: `Set ${company.name} to ${stageStr}`,
    entityId: company.id, entityName: company.name, entityType: "company",
  };
}
```

- [ ] **Step 3: Register handlers in the handlers map**

Add to the handlers record (around line 366-388):

```typescript
journey_overview: handleJourneyOverview,
signals: handleSignals,
log_workshop: handleLogWorkshop,
take_snapshot: handleTakeSnapshot,
set_stage: handleSetStage,
```

- [ ] **Step 4: Verify server starts**

Run: `cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true`

- [ ] **Step 5: Commit**

```bash
git add src/web/routes/chat-handlers.tsx
git commit -m "feat(g6): add journey and signal chat handlers (6 new intents)"
```

---

### Task 11: Refresh journey stages after sync

**Files:**
- Modify: `src/web/routes/chat-handlers.tsx`

- [ ] **Step 1: Add journey refresh to sync handler**

In the `handleSync` function (around lines 270-323), after the materialize step and before the enrich step, add:

```typescript
import { refreshAllJourneyStages } from "../../services/journey.ts";

// After materialize, refresh journey stages
await refreshAllJourneyStages();
```

This ensures all company journey stages are up to date after new data is synced.

- [ ] **Step 2: Commit**

```bash
git add src/web/routes/chat-handlers.tsx
git commit -m "feat(g6): refresh journey stages after data sync"
```

---

### Task 12: Verify end-to-end and push

- [ ] **Step 1: Start server and verify**

Run: `cd /c/Projects/contact-intelligence && timeout 5 bun run src/index.ts 2>&1 || true`
Expected: Clean startup, no errors.

- [ ] **Step 2: Push all commits**

```bash
cd /c/Projects/contact-intelligence && git push
```

- [ ] **Step 3: Update roadmap memory**

Update G6 and G7 status in `roadmap.md` memory file to "Done".
