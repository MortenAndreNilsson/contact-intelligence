# G6: AI Maturity Journey + G7: Engagement Signals — Design Spec

> **Goal:** Track company engagement stages and individual fluency levels aligned to the AI Fluency program (Explorer → Master), detect notable engagement signals, and surface both through the chat interface.

**Date:** 2026-03-18
**Status:** Approved
**Project:** Contact Intelligence (`C:\Projects\contact-intelligence\`)

---

## Overview

Two interlocking features:

- **G6 (Journey):** Per-company engagement stage tracking + per-contact fluency level + maturity snapshots over time
- **G7 (Signals):** Rule-based detection of notable engagement events, surfaced as a dismissable feed

G6 is the backbone — it gives structure to where each company and contact is in the AI Fluency program. G7 is a layer on top — it tells you what changed since you last looked.

---

## 1. Two-Level Maturity Model

### Individual Level (Contacts)

Aligned to the AI Fluency course program:

| Level | Name | Description |
|-------|------|-------------|
| `explorer` | Explorer (Level 1) | First Contact — build the habit of reaching for AI, 20 AI-assisted tasks |
| `practitioner` | Practitioner (Level 2) | Building Discernment — prompting via Product/Process/Performance, 30-day cycles |
| `integrator` | Integrator (Level 3) | Thinking Together — AI as co-pilot, capstone project, failure analysis |
| `architect` | Architect (Level 4) | Building Systems — design AI systems for others, context engineering, governance |
| `master` | Master (Level 5) | Multiplying — create capability in others, take a beginner to Explorer |

**Data source:** Future Firebase course completion data. Until then: manual assignment via chat, or rough inference from survey scores.

### Company Level (Engagement Stage)

Tracks the consulting engagement lifecycle:

| Stage | Meaning | Auto-trigger |
|-------|---------|--------------|
| `exploring` | Contacts reading content, no formal engagement | Has article_view activities |
| `assessing` | Running surveys to baseline maturity | First survey_completed activity |
| `training` | Active in AI Fluency / course programs | Manual flag (future: course data) |
| `scaling` | Multiple people progressing through levels | Manual flag (future: certified contact threshold) |
| `self_sustaining` | Internal capability established | Manual flag |

**Auto-classification rules:**
- Stage auto-advances only for `exploring` → `assessing` (triggered by first survey completion)
- `training`, `scaling`, `self_sustaining` require manual override — until course data from Firebase arrives
- `journey_override = true` prevents auto-changes
- Stage never auto-downgrades

---

## 2. Data Model

### Modified tables

**`contacts`** — add fluency columns:
```sql
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fluency_level VARCHAR;
-- Values: 'explorer' | 'practitioner' | 'integrator' | 'architect' | 'master'
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fluency_certified_at VARCHAR;
-- When they achieved this level (future: from course data)
```

**`companies`** — journey_stage values change:
- Existing columns: `journey_stage VARCHAR`, `journey_override BOOLEAN DEFAULT false`
- Old values: `awareness | assessed | workshop | courses | custom_engagement`
- New values: `exploring | assessing | training | scaling | self_sustaining`
- Migration needed: `UPDATE companies SET journey_stage = CASE journey_stage WHEN 'awareness' THEN 'exploring' WHEN 'assessed' THEN 'assessing' WHEN 'workshop' THEN 'training' WHEN 'courses' THEN 'scaling' WHEN 'custom_engagement' THEN 'self_sustaining' ELSE journey_stage END WHERE journey_stage IS NOT NULL`

**`maturity_snapshots`** — already exists in schema, no changes needed. Fix TypeScript interface:
- `company_id` should be `string` not `number`
- `trigger` field should be renamed to `trigger_type` to match the DB column name

**Note:** Snapshot level columns (`beginner_count`, `developing_count`, etc.) track survey-based self-assessed maturity. These are a different classification than the course-based fluency levels (explorer, practitioner, etc.). Both are valuable — surveys measure awareness, courses measure demonstrated capability. They coexist.

### New table

**`signals`** — persisted engagement signals:
```sql
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
CREATE INDEX IF NOT EXISTS idx_signals_dismissed ON signals(dismissed);
```

Signal types: `new_survey`, `score_change`, `content_binge`, `cooling_off`, `new_person`

**Updated `Signal` TypeScript interface** (replaces current):
```typescript
export interface Signal {
  id: string;
  signal_type: SignalType;
  company_id: string;        // was number, now matches VARCHAR
  company_name?: string;     // from JOIN, not stored
  title: string;
  detail: string | null;
  detected_at: string;
  dismissed: boolean;
  created_at: string;
}
```

---

## 3. Services

### `journey-service.ts` — core journey logic

| Function | Purpose |
|----------|---------|
| `computeJourneyStage(companyId)` | Auto-compute stage from activities/surveys. Only auto-advances `exploring` → `assessing`. Respects `journey_override`. |
| `updateJourneyStage(companyId, stage)` | Manual override via chat. Sets `journey_override = true`. |
| `getJourneyOverview()` | Dashboard roll-up: company count at each stage. |
| `getCompanyJourney(companyId)` | Full journey view: stage, fluency distribution, snapshot history. |
| `createSnapshot(companyId, trigger)` | Capture headcount-at-level from survey data. Trigger: `'survey'`, `'manual'`, `'course'`. |
| `autoSnapshotIfNeeded(companyId)` | Called during materialize — creates snapshot only if new survey data since last snapshot. |
| `getFluencyDistribution(companyId)` | Count contacts at each fluency level for a company. |
| `setContactFluencyLevel(contactId, level)` | Set a contact's fluency level manually. |

### `signals-service.ts` — signal detection

| Function | Purpose |
|----------|---------|
| `detectSignals()` | Scan for new signals since last detection. Returns newly created signals. |
| `getActiveSignals(limit?)` | Undismissed signals, newest first. |
| `dismissSignal(id)` | Mark one signal as acted on. |
| `dismissAllForCompany(companyId)` | Bulk dismiss for a company. |

**Detection rules** (all query existing DuckDB data):

| Signal Type | Rule |
|-------------|------|
| `new_survey` | `survey_completed` activity exists with no matching signal |
| `score_change` | Company avg score changed by >0.5 since last snapshot |
| `content_binge` | Contact read 5+ articles in 7 days |
| `cooling_off` | Company had 3+ activities in previous 30 days but none in last 14 |
| `new_person` | New contact appeared at a company already in the system |

### Integration hooks

- **`materialize()`** calls `autoSnapshotIfNeeded()` for companies with new survey data, and `computeJourneyStage()` to update stages
- **`detectSignals()`** called during sync pipeline (after materialize) only — dashboard reads persisted signals, does not re-detect

---

## 4. Chat Interface

### New intents

| Command | Intent | Handler | Description |
|---------|--------|---------|-------------|
| `/journey` | `journey_overview` | `handleJourneyOverview` | Companies by stage, level distribution |
| `/journey [company]` | `journey_company` | `handleJourneyCompany` | Company detail: stage, contacts by level, snapshots |
| `set [company] to training` | `journey_set` | `handleJourneySet` | Manual stage override |
| `snapshot [company]` | `journey_snapshot` | `handleJourneySnapshot` | Manually trigger maturity snapshot |
| `set [contact] to practitioner` | `fluency_set` | `handleFluencySet` | Set contact fluency level |
| `/signals` | `signals` | `handleSignals` | Active signals feed |

### Intent classification

- Add `journey` sub-intents under existing `action` and `view_data` categories
- Add `signals` under `view_data`
- Regex fallback patterns for `/journey`, `/signals`, `set ... to ...`, `snapshot ...`

**Extend `QueryUnderstanding.entities`** with new fields:
- `stage?: string` — for `journey_set` intent (e.g., "set Visma to training" → `stage: "training"`)
- `level?: string` — for `fluency_set` intent (e.g., "set Hanne to practitioner" → `level: "practitioner"`)

Both regex fallback and LLM category schema need updating to extract these.

### New HTMX cards

| Card | Content |
|------|---------|
| `JourneyOverviewCard` | Companies grouped by stage, contact counts, avg fluency level per company |
| `CompanyJourneyCard` | Stage badge, fluency level distribution bar, snapshot history table |
| `SignalsFeedCard` | Signal list with type icon, company name, detail, dismiss button (htmx POST) |

### Existing card integration

- `CompanyProfileCard` gets a journey section at the top: stage badge + fluency distribution
- `generateBriefing()` prompt gets journey context (stage, fluency distribution, recent snapshots)

---

## 5. File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/db/schema.sql` | Modify | Add `signals` table, indexes |
| `src/db/client.ts` | Modify | Migration for `fluency_level`, `fluency_certified_at` on contacts; update journey_stage values |
| `src/types/index.ts` | Modify | Fix `MaturitySnapshot.company_id` to string + `trigger` → `trigger_type`, update `JourneyStage` values, update `JourneyOverview` keys to match new stages, add `FluencyLevel` type, replace `Signal` interface, fix `Signal.company_id` to string |
| `src/services/journey-service.ts` | Create | Journey stage logic, snapshots, fluency distribution |
| `src/services/signals-service.ts` | Create | Signal detection, query, dismiss |
| `src/services/materialize.ts` | Modify | Hook journey stage computation + auto-snapshots |
| `src/services/local-llm.ts` | Modify | Add journey/signals intents to classifier + regex fallback |
| `src/web/routes/chat-handlers.tsx` | Modify | Register new handlers |
| `src/web/routes/handlers/journey-handlers.tsx` | Create | Journey + fluency intent handlers |
| `src/web/routes/handlers/signal-handlers.tsx` | Create | Signals intent handler |
| `src/web/cards/journey-overview.tsx` | Create | Journey overview card |
| `src/web/cards/company-journey.tsx` | Create | Company journey detail card |
| `src/web/cards/signals-feed.tsx` | Create | Signals feed card |
| `src/web/cards/company-profile.tsx` | Modify | Add journey section |

---

## 6. Privacy Boundary

- All journey and signal data stays in local DuckDB — no external API calls needed
- Fluency levels are set manually or from Firebase (future) — no PII sent to Gemini
- Signal detection is pure DuckDB queries — no LLM involvement

---

## 7. Future: Course Data from Firebase

When course completion data becomes available in Firebase:

- New sync service: `sync-courses.ts` (mirrors `sync-surveys.ts` pattern)
- Course completions create activities (`course_completed` type with level/module in detail JSON)
- `computeJourneyStage()` extended: auto-advance `assessing` → `training` when first course completion arrives
- `setContactFluencyLevel()` auto-triggered by course certification events
- Snapshots auto-created on course milestone completions

This requires no schema changes — just new sync + updated journey logic.

---

## 8. Out of Scope

- Course data sync from Firebase (future, not available yet)
- Auto-inference of fluency level from survey scores (possible but low confidence)
- Email/notification for signals (no outbound messaging system)
- Historical signal backfill (only detects signals going forward from implementation)
- Signal aggregation or trending (keep it simple — raw feed)
