# Visma Emerging-Tech Contact Intelligence

**A standalone AI-first contact intelligence platform.** Ask questions in natural language, get answers on a dark-mode canvas. Survey data, CMS engagement, and company profiles — unified in one local database, queryable through conversation or visual interface.

Not a traditional CRM with forms and tables. An intelligence surface where data from Firebase surveys, Visma CMS, and manual input converges — presented through an AI chat with a canvas that renders company profiles, contact timelines, radar charts, and smart lists as structured visual cards.

---

## What It Is

Contact Intelligence is the layer that answers:

- "Which companies have we surveyed, and how did they score?"
- "Show me everyone at Acme Corp who scored below 3.0 on AI governance"
- "Build a list of contacts from companies with 50+ employees who took the AI Maturity survey"
- "What is the engagement history for Visma Enterprise?"
- "Who should we target for the next AI Fluency workshop?"

It pulls data from Firestore (survey responses), tracks what content was published to Visma CMS, and stores everything locally in SQLite. The AI interprets your questions through MCP tools, and the canvas renders the results — company dashboards, contact profiles, dimension breakdowns, activity timelines.

---

## How It Works

```
You ask a question
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│                    AI Chat Panel                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  "Show me Acme Corp's AI maturity breakdown"    │    │
│  └─────────────────────────────────────────────────┘    │
│                        │                                │
│                  MCP Tool Call                           │
│              crm-get-company "Acme"                      │
│                        │                                │
│                        ▼                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Canvas Response                     │    │
│  │  ┌─────────────────────────────────────────┐    │    │
│  │  │  ACME CORP              acme.com         │    │    │
│  │  │  Technology · 51-200 · Norway            │    │    │
│  │  │                                          │    │    │
│  │  │  AI Maturity: 3.2 avg (4 respondents)    │    │    │
│  │  │  ████████████████░░░░░                   │    │    │
│  │  │                                          │    │    │
│  │  │  ◆ Data Strategy    4.1  ████████░░      │    │    │
│  │  │  ◆ Daily AI Use     3.4  ██████░░░░      │    │    │
│  │  │  ◆ Impact Tracking  3.0  ██████░░░░      │    │    │
│  │  │  ◆ AI Governance    2.3  ████░░░░░░      │    │    │
│  │  │                                          │    │    │
│  │  │  CONTACTS                                │    │    │
│  │  │  Anna Larsen · CTO · 3.8         2d ago  │    │    │
│  │  │  Bob Nilsen  · Dev · 2.6         5d ago  │    │    │
│  │  │  Clara Vik   · HR  · 3.1         1w ago  │    │    │
│  │  └─────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                 VISMA ET CONTACT INTELLIGENCE                                │
│                                                                             │
│  ┌───────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │         AI + CANVAS UI            │  │        MCP SERVER              │  │
│  │         (Hono + JSX)              │  │    (stdio + HTTP transport)    │  │
│  │                                   │  │                                │  │
│  │  ┌─────────┐  ┌───────────────┐  │  │  crm-list-companies            │  │
│  │  │  Chat   │  │    Canvas     │  │  │  crm-get-company               │  │
│  │  │  Panel  │◄─┤   Renderer   │  │  │  crm-search-contacts           │  │
│  │  │         │  │              │  │  │  crm-sync-surveys              │  │
│  │  │  Input  │  │  Cards       │  │  │  crm-run-list                  │  │
│  │  │  Query  │  │  Charts      │  │  │  crm-add-note                  │  │
│  │  │  Filter │  │  Timelines   │  │  │  crm-dashboard                 │  │
│  │  │         │  │  Tables      │  │  │  crm-export / crm-delete       │  │
│  │  └─────────┘  └───────────────┘  │  │                                │  │
│  │               Port 3002           │  │  Claude Desktop (stdio)        │  │
│  └───────────────┬───────────────────┘  └──────────────┬─────────────────┘  │
│                  │                                      │                    │
│                  └──────────────┬───────────────────────┘                    │
│                                │                                            │
│                     ┌──────────▼──────────┐                                 │
│                     │     SERVICES        │                                 │
│                     │   (shared logic)    │                                 │
│                     │                     │                                 │
│                     │  companies.ts       │                                 │
│                     │  contacts.ts        │                                 │
│                     │  activities.ts      │                                 │
│                     │  lists.ts           │                                 │
│                     │  sync.ts            │                                 │
│                     │  search.ts          │                                 │
│                     └──────────┬──────────┘                                 │
│                                │                                            │
│                     ┌──────────▼──────────┐                                 │
│                     │    bun:sqlite       │                                 │
│                     │    (WAL mode)       │                                 │
│                     │                     │                                 │
│                     │  contact-intel.db   │                                 │
│                     └─────────────────────┘                                 │
│                                                                             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
            ┌───────▼──────┐ ┌────▼─────┐ ┌─────▼────────┐
            │  Firebase    │ │  Visma   │ │  Workbench   │
            │  Firestore   │ │  CMS     │ │  SQLite      │
            │              │ │          │ │              │
            │  survey_     │ │  content │ │  survey_     │
            │  responses/  │ │  catalog │ │  sessions    │
            │  survey_     │ │  (future)│ │  cms_content │
            │  stats/      │ │          │ │              │
            └──────────────┘ └──────────┘ └──────────────┘
              Pull (batch)   Pull (batch)   Read (local)
```

