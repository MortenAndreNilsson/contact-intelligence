# Multi-User Architecture — Investigation and Proposal

*Investigation date: 2026-03-03*

---

## Current State

Contact Intelligence is a **single-user, local-first** CRM dashboard. One person runs it on their machine with:

- A local DuckDB file (`data/contact-intel.duckdb`)
- `gcloud` auth tied to their Google account
- Data from their CMS and their survey project

There is no user identity concept, no authentication, and no shared state.

---

## The Vision

Multiple team members each run their own local instance. They work independently on their own engagement data (CMS reads, survey completions, notes) but **share a common company registry** — so when one person enriches a company with industry, country, or an AI-generated description, everyone benefits.

```
┌──────────────────┐         ┌─────────────────────────┐         ┌──────────────────┐
│   User A (local) │         │   Firebase (shared)     │         │   User B (local) │
│                  │         │                         │         │                  │
│  DuckDB          │◄───────►│  shared_companies/      │◄───────►│  DuckDB          │
│  ├ companies     │  sync   │    {domain} docs        │  sync   │  ├ companies     │
│  ├ contacts  (*)│         │                         │         │  ├ contacts  (*) │
│  ├ activities (*)│         │  shared_contacts/       │         │  ├ activities (*) │
│  ├ cms_events (*)│         │    {email_hash} docs    │         │  ├ cms_events (*) │
│  ├ surveys   (*)│         │                         │         │  ├ surveys    (*) │
│  └ lists     (*)│         └─────────────────────────┘         │  └ lists      (*) │
│                  │                                             │                  │
│  (*) = private   │                                             │  (*) = private   │
└──────────────────┘                                             └──────────────────┘
```

---

## Data Classification

### Shareable (generic company facts)

These fields describe the company itself and have nothing to do with any specific user's engagement:

| Table | Field | Why shareable |
|-------|-------|---------------|
| `companies` | `name` | Legal entity name |
| `companies` | `domain` | Public website domain |
| `companies` | `industry` | Factual classification |
| `companies` | `size_bucket` | Company size (public info) |
| `companies` | `country` | HQ location |
| `companies` | `description` | AI-generated factual summary (from Gemini) |

### Optionally shareable (enriched contact identity)

| Table | Field | Why shareable (with care) |
|-------|-------|--------------------------|
| `contacts` | `name` | From Google Discovery Engine — public info |
| `contacts` | `job_title` | From Google Discovery Engine — public info |

These come from a public people index, so sharing them saves others the enrichment step. However, linking email → name has GDPR implications. See the Privacy section below.

### Private (user-specific engagement)

| Table / Field | Why private |
|---------------|-------------|
| `companies.notes`, `companies.tags` | Personal annotations |
| `contacts.consent_*`, `contacts.notes`, `contacts.tags` | GDPR + personal |
| `activities` (entire table) | Engagement events from YOUR CMS |
| `cms_events` (entire table) | Raw CMS reader log |
| `survey_responses` (entire table) | Individual survey completions |
| `lists`, `list_members` | Personal segmentation |
| `sync_log` | Operational metadata |

---

## Proposed Architecture

### Option A: Firestore as Shared Company Registry (Recommended)

**Firebase project:** Use an existing project (e.g., `test-disco-cm`) or create a new one (`contact-intel-shared`).

**Firestore collections:**

```
shared_companies/{domain}
  ├ name: string
  ├ domain: string
  ├ industry: string | null
  ├ size_bucket: string | null
  ├ country: string | null
  ├ description: string | null
  ├ updated_at: timestamp
  └ updated_by: string (email of the person who last edited)

shared_contacts/{email_hash}         (optional, Phase 2)
  ├ email_hash: string (SHA-256 of lowercase email)
  ├ name: string | null
  ├ job_title: string | null
  ├ updated_at: timestamp
  └ updated_by: string
```

**Why Firestore:**
- Already in the ecosystem (survey data lives in Firestore)
- REST API pattern already implemented in `sync-surveys.ts`
- No server to manage (serverless)
- Free tier: 50K reads/day, 20K writes/day — more than enough
- Security rules can restrict to authenticated users
- Real-time listeners available if needed later

**Why domain as the key:** Companies are auto-created from email domains during materialize. Domain is the natural unique identifier (already `UNIQUE` in the schema). Using it as the Firestore document ID makes upsert trivial.

### Option B: Shared DuckDB via Cloud Storage

Mount a shared DuckDB file via OneDrive/SharePoint/GCS.

**Rejected because:** DuckDB is a single-writer embedded database. Concurrent access from multiple machines would cause corruption. DuckDB has no built-in replication or multi-writer support.

### Option C: Central API Server

Deploy a shared REST API with a cloud database (PostgreSQL, Firestore, etc.)

**Rejected for now because:** Over-engineered for this stage. Everyone runs locally — adding a server defeats the local-first philosophy. Could revisit if the team grows beyond 5-10 users.

---

## Sync Design (Option A Details)

### New sync step: `sync:companies`

Added to the pipeline: `sync:events → sync:surveys → sync:companies → materialize → enrich`

