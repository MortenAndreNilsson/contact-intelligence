# Contact Intelligence Cloud Migration — PostgreSQL + pgvector Design Spec

> **Goal:** Migrate Contact Intelligence from local DuckDB + LM Studio to Cloud SQL PostgreSQL with pgvector + Vertex AI, deployed as a Cloud Run service in the et-cms repo (`prod-etai-cm`).

**Date:** 2026-04-01
**Status:** Draft
**Replaces:** `C:\MyWorkBench\docs\superpowers\plans\2026-03-18-contact-intelligence-cloud-migration.md` (Firestore-based plan)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Cloud Run: contact-intelligence (prod-etai-cm)         │
│  Bun + Hono + HTMX + Alpine.js, port 3459/8080         │
│  Firebase Auth (shared with Survey Studio)              │
└──────────────────┬──────────────────────────────────────┘
                   │ Unix socket (Cloud SQL Auth Proxy)
┌──────────────────▼──────────────────────────────────────┐
│  Cloud SQL PostgreSQL 16 + pgvector                     │
│  Instance: ci-db (db-f1-micro, europe-north1)           │
│  15 tables (direct port from DuckDB)                    │
│  HNSW index on embeddings.embedding                     │
└─────────────────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│  Vertex AI (prod-etai-cm, europe-north1)                │
│  Embeddings: gemini-embedding-2 (768 dims)              │
│  NLU/Briefings/Research: gemini-2.5-flash               │
│  Auth: service account IAM (no API key)                 │
│  Data covered by Visma DPA with Google Cloud             │
└─────────────────────────────────────────────────────────┘
```

**Key decisions:**
- Single PostgreSQL database for everything (CRM + embeddings + notebook + analytics)
- No Firestore — eliminates analytics query limitations (JOINs, ILIKE, GROUP BY all native)
- All AI via Vertex AI endpoints within `prod-etai-cm` — data stays in project, DPA-covered
- Firebase Auth for user login (shared `request-context.ts` from `tools/shared/`)
- Region-pinned to `europe-north1` — data doesn't leave the Nordics

---

## What Replaces What

| Current (Local) | Cloud Replacement |
|---|---|
| DuckDB (file-backed, 39MB) | Cloud SQL PostgreSQL 16 + pgvector |
| `FLOAT[768]` + `list_cosine_similarity()` | `vector(768)` + `1 - (embedding <=> query)` + HNSW index |
| LM Studio (Gemma 3 4B, localhost:1234) | Vertex AI `gemini-2.5-flash` |
| `gemini-embedding-001` (Gemini API key) | Vertex AI `gemini-embedding-2` (service account) |
| `gcloud.cmd auth print-*-token` | Cloud Run default service account + metadata server |
| No user auth | Firebase Auth (team-based) |
| Local HTMX on port 3002 | Cloud Run on port 3459/8080 (nginx proxy) |

---

## Database: DuckDB → PostgreSQL + pgvector

### Type Mapping

| DuckDB | PostgreSQL | Notes |
|---|---|---|
| `VARCHAR` | `TEXT` | No practical difference |
| `FLOAT[768]` | `vector(768)` | pgvector extension type |
| `BOOLEAN` | `BOOLEAN` | Same |
| `INTEGER` | `INTEGER` | Same |
| `DOUBLE` | `DOUBLE PRECISION` | Same |
| `REAL` | `REAL` | Same |
| `BIGINT` | `BIGINT` | Same |
| `DATE` | `DATE` | Same |
| `TIMESTAMP` | `TIMESTAMPTZ` | Add timezone awareness |
| `CAST(current_timestamp AS VARCHAR)` | `NOW()::TEXT` | Or switch to native `TIMESTAMPTZ` |

### Vector Search Translation

```sql
-- DuckDB (current)
SELECT *, list_cosine_similarity(embedding, [0.1,...]::FLOAT[768]) AS score
FROM embeddings
WHERE list_cosine_similarity(embedding, [0.1,...]::FLOAT[768]) > 0.65
ORDER BY score DESC LIMIT 10

-- PostgreSQL + pgvector
SELECT *, 1 - (embedding <=> '[0.1,...]'::vector) AS score
FROM embeddings
WHERE 1 - (embedding <=> '[0.1,...]'::vector) > 0.65
ORDER BY embedding <=> '[0.1,...]'::vector ASC LIMIT 10
```

pgvector `<=>` returns cosine **distance** (0 = identical). Use `1 - distance` for similarity score.

### Index

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE INDEX idx_embeddings_hnsw ON embeddings USING hnsw (embedding vector_cosine_ops);
```