### Data Flow

```
EXTERNAL SOURCES                    LOCAL INTELLIGENCE
─────────────────                   ──────────────────

Firebase Firestore ──── pull ────►  contacts table
  survey_responses/                 companies table
  {slug}/responses/                 activities table
  • email                           │
  • company                         │  identity
  • role                            │  resolution
  • scores                          │  (email → contact
  • answers                         │   domain → company)
                                    │
Workbench SQLite ───── read ────►  survey registry
  survey_sessions                   (slug → company mapping)
  • slug                            │
  • company                         │
  • branding                        │
                                    ▼
Workbench SQLite ───── read ────►  content catalog
  cms_content                       (what was published,
  • title, section                   for future article
  • slug, tags                       view attribution)
  • published_at
```

### Two Entry Points, One Database

```
┌─────────────────────────────┐    ┌─────────────────────────────┐
│  Web UI                     │    │  Claude Desktop             │
│  bun run src/index.ts       │    │  bun run src/mcp/stdio.ts   │
│  → Hono on port 3002        │    │  → MCP stdio transport      │
│  → AI chat + canvas         │    │  → natural language CRM     │
└──────────────┬──────────────┘    └──────────────┬──────────────┘
               │                                   │
               │        shared services/           │
               └──────────────┬────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  contact-intel.db │
                    │  (bun:sqlite WAL) │
                    └───────────────────┘
```

---

## The AI + Canvas UI

Not a traditional CRM layout. The interface has two regions:

**Left: Chat panel** — natural language input. Ask questions, give commands, apply filters. The AI interprets and calls the right service functions.

**Right: Canvas** — structured visual output. The canvas renders different card types depending on what was asked. All cards use the ET Design Palette: dark navy background (`#0A1628`), Visma accent colors, Plus Jakarta Sans typography, JetBrains Mono for data.

### Canvas Card Types

**Company Profile Card**
Dark surface card with company name, domain, industry, size. Survey maturity radar chart using dimension scores. Contact list with scores and last activity. Tags as accent-colored badges.

**Contact Profile Card**
Name, email, job title, company link. Consent status indicator. Full activity timeline as a vertical list with colored type badges (survey = turquoise, note = orange, article = lime). Survey dimension breakdown if they completed one.

**Dashboard Card**
Four stat boxes (contacts, companies, surveys, avg score) in a horizontal row. Recent activity feed. Top companies ranked by engagement. Uses the same stat-card pattern as the presentation template.

**List Results Card**
Filtered contact table with sort headers. Filter rules shown as removable badges at the top. Export button. Row click opens the contact profile.

**Sync Status Card**
Last sync timestamp, records processed/created/skipped per source. Manual sync button. Error log if the last sync failed.

**Radar Chart Card**
Company or contact dimension scores rendered as a radar/spider chart with ET accent colors. Used inside company profiles and for cross-company comparison.