```
sync:companies
  ├── PULL: Read all shared_companies from Firestore
  │   ├── For each doc:
  │   │   ├── If company exists locally by domain:
  │   │   │   ├── If remote updated_at > local updated_at → merge generic fields
  │   │   │   └── If local updated_at > remote updated_at → push local (if local has richer data)
  │   │   └── If company does NOT exist locally:
  │   │       └── Create local company from shared data
  │   └── Done — local DB now has all shared companies
  │
  └── PUSH: Find local companies not in shared (or more recently updated)
      ├── For each local company with domain:
      │   ├── If not in shared → create shared doc
      │   └── If local updated_at > remote updated_at → update shared doc
      └── Done — Firestore now has all local company data
```

### Push on edit (real-time)

When a user edits a generic company field via `PATCH /companies/:id`, the `updateCompany()` service function also pushes to Firestore. This makes edits available to others within seconds.

```typescript
// In companies.ts — updateCompany()
// After the DuckDB update, push shared fields to Firestore
const sharedFields = ["name", "domain", "industry", "size_bucket", "country", "description"];
const hasSharedChange = Object.keys(fields).some(k => sharedFields.includes(k));
if (hasSharedChange && company.domain) {
  await pushCompanyToFirestore(company.domain, sharedFieldsOnly);
}
```

### Merge rules

