# Contact Intelligence — Roadmap

Last updated: 2026-03-03

## Current State

A local CRM dashboard powered by DuckDB, Hono/HTMX, and Alpine.js. Two data pipelines feed into a unified activity model:

| Pipeline | Source | Data |
|---|---|---|
| CMS Events | ET CMS analytics export API (`et-cms-9775734614`) | Article views, page views |
| Surveys | Firestore on **test-disco-cm** project | Questionnaire + survey responses |

After sync, **materialize** resolves identities (domain → company, email → contact, events → activities). **Enrich** adds names/titles via Google Discovery Engine. **Research** generates company descriptions via Gemini.

### What exists today

- Dashboard with top articles, top companies, recent activity
- Company and contact profiles with activity tabs
- 4 analytics views: articles, page views, surveys, engagement scoring
- Chat-based command interface with natural language intent detection
- Sync, materialize, enrich, and research pipelines

### Known gaps

- `lists` / `list_members` tables: schema exists, zero code
- `note_added` activity type: tab exists in UI, no write path
- No inline editing on profiles
- No date range filtering on analytics
- No pagination on lists
- Survey dimension data (`dimensionScores`) stored but never surfaced
- Page views card has no drill-down (articles card does)
- Survey completions not clickable to contact profiles

---

## Phase 1 — Activate Dormant Features

*Smallest changes, biggest impact. Everything here needs <50 lines each.*

### 1.1 Notes on profiles
- Add `POST /contacts/:id/note` and `POST /companies/:id/note` routes
- Simple text input form on profile cards (htmx inline post)
- Creates `note_added` activity via existing `createActivity()`
- The Notes tab in `ActivityTabs` immediately starts showing data

### 1.2 Clickable survey completions
- `SurveysCard` recent completions: add `hx-get="/contacts/by-email/{email}"` on each row
- Same click-to-profile pattern used in articles card

### 1.3 Page views drill-down
- New route: `GET /pages/:path/visitors` (mirrors `/articles/:slug/readers`)
- Reuse `getArticleReaders` pattern but filter on `page_view` activity type
- Make `ViewsCard` rows clickable

### 1.4 Sync All button
- New route: `POST /sync/all` — chains events → surveys → materialize → enrich
- Button on `SyncStatusCard` above the individual triggers
- Returns combined result summary

---

## Phase 2 — Make Profiles Editable

*Turn the read-only dashboard into a usable CRM.*

### 2.1 Inline edit fields
- Alpine.js click-to-edit pattern: display → click → input → blur/Enter saves
- Company: industry, size_bucket, country, notes, tags
- Contact: job_title, notes, tags
- Each field: `PATCH /companies/:id` or `PATCH /contacts/:id`
- Service layer (`updateCompany`, `updateContact`) already supports partial updates

### 2.2 Tag management
- Inline tag editor: type + Enter to add, click X to remove
- Uses existing JSON tags column
- No new schema needed

---

## Phase 3 — Analytics Depth

*The data is already in DuckDB. Just needs querying and rendering.*

### 3.1 Date range filtering
- Add period toggle to all 4 analytics cards: 7d / 30d / 90d / All
- Query parameter: `?period=7d`
- DuckDB `WHERE occurred_at >= current_timestamp - INTERVAL '7 days'`
- Alpine.js toggle buttons, htmx re-fetch on click

### 3.2 Survey dimension breakdown
- `survey_responses.dimensionScores` contains per-dimension scores (JSON)
- New card: `SurveyDimensionsCard` showing dimension averages per company
- Score bars per dimension (Strategy, Culture, Data, Technology, etc.)
- Drill-down from company row in `SurveysCard`
- Route: `GET /analytics/surveys/:companyId/dimensions`

### 3.3 Company engagement timeline
- Route: `GET /companies/:id/timeline`
- Weekly activity aggregation: articles read, pages viewed, surveys completed
- Simple horizontal bar chart per week (inline CSS, no chart library)
- Linked from company profile and engagement card

### 3.4 Content performance trends
- Route: `GET /analytics/articles/:slug/trend`
- Weekly reader count for a specific article over time
- Shows whether readership is growing or declining
- Drill-down from `ArticlesCard` rows

---

## Phase 4 — Lists and Segmentation

*Activate the dormant `lists` and `list_members` tables.*

### 4.1 List CRUD
- Service: `createList`, `getList`, `listLists`, `addToList`, `removeFromList`
- Routes: `GET /lists`, `POST /lists`, `GET /lists/:id`, `POST /lists/:id/add`, `DELETE /lists/:id/members/:contactId`
- Card: `ListCard` showing members with activity summary
- Chat commands: `/lists`, `/list [name]`