### Visual Identity

The canvas uses the ET Design Palette exactly:

```css
:root {
  /* Surfaces */
  --color-bg: #0A1628;
  --color-surface: #111827;
  --color-surface-elevated: #1F2937;

  /* Accents */
  --visma-green: #0E7F88;        /* primary actions */
  --visma-turquoise: #009F93;    /* survey data, links */
  --visma-lime: #8CB501;         /* success, high scores */
  --visma-orange: #F97C00;       /* warnings, notes */
  --visma-coral: #EF564B;        /* low scores, alerts */

  /* Typography */
  --font-body: "Plus Jakarta Sans", sans-serif;
  --font-mono: "JetBrains Mono", monospace;

  /* Cards */
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.08);
  /* Hover: translateY(-4px), accent glow */
}
```

Labels and badges use `font-mono`, uppercase, `0.75rem`, `letter-spacing: 0.1em` — same as presentation slides. Gradient accents on headers: `linear-gradient(135deg, #009F93, #F97C00)`. Stat values in large weight-800 display type. Cards float on the dark background with subtle border glow on hover.

### UI Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌─ ET ─┐  CONTACT INTELLIGENCE         ● Sync: 2 min ago      │
│  └──────┘  Visma Emerging-Tech                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ CHAT ──────────────────┐  ┌─ CANVAS ──────────────────────┐ │
│  │                         │  │                                │ │
│  │  Show me all companies  │  │  ┌─ COMPANIES ──────────────┐ │ │
│  │  we surveyed in Q1      │  │  │                           │ │ │
│  │                         │  │  │  Acme Corp        3.2 avg │ │ │
│  │  ────────────────────── │  │  │  ████████████░░░  4 ppl   │ │ │
│  │                         │  │  │                           │ │ │
│  │  Found 3 companies with │  │  │  Visma Enterprise 2.9 avg │ │ │
│  │  survey data in Q1.     │  │  │  █████████░░░░░  5 ppl   │ │ │
│  │  Acme scored highest    │  │  │                           │ │ │
│  │  at 3.2 avg. Visma      │  │  │  TechCorp NL     3.5 avg │ │ │
│  │  Enterprise has the     │  │  │  ██████████████░  3 ppl   │ │ │
│  │  most respondents (5).  │  │  │                           │ │ │
│  │                         │  │  └───────────────────────────┘ │ │
│  │                         │  │                                │ │
│  │  ┌───────────────────┐  │  │  ┌─ SCORE DISTRIBUTION ─────┐ │ │
│  │  │ Ask something...  │  │  │  │                           │ │ │
│  │  └───────────────────┘  │  │  │  Exploring   ██░░  2      │ │ │
│  │                         │  │  │  Applying    ████  6      │ │ │
│  └─────────────────────────┘  │  │  Scaling     ███░  4      │ │ │
│                                │  │                           │ │ │
│                                │  └───────────────────────────┘ │ │
│                                │                                │ │
│                                └────────────────────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

The chat panel is the input. The canvas is the output. Clicking a company card in the canvas drills into its detail view (also rendered as canvas cards). The canvas can show multiple cards stacked vertically — a company profile followed by its contact list followed by its activity timeline.

---

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | **Bun** | Native SQLite, TypeScript-first, fast startup, single-binary compile |
| Web framework | **Hono** | First-class Bun support, built-in JSX, lightweight, MCP adapter |
| UI rendering | **Hono JSX** (server) | Dark-mode canvas rendered server-side, no client framework |
| Interactivity | **htmx + Alpine.js** | htmx for chat/search/drill-down, Alpine for canvas state (29KB total) |
| Styling | **Inline CSS** | ET Design Palette variables, self-contained, no build pipeline |
| Database | **bun:sqlite** (WAL) | Zero-dependency, native, json_extract() for activity detail |
| MCP | **@modelcontextprotocol/sdk** | stdio for Claude Desktop, `@hono/mcp` for HTTP |
| Firestore | **firebase-admin** | Service account pull for survey responses |

---

## Database Schema