| Scenario | Resolution |
|----------|------------|
| Remote has field, local is null | Accept remote |
| Local has field, remote is null | Keep local, push to remote |
| Both have field, different values | **Last-write-wins** by `updated_at` |
| Local has notes/tags | Never push — private fields |
| Remote has domain not in local DB | Create local company stub |
| Local company has no domain | Skip sync (can't key without domain) |

### Conflict visibility

When a merge overwrites a local value, log it:
```
[sync:companies] Merged 'Visma' — industry: 'SaaS' → 'Enterprise Software' (from user@example.com)
```

Users can review sync results and override if needed via inline editing.

---

## Implementation Plan

### Step 1: Firebase Setup (one-time)

```
1. Create Firestore database in existing project (or new project)
2. Set security rules:
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /shared_companies/{domain} {
         allow read, write: if request.auth != null;
       }
       match /shared_contacts/{hash} {
         allow read, write: if request.auth != null;
       }
     }
   }
3. No SDK needed — reuse existing REST API pattern with gcloud auth
```

### Step 2: New Service — `sync-companies.ts`

```typescript
// src/services/sync-companies.ts

const FIRESTORE_PROJECT = "contact-intel-shared"; // or existing project
const COLLECTION = "shared_companies";

export async function pullSharedCompanies(): Promise<SyncResult> { ... }
export async function pushCompanyToFirestore(domain: string, fields: SharedCompanyFields): Promise<void> { ... }
export async function syncCompanies(): Promise<SyncResult> {
  const pullResult = await pullSharedCompanies();
  const pushResult = await pushLocalCompanies();
  return { pulled: pullResult.count, pushed: pushResult.count };
}
```

### Step 3: Hook into existing flows

```
updateCompany()  →  if shared field changed  →  pushCompanyToFirestore()
researchCompany()  →  after saving description  →  pushCompanyToFirestore()
enrichContacts()  →  after discovering company  →  pushCompanyToFirestore()
```

### Step 4: Config

```env
# .env
SHARED_FIRESTORE_PROJECT=contact-intel-shared   # optional, defaults to no sharing
USER_EMAIL=morten.andre.nilsson@visma.com        # identifies who made the edit
```

When `SHARED_FIRESTORE_PROJECT` is not set, the app works exactly as it does today. Zero behavior change for users who don't opt in.

### Step 5: UI indicator

On the company profile card, show a small sync indicator:
```
Industry: Enterprise Software  ↕ (shared)    ← indicates this field syncs
Notes: My private notes                       ← no indicator, stays local
```

---

## Contact Sharing (Optional Phase 2)

Contact identity data (name, job_title) comes from Google Discovery Engine — it's publicly available business information. Sharing it saves each user from running their own enrichment.

**Key by email hash:** Store `SHA-256(lowercase(email))` as the document ID. This prevents raw email addresses from sitting in Firestore while still allowing lookup.

```typescript
import { createHash } from "crypto";
const emailHash = createHash("sha256").update(email.toLowerCase()).digest("hex");
```

**Fields shared:** Only `name` and `job_title`. Never consent status, notes, or tags.

**GDPR consideration:** Even hashed emails + names constitute personal data under GDPR. The Firestore project must be in an EU region, and all users must be on the same data processing agreement. For an internal team tool, this is manageable.

---

## Privacy and GDPR

### What is safe to share

- Company factual data (name, domain, industry, country) — this is public business information, not personal data
- AI-generated company descriptions — synthesized from public knowledge

### What requires care

- Contact names + job titles — personal data under GDPR even if sourced from public directories
- Survey completion data — individual responses are personal data
- CMS reading behavior — individual browsing patterns are personal data

### Recommendation

**Phase 1:** Share only company-level data. Zero personal data in Firestore.
**Phase 2:** Share contact identity (name, title) via hashed email keys, with explicit team agreement on data handling.
**Never share:** Activities, CMS events, survey responses, notes, tags, consent data.

---

## What Each User Needs

For a new team member to join:

1. **Clone the repo** and run `bun install`
2. **Get a `.env`** with `GEMINI_API_KEY` and `SHARED_FIRESTORE_PROJECT`
3. **Have `gcloud` authenticated** — their Google account must have Firestore access
4. **Run `sync:all`** — pulls shared companies + their own CMS/survey data
5. **Done** — they see shared company data and their own engagement data

No deployment, no server, no Docker. Just `bun dev` and they're running.

---

## Architecture Diagram

```
                        ┌─────────────────────────────────┐
                        │        Google Cloud              │
                        │                                  │
                        │  ┌──────────────────────────┐   │
                        │  │  Firestore                │   │
                        │  │  (contact-intel-shared)   │   │
                        │  │                           │   │
    User A              │  │  shared_companies/        │   │              User B
   ┌────────┐           │  │    ├ visma.com {...}      │   │           ┌────────┐
   │ Bun    │  push/    │  │    ├ spotify.com {...}    │   │  push/   │ Bun    │
   │ Hono   │◄─pull────►│  │    └ ...                  │   │◄─pull───►│ Hono   │
   │ DuckDB │           │  │                           │   │           │ DuckDB │
   └────┬───┘           │  │  shared_contacts/ (v2)    │   │           └────┬───┘
        │               │  │    ├ abc123... {...}       │   │                │
        │               │  │    └ ...                  │   │                │
        │               │  └──────────────────────────┘   │                │
        │               │                                  │                │
        │               │  ┌──────────────────────────┐   │                │
        │               │  │  ET CMS Analytics API     │   │                │
        ├──── pull ────►│  │  (shared read-only)       │◄──── pull ────────┤
        │               │  └──────────────────────────┘   │                │
        │               │                                  │                │
        │               │  ┌──────────────────────────┐   │                │
        │               │  │  Firestore (test-disco)   │   │                │
        ├──── pull ────►│  │  Survey responses         │◄──── pull ────────┤
        │               │  └──────────────────────────┘   │                │
        │               │                                  │                │
        │               │  ┌──────────────────────────┐   │                │
        │               │  │  Discovery Engine         │   │                │
        └──── query ───►│  │  People enrichment        │◄──── query ───────┘
                        │  └──────────────────────────┘   │
                        └─────────────────────────────────┘

Legend:
  ◄─── pull ───  = Read-only sync (existing)
  ◄─── push/pull ─── = Bidirectional sync (new)
```

---

## Roadmap Integration

This fits naturally as a **Phase 7** on the existing roadmap:

### Phase 7 — Multi-User Sharing

| Step | Description | Effort |
|------|-------------|--------|
| 7.1 | Firebase project setup + security rules | 30 min |
| 7.2 | `sync-companies.ts` — pull/push shared companies | 2-3h |
| 7.3 | Hook `updateCompany()` and `researchCompany()` to push on edit | 1h |
| 7.4 | Add `sync:companies` to `sync:all` pipeline | 15 min |
| 7.5 | UI sync indicators on shared fields | 1h |
| 7.6 | Config: `SHARED_FIRESTORE_PROJECT` env var, graceful no-op when absent | 30 min |
| 7.7 | Contact identity sharing via hashed email (optional) | 2-3h |

**Total: ~8-10 hours for company sharing, +2-3h for contact sharing**

### Prerequisites

- Phases 1-3 should be done first (profiles, editing, analytics)
- Phase 4 (lists) is independent — can be done before or after
- A shared GCP project with Firestore enabled

---

## Future Extensions (If This Works Well)

1. **Real-time listeners** — Firestore `onSnapshot` for live updates when a colleague edits a company (requires Firebase client SDK, ~30 lines)

2. **Shared engagement aggregates** — Instead of sharing raw activities, share pre-computed engagement scores per company. "Company X has engagement score 45 across our team." No personal data leaked.

3. **Activity feed** — "Morten updated Visma's industry to Enterprise Software" — lightweight Firestore collection of recent team actions.

4. **Shared lists** — Lists with `list_type = 'shared'` synced to Firestore. Team can maintain target account lists together.

5. **Central dashboard** — A Firebase-hosted static page that reads shared_companies directly from Firestore and shows a team-wide company registry. No server needed — just a static HTML file with Firestore JS SDK.

---

## Decision Points

Before implementing, decide:

1. **Which Firestore project?** Use existing `test-disco-cm` or create a new `contact-intel-shared`?
2. **Share contact identity?** Or keep Phase 1 company-only?
3. **Push on every edit?** Or only on explicit "share" action?
4. **Who has write access?** All team members, or designated editors?

---

## Summary

The core idea is simple: **local-first DuckDB for private engagement data, Firestore for shared company facts.** No servers, no deployments, no containers. Each user runs `bun dev` locally and their company registry stays in sync via the same `gcloud` auth they already use.

The implementation reuses the existing Firestore REST pattern from `sync-surveys.ts`, adds one new sync step, and hooks into the existing `updateCompany()` service. When `SHARED_FIRESTORE_PROJECT` is not configured, the app works exactly as it does today.