### 4.2 Smart lists (filter-based)
- `filter_criteria` column (JSON) stores query conditions
- Filters: industry, country, tag, min engagement score, has survey
- Auto-membership: contacts matching filter are dynamically included
- Useful for: "All contacts from companies with engagement > 10"

### 4.3 Bulk actions on lists
- "Enrich all" — run enrichment on all list members
- "Export CSV" — download list as spreadsheet
- "Research all companies" — Gemini research for companies of list members

---

## Phase 5 — Export and Reporting

### 5.1 CSV export
- Routes: `GET /export/companies.csv`, `GET /export/contacts.csv`, `GET /export/engagement.csv`
- DuckDB `COPY TO` for fast export
- Download button on each list/analytics card

### 5.2 Engagement digest
- Route: `GET /reports/engagement-digest`
- Self-contained HTML summary (same pattern as Workbench templates)
- Top movers (rising/cooling), new companies, new survey completions
- Period: last 7 days
- Could be emailed or saved as a static file

---

## Phase 6 — Automation

### 6.1 Scheduled sync
- Cron job or Bun interval: run sync:all daily
- Log results to sync_log
- Surface last-auto-sync timestamp on dashboard

### 6.2 Activity alerts
- Detect notable events: new company first activity, high survey score, engagement spike
- Show as notification badges on dashboard
- Optional: write alerts to a new `alerts` table

---

## Phase 7 — Multi-User Sharing

*Local-first DuckDB for private engagement, Firestore for shared company facts. See [docs/MULTI-USER-ARCHITECTURE.md](docs/MULTI-USER-ARCHITECTURE.md) for full investigation.*

### 7.1 Firebase project setup
- Create or reuse a Firestore database for `shared_companies/{domain}` collection
- Security rules: authenticated users only (`request.auth != null`)
- No SDK — reuse existing REST pattern from `sync-surveys.ts` with `gcloud auth`

### 7.2 Company sync service
- New `sync-companies.ts` — bidirectional pull/push of generic company fields
- Shared fields: `name`, `domain`, `industry`, `size_bucket`, `country`, `description`
- Private fields stay local: `notes`, `tags`
- Merge strategy: last-write-wins by `updated_at`, with `updated_by` tracking
- Added to pipeline: `sync:events → sync:surveys → sync:companies → materialize → enrich`

### 7.3 Push on edit
- Hook `updateCompany()` — when a shared field changes, push to Firestore immediately
- Hook `researchCompany()` — after Gemini generates a description, push it
- Hook `enrichContacts()` — after discovering a new company, push it

### 7.4 Opt-in config
- `SHARED_FIRESTORE_PROJECT` env var — when absent, no sharing (zero behavior change)
- `USER_EMAIL` env var — identifies who made each edit in Firestore
- New user onboarding: clone repo, set `.env`, run `sync:all`, done

### 7.5 UI sync indicators
- Small "shared" indicator on company profile fields that sync to Firestore
- Sync log entries for company pull/push operations

### 7.6 Contact identity sharing (optional)
- `shared_contacts/{email_hash}` — SHA-256 hashed email as document ID
- Share only `name` and `job_title` (from Discovery Engine — public data)
- Never share: consent, notes, tags, activities
- GDPR consideration: hashed email + name is still personal data — requires EU region + team agreement

---

## Data Source Notes

**Surveys depend on the test-disco-cm Firestore project.** This is a separate GCP project from the CMS. If surveys move to a production project or the collection structure changes, `sync-surveys.ts` will need updating. The two Firestore collections used:

- `questionnaire_responses` — flat collection (older format)
- `survey_responses/{slug}/responses` — per-survey subcollections (newer format)

Both are synced and deduplicated by document ID. The materialize step resolves emails to contacts and creates `survey_completed` activities with `avgScore` and `maturityLevel` in the detail JSON.

**CMS events come from the production ET CMS** via its analytics export endpoint. This is the same CMS used by the Workbench project. Events include `content_read` (→ `article_view`) and everything else (→ `page_view`).

---

## Priority Order

| Phase | Effort | Impact | Dependencies |
|---|---|---|---|
| Phase 1 | Small (1-2h total) | High — activates existing features | None |
| Phase 2 | Medium (3-4h) | High — makes CRM usable | None |
| Phase 3 | Medium (4-6h) | High — analytics depth | Phase 1.3 for consistency |
| Phase 4 | Medium (4-5h) | Medium — segmentation | Phase 2 for tag management |
| Phase 5 | Small (2-3h) | Medium — data portability | Phase 3 for meaningful reports |
| Phase 6 | Medium (3-4h) | Medium — automation | All sync routes working |
| Phase 7 | Medium (8-10h) | High — team collaboration | Phases 1-3, GCP Firestore project |