Six tables in a standalone `contact-intel.db`.

```sql
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  industry TEXT,
  size_bucket TEXT,           -- 'solo','2-10','11-50','51-200','200+'
  country TEXT,
  notes TEXT,
  tags TEXT DEFAULT '[]',     -- JSON array
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  email TEXT UNIQUE,
  name TEXT,
  job_title TEXT,
  source TEXT NOT NULL,       -- 'survey','manual','import'
  consent_status TEXT DEFAULT 'unknown',
  consent_date TEXT,
  tags TEXT DEFAULT '[]',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL, -- 'survey_completed','article_view','note_added'
  source TEXT NOT NULL,        -- 'survey_studio','cms','manual'
  source_ref TEXT,             -- Firestore doc ID for dedup
  title TEXT,
  detail TEXT,                 -- JSON: scores, answers, article slug, note text
  occurred_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  list_type TEXT NOT NULL,     -- 'static' or 'dynamic'
  filter_criteria TEXT,        -- JSON for dynamic lists
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE list_members (
  list_id TEXT REFERENCES lists(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (list_id, contact_id)
);

CREATE TABLE sync_log (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_ref TEXT,
  last_sync_at TEXT NOT NULL,
  records_processed INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_skipped INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## MCP Tools for Claude Desktop

Every intelligence operation is available as an MCP tool. Claude Desktop becomes a natural language CRM.

| Tool | What it does |
|------|-------------|
| `ci-dashboard` | Summary stats: companies, contacts, surveys, avg score, recent activity |
| `ci-list-companies` | All companies with contact count, avg score, last activity |
| `ci-get-company` | Full company profile: contacts, survey breakdown, dimension scores, timeline |
| `ci-search` | Free-text search across companies, contacts, and activity notes |
| `ci-list-contacts` | Contacts filtered by company, tag, score range, survey |
| `ci-get-contact` | Contact profile with full activity timeline and survey results |
| `ci-create-company` | Add a company manually |
| `ci-create-contact` | Add a contact, auto-link to company by email domain |
| `ci-add-note` | Log a note on a company or contact |
| `ci-sync-surveys` | Pull new survey responses from Firestore, run identity resolution |
| `ci-list-lists` | Show all smart and static lists |
| `ci-run-list` | Execute a dynamic list filter and return matching contacts |
| `ci-create-list` | Define a new smart list with filter rules |
| `ci-export-contact` | GDPR: export all data for a contact as JSON |
| `ci-delete-contact` | GDPR: delete contact, anonymize activities |

---

## Identity Resolution

Survey responses are the primary identity source. Every survey captures email + company + role.

```
Survey response: email = "anna@acme.com", company = "Acme Corp"
  │
  ├─ contacts WHERE email = 'anna@acme.com'
  │   ├─ Found → link activity to existing contact
  │   └─ Not found → create contact
  │       │
  │       ├─ Extract domain: "acme.com"
  │       ├─ companies WHERE domain = 'acme.com'
  │       │   ├─ Found → link contact to company
  │       │   └─ Not found → create company (name from survey, domain from email)
  │       │
  │       └─ Insert activity: survey_completed with scores + dimension breakdown
  │
  └─ Idempotency: skip if activity with same source_ref already exists
```

---

## Data Sync

All external data is pulled into local SQLite on demand. No real-time listeners, no webhooks. Pull when you need it.

```
┌────────────────────┐          ┌────────────────────┐
│ Firebase Firestore │  ──────► │ contact-intel.db   │
│                    │  batch   │                    │
│ survey_responses/  │  pull    │ contacts           │
│ survey_stats/      │          │ companies          │
│                    │          │ activities          │
└────────────────────┘          │                    │
                                │ sync_log           │
