# G6: AI Maturity Journey Model + G7: Engagement Signals

**Date:** 2026-03-13
**Status:** Approved design, ready for implementation

## Overview

Add company journey tracking and engagement signal detection to Contact Intelligence. Companies progress through stages (awareness → assessed → workshop → courses → custom_engagement) based on activities. Maturity snapshots capture headcount-at-level over time for before/after comparison. Signals surface notable patterns (new survey, content binge, cooling off) on the dashboard.

## Architecture: Thin Layer on Existing Tables (Option A)

- 2 new columns on `companies` (journey_stage, journey_override)
- 3 new activity types in existing `activities` table
- 1 new `maturity_snapshots` table
- Signals computed at query time (no storage)
- Journey stage computed from activities (hybrid: auto-compute with manual override)

---

## Schema Changes

### companies table — 2 new columns

```sql
ALTER TABLE companies ADD COLUMN journey_stage VARCHAR;
-- Values: 'awareness' | 'assessed' | 'workshop' | 'courses' | 'custom_engagement'

ALTER TABLE companies ADD COLUMN journey_override BOOLEAN DEFAULT false;
-- When true, journey_stage is manually set and not auto-computed
```

### maturity_snapshots — new table

```sql
CREATE TABLE maturity_snapshots (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  snapshot_date DATE NOT NULL,
  trigger VARCHAR NOT NULL,       -- 'pre-workshop', 'post-workshop', 'quarterly', 'manual'
  total_respondents INTEGER,
  beginner_count INTEGER DEFAULT 0,
  developing_count INTEGER DEFAULT 0,
  intermediate_count INTEGER DEFAULT 0,
  advanced_count INTEGER DEFAULT 0,
  leader_count INTEGER DEFAULT 0,
  avg_score REAL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### New activity types

| Type | Level | detail JSON |
|------|-------|-------------|
| `workshop_attended` | company + contact | `{ name, date, attendee_count }` (company) / `{ name, date }` (contact) |
| `course_enrolled` | contact | `{ course_name }` |
| `course_completed` | contact | `{ course_name, score? }` |

---

## Journey Stage Computation (Hybrid)

Function: `computeJourneyStage(companyId) → stage`

Stages in order (highest matching wins):
1. **awareness** — has article_view activities
2. **assessed** — has survey_completed activities
3. **workshop** — has workshop_attended activities
4. **courses** — has course_enrolled or course_completed activities
5. **custom_engagement** — has custom survey activities or manual override

Override: if `journey_override = true`, return stored `journey_stage` directly.

The stage is recomputed on company profile load and during dashboard aggregation. Stored on the companies row for queryability (smart lists, chat filters).

---

## Engagement Signals (G7)

All computed at query time from activities + maturity_snapshots. No storage table.

### Signal types

| Signal | Rule | Window |
|--------|------|--------|
| **new_survey** | survey_completed at company in last 7 days | 7d |
| **score_change** | Company avg score changed >0.5 between latest 2 snapshots | latest 2 snapshots |
| **content_binge** | 3+ article_view at company in last 7 days | 7d |
| **cooling_off** | Activity in 30-90d window but nothing in 0-30d | 30/90d |
| **new_person** | Contact created in last 14 days at company with journey_stage != 'awareness' | 14d |

### Signal interface

```typescript
interface Signal {
  type: 'new_survey' | 'score_change' | 'content_binge' | 'cooling_off' | 'new_person';
  company_id: number;
  company_name: string;
  title: string;         // "Acme completed a survey"
  detail: string;        // "Score: 3.2 (Intermediate)"
  detected_at: string;   // most recent relevant activity date
}

getSignals(limit?: number): Promise<Signal[]>
// Runs all 5 detection queries, merges, sorts by detected_at DESC
```

---

## UI Changes

### Dashboard

- **Journey funnel bar**: horizontal bar showing company count per stage (awareness/assessed/workshop/courses/custom). Clickable to filter.
- **Signals feed**: replaces or sits above "Recent Activity". Color-coded by signal type with left border accent.
- **Stats row**: add "Workshops" count (companies with workshop_attended activities).

### Company Profile

- **Journey badge**: colored pill in header showing current stage (e.g., "ASSESSED" in blue).
- **Maturity distribution bar**: stacked horizontal bar showing headcount at each level (Beginner through Leader).
- **Score progression**: simple bar chart comparing snapshots (pre-workshop → post-workshop with delta).
- **Action buttons**: "Take Snapshot", "Set Stage" (manual override), "Log Workshop".

### New Chat Intents

Added to `view_data` category:
- `journey_overview` — "show journey overview" → dashboard journey funnel
- `journey_filter` — "which companies are in workshop stage?" → filtered list
- `signals` — "show signals" → signals feed

Added to `action` category:
- `log_workshop` — "log workshop for Acme with 10 attendees"
- `take_snapshot` — "take snapshot for Acme, pre-workshop"
- `set_stage` — "set Acme to workshop stage"

---

## New Files

| File | Purpose |
|------|---------|
| `src/services/journey.ts` | computeJourneyStage, refreshJourneyStages, getJourneyOverview |
| `src/services/snapshots.ts` | createSnapshot, listSnapshots, getLatestSnapshots |
| `src/services/signals.ts` | getSignals (all 5 detection queries) |
| `src/web/cards/journey-card.tsx` | JourneyFunnel, SignalsFeed, MaturityBar, SnapshotTimeline components |
| `src/web/routes/journey.tsx` | Routes for journey/snapshot/signal endpoints |

## Modified Files

| File | Changes |
|------|---------|
| `src/db/schema.sql` | ALTER companies + CREATE maturity_snapshots |
| `src/db/client.ts` | CRUD for snapshots, journey stage updates |
| `src/services/dashboard.ts` | Add journey counts + signals to dashboard stats |
| `src/services/activities.ts` | Support new activity types |
| `src/services/local-llm.ts` | New intents in view_data and action categories |
| `src/web/routes/dashboard.tsx` | Render journey funnel + signals feed |
| `src/web/routes/companies.tsx` | Journey badge, maturity bar, snapshot timeline, action buttons |
| `src/web/routes/chat-handlers.tsx` | New handler functions for journey/signal intents |
| `src/web/app.tsx` | Mount journey routes |
| `src/types/index.ts` | Signal, MaturitySnapshot, JourneyStage types |