### SQL Compatibility

| Feature | DuckDB | PostgreSQL | Change Needed |
|---|---|---|---|
| `ILIKE` | Yes | Yes | None |
| `json_extract(col, '$.field')` | DuckDB syntax | `col::jsonb->>'field'` | Rewrite JSON access |
| `split_part()` | Yes | Yes | None |
| `date_trunc()` | Yes | Yes | None |
| `GROUP BY`, `HAVING` | Yes | Yes | None |
| Correlated subqueries | Yes | Yes | None |
| `$name` params | Custom converter | Native `$1, $2` | Simplifies client.ts |

### Tables (15, all ported)

**Core CRM:** companies, contacts, activities, lists, list_members
**Data Integration:** cms_events, survey_responses, survey_metadata, sync_log, course_enrollments
**Semantic Memory:** embeddings, embedding_sources, notebook
**Engagement:** maturity_snapshots, signals, messages

---

## Embedding Model: gemini-embedding-2

**Endpoint (Vertex AI):**
```
POST https://europe-north1-aiplatform.googleapis.com/v1/projects/prod-etai-cm/locations/europe-north1/publishers/google/models/gemini-embedding-2:predict
Authorization: Bearer {service-account-token}
```

**Configuration:**
- Output dimensions: 768 (configurable, matches pgvector column)
- Input limit: 8192 tokens (4x larger than embedding-001)
- Multimodal: text + images + video + audio (future-ready)
- Task specification: via instruction in prompt (not `taskType` parameter)

**Chunking adjustment:**
- Increase from 2000 chars (~500 tokens) to 6000 chars (~1500 tokens) per chunk
- Fewer chunks = fewer API calls, better semantic coherence
- Still split on paragraph boundaries

**Content types to embed:**
- CMS articles (blog + use cases sections from GCS)
- Notebook entries (including imported PDFs)
- Company research descriptions
- Company/contact notes

---

## LLM Provider: Vertex AI gemini-2.5-flash

**Endpoint (Vertex AI):**
```
POST https://europe-north1-aiplatform.googleapis.com/v1/projects/prod-etai-cm/locations/europe-north1/publishers/google/models/gemini-2.5-flash:generateContent
Authorization: Bearer {service-account-token}
```

**Replaces LM Studio for:**
- Query understanding (NLU) — intent classification, entity extraction
- Entity briefings — company/contact summaries
- Message composition — email/Slack/LinkedIn drafts
- Company research — structured company profiles
- Activity summarization

**Regex fallback stays** — slash commands and exact matches bypass the LLM (faster, no API cost).

---

## Cloud Infrastructure

### Cloud SQL Instance

| Setting | Value |
|---|---|
| Instance name | `ci-db` |
| Project | `prod-etai-cm` |
| Region | `europe-north1` |
| Database version | PostgreSQL 16 |
| Machine type | `db-f1-micro` (shared CPU, 628MB RAM) |
| Storage | 10GB SSD (auto-resize) |
| Extensions | `pgvector` |
| Public IP | Disabled |
| Private IP | VPC-connected |
| Database | `contact_intelligence` |
| User | `ci-app` (password in Secret Manager) |
| Estimated cost | ~$9-15/month |

### Cloud Run Service

| Setting | Value |
|---|---|
| Service name | `contact-intelligence` |
| Project | `prod-etai-cm` |
| Region | `europe-north1` |
| Port (internal) | 3459 |
| Port (nginx) | 8080 |
| Memory | 512Mi |
| CPU | 1 vCPU |
| Min instances | 1 |
| Max instances | 3 |
| Timeout | 300s |
| Cloud SQL | `prod-etai-cm:europe-north1:ci-db` (Unix socket) |

### Secrets (Secret Manager)

| Secret | Purpose |
|---|---|
| `firebase-service-account` | Firebase Auth (existing, shared) |
| `studio-gemini-api-key` | Keep for other tools (existing) |
| `ci-db-password` | Cloud SQL `ci-app` user password (new) |

### IAM Roles (Cloud Run service account)