┌────────────────────┐          │                    │
│ Workbench SQLite   │  ──────► │ (survey registry)  │
│                    │  read    │ (content catalog)  │
│ survey_sessions    │          │                    │
│ cms_content        │          └────────────────────┘
└────────────────────┘
```

**Triggers:** Manual "Sync" button in the canvas UI, `ci-sync-surveys` MCP tool from Claude Desktop, or future daily cron.

**Requires:** Firebase service account with `roles/datastore.viewer`. Store as `FIREBASE_SERVICE_ACCOUNT` in `.env`.

---

## Project Structure

```
contact-intelligence/
├── package.json
├── tsconfig.json
├── .env                            # FIREBASE_SERVICE_ACCOUNT, CI_PASSWORD
│
├── src/
│   ├── index.ts                    # Hono web server (port 3002)
│   │
│   ├── db/
│   │   ├── client.ts               # bun:sqlite singleton, WAL, migrations
│   │   └── schema.sql              # Table definitions
│   │
│   ├── services/                   # Shared logic (web + MCP)
│   │   ├── companies.ts
│   │   ├── contacts.ts
│   │   ├── activities.ts
│   │   ├── lists.ts
│   │   ├── sync.ts                 # Firestore pull + identity resolution
│   │   ├── search.ts
│   │   └── dashboard.ts
│   │
│   ├── web/
│   │   ├── app.tsx                 # Hono app, middleware, route mounting
│   │   ├── routes/
│   │   │   ├── chat.tsx            # POST /chat — AI query → canvas response
│   │   │   ├── companies.tsx       # Company views + htmx fragments
│   │   │   ├── contacts.tsx        # Contact views + htmx fragments
│   │   │   ├── lists.tsx           # Lists + filter builder
│   │   │   ├── sync.tsx            # Sync controls
│   │   │   └── canvas.tsx          # Canvas card renderers
│   │   ├── pages/
│   │   │   └── layout.tsx          # HTML shell: ET palette, chat + canvas layout
│   │   └── cards/                  # Canvas card components (JSX)
│   │       ├── company-profile.tsx
│   │       ├── contact-profile.tsx
│   │       ├── dashboard-stats.tsx
│   │       ├── list-results.tsx
│   │       ├── activity-timeline.tsx
│   │       ├── radar-chart.tsx
│   │       └── sync-status.tsx
│   │
│   ├── mcp/
│   │   ├── server.ts               # MCP tool registrations
│   │   └── stdio.ts                # Claude Desktop entry point
│   │
│   └── types/
│       └── index.ts
│
├── static/
│   ├── htmx.min.js                # Vendored, no CDN
│   └── alpine.min.js              # Vendored, no CDN
│
├── data/
│   └── contact-intel.db           # SQLite database (gitignored)
│
└── tests/
    ├── services/
    ├── web/
    └── mcp/