| Role | Purpose |
|---|---|
| `roles/cloudsql.client` | Connect to Cloud SQL |
| `roles/aiplatform.user` | Vertex AI embeddings + generation |
| `roles/discoveryengine.viewer` | People lookup (enrichment) |
| `roles/secretmanager.secretAccessor` | Read secrets |

---

## Auth

- Firebase Auth with Google Sign-In (same as Survey Studio)
- Shared `tools/shared/request-context.ts` for token verification
- Team members defined in `tools/shared/config.ts` (`TEAM_EMAILS`)
- No `gcloud.cmd` CLI calls — all auth via service account from metadata server
- Sync pipeline auth (CMS analytics, Firestore surveys): service account access/identity tokens

---

## CMS Content Sections (Updated)

The CMS now uses **blog** and **use cases** sections (no longer discover):

| Section | GCS Path | Content Type |
|---|---|---|
| `blog` | `published/blog/{slug}.md` | Blog articles |
| `use-cases` | `published/use-cases/{slug}.md` | Use case articles |
| `learn` | `published/learn/{slug}.md` | Learning content |
| `services` | `published/services/{slug}.md` | Service pages |

All sections embedded in one `/embed articles` process.

---

## Data Migration (One-Time)

1. Create Cloud SQL instance + database + schema
2. Run migration script from local machine:
   - Opens local DuckDB (read-only)
   - Connects to Cloud SQL via Cloud SQL Auth Proxy
   - Inserts all 15 tables (batch inserts for performance)
   - Skips embedding table (re-embed fresh with embedding-2)
3. Run `/embed articles` + `/embed notebooks` to populate embeddings with new model
4. Verify row counts match

---

## Project Structure (in et-cms repo)

```
tools/contact-intelligence/
├── package.json
├── tsconfig.json
├── Dockerfile
├── .dockerignore
├── src/
│   ├── index.ts              (Bun.serve entry)
│   ├── server.ts             (Hono app + routes)
│   ├── config.ts             (PORT, VERSION, env)
│   ├── types.ts              (all interfaces)
│   ├── db/
│   │   ├── client.ts         (pg connection pool, query helpers)
│   │   └── schema.sql        (PostgreSQL DDL with pgvector)
│   ├── services/
│   │   ├── embeddings.ts     (Vertex AI embedding-2 + pgvector search)
│   │   ├── llm-provider.ts   (Vertex AI gemini-2.5-flash)
│   │   ├── notebook.ts
│   │   ├── companies.ts
│   │   ├── contacts.ts
│   │   ├── activities.ts
│   │   ├── analytics.ts
│   │   ├── lists.ts
│   │   ├── ... (all existing services)
│   │   └── gcp-auth.ts       (service account token helper)
│   └── web/
│       ├── app.tsx
│       ├── pages/layout.tsx
│       ├── routes/            (all existing routes)
│       └── cards/             (all existing cards)
├── public/
│   ├── index.html
│   ├── style.css
│   └── static/               (vendored htmx + alpine)
├── nginx/
│   └── nginx-cloudrun.conf
└── scripts/
    ├── deploy-cloud.sh
    ├── startup-cloudrun.sh
    └── migrate-from-duckdb.ts
```

---

## What Does NOT Change

- All 15 database tables (schema ported, not redesigned)
- HTMX + Alpine.js frontend (server-rendered, vendored)
- Chat intent dispatch (regex + LLM classification)
- Slash commands and autocomplete
- Smart list filter evaluation (SQL queries work as-is in PostgreSQL)
- Analytics aggregations (SQL GROUP BY, date_trunc, COUNT — all native)
- Notebook with PDF upload
- G6 Journey Model + G7 Engagement Signals
- ET Design Palette dark navy theme

---

## Estimated Costs

| Component | Monthly Cost |
|---|---|
| Cloud SQL db-f1-micro | ~$9-15 |
| Cloud Run (min 1 instance) | ~$8-12 |
| Vertex AI Embeddings | ~$1-3 (small corpus) |
| Vertex AI Flash (NLU/briefings) | ~$2-5 |
| **Total** | **~$20-35/month** |

---

## Out of Scope

- Multi-tenancy (per-user data isolation) — single shared database for the team
- Gmail / Calendar integration (OpenBrain Phase 2)
- Multimodal embeddings (embedding-2 supports it, but text-only for now)
- Automated scheduled sync (Cloud Scheduler — future addition)
- Local development with DuckDB fallback (cloud-only after migration)