```

---

## GDPR

| Data | Legal Basis | Requirement |
|------|-------------|-------------|
| Survey email/company/role | Consent | Checkbox on survey welcome screen |
| Survey scores + answers | Consent | Same checkbox |
| Company-level aggregation | Legitimate interest | Fine if 3+ individuals |
| Manual notes | Legitimate interest | Internal business records |

**Right to deletion:** `ci-delete-contact` anonymizes all activities (removes contact_id) and deletes the contact record.

**Right to export:** `ci-export-contact` returns all data for a given email as JSON.

**Data retention:** Contacts retained while consent is active. Activities anonymized after 24 months. Sync logs deleted after 12 months.

---

## Roadmap

### Phase 1: Scaffold + Core Intelligence

Stand up the project, database, and canvas UI with manual data entry.

| Step | What | Deliverable |
|------|------|-------------|
| 1.1 | Bun + Hono project, tsconfig for JSX | Running server at :3002 |
| 1.2 | bun:sqlite with WAL, schema migration | Empty database with 6 tables |
| 1.3 | Services: companies, contacts, activities CRUD | Tested business logic |
| 1.4 | Canvas layout with ET palette (dark mode, Plus Jakarta Sans) | Visual shell |
| 1.5 | Company profile card, contact profile card, dashboard card | Working canvas |
| 1.6 | Chat panel with direct query routing (not AI yet — keyword matching) | Functional prototype |

**Milestone:** Browsable canvas with manual company/contact management.

### Phase 2: MCP Server + Claude Desktop

Make every operation available as a Claude Desktop tool.

| Step | What | Deliverable |
|------|------|-------------|
| 2.1 | MCP server with all `ci-*` tool registrations | Tool definitions |
| 2.2 | stdio.ts entry point | Claude Desktop integration |
| 2.3 | Claude Desktop config file | Working in Claude |
| 2.4 | Test all tools end-to-end | "List companies" → correct JSON |

**Milestone:** Full CRM access from Claude Desktop via natural language.

### Phase 3: Firestore Survey Sync

The core value — survey data becomes contact intelligence.

| Step | What | Deliverable |
|------|------|-------------|
| 3.1 | Firebase Admin SDK setup with service account | Firestore access |
| 3.2 | Sync engine: pull → identity resolution → activity creation | Tested pipeline |
| 3.3 | Sync canvas card (status, log, manual trigger) | Visual feedback |
| 3.4 | `ci-sync-surveys` MCP tool | Sync from Claude Desktop |
| 3.5 | Survey registry import from Workbench SQLite | Slug → company mapping |
| 3.6 | Consent checkbox added to Workbench survey generator | GDPR compliance |

**Milestone:** "Sync Now" pulls all survey responses into companies/contacts/activities.

### Phase 4: Smart Lists + Filtering

Segmentation for targeted outreach.

| Step | What | Deliverable |
|------|------|-------------|
| 4.1 | List CRUD + filter criteria → SQL translator | Dynamic list engine |
| 4.2 | Filter builder canvas card (Alpine.js rules) | Visual rule builder |
| 4.3 | List results card with sort + CSV export | Exportable segments |
| 4.4 | Pre-built smart lists (high/low maturity, active companies) | Ready to use |
| 4.5 | `ci-run-list` and `ci-create-list` MCP tools | Lists from Claude |

**Milestone:** "Show me contacts who scored below 3.0 at companies with 50+ employees" → filtered list with export.

### Phase 5: AI Chat Integration

Replace keyword routing with actual AI-powered query interpretation.

| Step | What | Deliverable |
|------|------|-------------|
| 5.1 | Anthropic API integration in chat panel | Natural language queries |
| 5.2 | Tool-use pattern: AI decides which service to call | Intelligent routing |
| 5.3 | Canvas card selection based on AI response | Right card for the question |
| 5.4 | Conversation history in chat panel | Multi-turn context |
| 5.5 | Suggested follow-up questions after each response | Guided exploration |

**Milestone:** True AI-powered intelligence — ask anything about your contacts in natural language, get visual answers on the canvas.

### Phase 6: Content Attribution (Future)

Track which content drives engagement.

| Step | What | Deliverable |
|------|------|-------------|
| 6.1 | Import CMS content catalog from Workbench | Published content registry |
| 6.2 | Lightweight page view tracking on Firebase Hosting (with consent) | View data |
| 6.3 | Article view activities linked to contacts/companies | Content attribution |
| 6.4 | Company engagement dashboard with content + survey combined | Full picture |

**Milestone:** "Acme Corp: 4 people took the survey, 12 article views this month, strongest interest in AI governance content."

---

## Dependencies

```json
{
  "name": "contact-intelligence",
  "version": "0.1.0",
  "dependencies": {
    "hono": "^4",
    "@modelcontextprotocol/sdk": "^1",
    "@hono/mcp": "^0.1",
    "zod": "^4",
    "firebase-admin": "^13"
  },
  "devDependencies": {
    "typed-htmx": "^0.3",
    "@types/bun": "latest"
  }
}
```

No Tailwind, no daisyUI, no build pipeline. CSS is inline using the ET Design Palette variables. htmx and Alpine.js vendored as static files (29KB total client JS).

---

## Running It

```bash
# Development (web UI with hot reload)
bun --hot src/index.ts

# Claude Desktop connects via MCP stdio (configured in claude_desktop_config.json)
# {
#   "mcpServers": {
#     "contact-intelligence": {
#       "command": "bun",
#       "args": ["run", "C:/Projects/contact-intelligence/src/mcp/stdio.ts"]
#     }
#   }
# }

# Single binary for distribution
bun build --compile src/index.ts --outfile contact-intelligence
```
