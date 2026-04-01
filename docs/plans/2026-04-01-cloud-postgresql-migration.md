# Contact Intelligence Cloud Migration (PostgreSQL + pgvector) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Contact Intelligence from local DuckDB + LM Studio to Cloud SQL PostgreSQL with pgvector + Vertex AI, deployed as a Cloud Run service in the et-cms repo.

**Architecture:** Single Cloud SQL PostgreSQL 16 database with pgvector in `prod-etai-cm` (europe-north1). All AI via Vertex AI endpoints (gemini-embedding-2 for embeddings, gemini-2.5-flash for NLU/briefings). Deployed as Cloud Run service alongside Survey Studio with Firebase Auth.

**Tech Stack:** Bun + Hono + PostgreSQL (postgres.js) + pgvector + Vertex AI + HTMX + Alpine.js + Cloud Run + nginx

**Spec:** `docs/specs/2026-04-01-cloud-migration-postgresql-design.md`

---

## Phase Overview

| Phase | Description | What It Produces |
|-------|-------------|-----------------|
| **1** | GCP infrastructure setup | Cloud SQL instance + database + pgvector, Secret Manager, IAM |
| **2** | Scaffold project in et-cms | `tools/contact-intelligence/` with package.json, Dockerfile, deploy scripts |
| **3** | PostgreSQL database layer | `db/client.ts` (postgres.js) + `db/schema.sql` (PostgreSQL DDL) |
| **4** | Vertex AI providers | Embedding (gemini-embedding-2) + LLM (gemini-2.5-flash) providers |
| **5** | GCP auth layer | Service account tokens replacing gcloud.cmd CLI |
| **6** | Port services (SQL changes) | All 25 service files with DuckDB→PostgreSQL query changes |
| **7** | Port frontend + add Firebase Auth | HTMX frontend with login, all routes |
| **8** | Docker + Cloud Run deployment | Dockerfile, nginx, deploy script, first deploy |
| **9** | Data migration | DuckDB → PostgreSQL one-time import script |
| **10** | Verification + go-live | End-to-end testing, embed articles, cleanup |

---

## Task 1: GCP Infrastructure Setup

This task is done via `gcloud` CLI commands, not code. Run from any terminal with `gcloud` authenticated to `prod-etai-cm`.

- [ ] **Step 1: Create Cloud SQL instance**

```bash
gcloud sql instances create ci-db \
  --project=prod-etai-cm \
  --region=europe-north1 \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --storage-size=10GB \
  --storage-auto-increase \
  --no-assign-ip \
  --network=default
```

Note: `--no-assign-ip` disables public IP. Cloud Run connects via private IP / Cloud SQL Auth Proxy.

- [ ] **Step 2: Create database and user**

```bash
gcloud sql databases create contact_intelligence --instance=ci-db --project=prod-etai-cm

# Generate a password and store it
CI_DB_PASS=$(openssl rand -base64 24)
gcloud sql users create ci-app --instance=ci-db --password="$CI_DB_PASS" --project=prod-etai-cm

# Store password in Secret Manager
echo -n "$CI_DB_PASS" | gcloud secrets create ci-db-password --data-file=- --project=prod-etai-cm
```

- [ ] **Step 3: Enable pgvector extension**

```bash
gcloud sql connect ci-db --user=ci-app --database=contact_intelligence --project=prod-etai-cm
# In the psql prompt:
CREATE EXTENSION IF NOT EXISTS vector;
\q
```

- [ ] **Step 4: Grant Cloud Run service account IAM roles**

```bash
SA="9775734614-compute@developer.gserviceaccount.com"
PROJECT="prod-etai-cm"

gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role="roles/cloudsql.client"
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role="roles/aiplatform.user"
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role="roles/discoveryengine.viewer"

# Grant access to the new secret
gcloud secrets add-iam-policy-binding ci-db-password \
  --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" --project=$PROJECT
```

- [ ] **Step 5: Verify Vertex AI model availability in europe-north1**

```bash
# Test embedding model
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://europe-north1-aiplatform.googleapis.com/v1/projects/prod-etai-cm/locations/europe-north1/publishers/google/models/gemini-embedding-2:predict" \
  -H "Content-Type: application/json" \
  -d '{"instances":[{"content":"test"}],"parameters":{"outputDimensionality":768}}' | head -5

# Test LLM model
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://europe-north1-aiplatform.googleapis.com/v1/projects/prod-etai-cm/locations/europe-north1/publishers/google/models/gemini-2.5-flash:generateContent" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"hello"}]}]}' | head -5
```

If europe-north1 doesn't have these models, fall back to `europe-west1` or `us-central1` for AI calls only (database stays in europe-north1).

---

## Task 2: Scaffold Project in et-cms

**Files:**
- Create: `tools/contact-intelligence/package.json`
- Create: `tools/contact-intelligence/tsconfig.json`
- Create: `tools/contact-intelligence/.dockerignore`
- Create: `tools/contact-intelligence/Dockerfile`
- Create: `tools/contact-intelligence/nginx/nginx-cloudrun.conf`
- Create: `tools/contact-intelligence/scripts/deploy-cloud.sh`
- Create: `tools/contact-intelligence/scripts/startup-cloudrun.sh`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "contact-intelligence",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "firebase-admin": "^13.4.0",
    "google-auth-library": "^9.0.0",
    "hono": "^4.12.2",
    "postgres": "^3.4.5",
    "pdf-parse": "^2.4.5",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "typed-htmx": "^0.3.1",
    "typescript": "^5"
  },
  "scripts": {
    "dev": "bun --hot src/index.ts",
    "start": "bun src/index.ts",
    "build:frontend": "bun build public/src/main.ts --outfile public/app.js --target=browser --minify"
  }
}
```

Key deps: `postgres` (Porsager's postgres.js — fast, Bun-compatible, native `$1` params). No `@duckdb/node-api`.

- [ ] **Step 2: Create Dockerfile** (adapted from survey-ui)

```dockerfile
FROM oven/bun:1.3 AS builder
WORKDIR /build/contact-intelligence
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY public/src/ public/src/
COPY tsconfig.json ./
# RUN bun build public/src/main.ts --outfile public/app.js --target=browser --minify

FROM oven/bun:1.3-alpine
WORKDIR /build/contact-intelligence
RUN apk add --no-cache nginx
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY shared/ /build/shared/
RUN ln -s /build/contact-intelligence/node_modules /build/shared/node_modules

COPY src/ ./src/
# COPY --from=builder /build/contact-intelligence/public/app.js ./public/app.js
COPY public/ ./public/
COPY nginx/nginx-cloudrun.conf /etc/nginx/nginx.conf
COPY scripts/startup-cloudrun.sh /startup.sh
RUN sed -i 's/\r$//' /startup.sh && chmod +x /startup.sh
RUN addgroup -S appgroup && adduser -S appuser -G appgroup -h /home/appuser && \
    chown -R appuser:appgroup /build /tmp /home/appuser
USER appuser
EXPOSE 8080
CMD ["/startup.sh"]
```

- [ ] **Step 3: Create deploy-cloud.sh** (adapted from survey-ui)

```bash
#!/bin/bash
set -e

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-prod-etai-cm}"
REGION="europe-north1"
SERVICE_NAME="contact-intelligence"
IMAGE_NAME="eu.gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
CLOUD_SQL_INSTANCE="${PROJECT_ID}:${REGION}:ci-db"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}/.."

echo "=== Contact Intelligence Deploy ==="
echo "Project:  ${PROJECT_ID}"
echo "Region:   ${REGION}"
echo "Service:  ${SERVICE_NAME}"

cp -r ../shared ./shared
trap "rm -rf ./shared" EXIT

gcloud builds submit --project="${PROJECT_ID}" --tag="${IMAGE_NAME}:latest" .

gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE_NAME}:latest" \
  --platform=managed \
  --allow-unauthenticated \
  --execution-environment=gen2 \
  --set-secrets="FIREBASE_SERVICE_ACCOUNT=firebase-service-account:latest,CI_DB_PASSWORD=ci-db-password:latest" \
  --add-cloudsql-instances="${CLOUD_SQL_INSTANCE}" \
  --set-env-vars="DB_HOST=/cloudsql/${CLOUD_SQL_INSTANCE},DB_NAME=contact_intelligence,DB_USER=ci-app,VERTEX_PROJECT=prod-etai-cm,VERTEX_LOCATION=europe-north1" \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=3 \
  --concurrency=80 \
  --timeout=300

gcloud run services update-traffic "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --to-latest

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format="value(status.url)")

echo "Deploy complete! URL: ${SERVICE_URL}"
```

- [ ] **Step 4: Create startup-cloudrun.sh and nginx config**

Copy from survey-ui, change port to 3459 and service name.

- [ ] **Step 5: Install deps, verify structure**

```bash
cd tools/contact-intelligence && bun install
```

- [ ] **Step 6: Commit**

```bash
git add tools/contact-intelligence/
git commit -m "feat(contact-intelligence): scaffold project in et-cms repo"
```

---

## Task 3: PostgreSQL Database Layer

**Files:**
- Create: `tools/contact-intelligence/src/db/client.ts`
- Create: `tools/contact-intelligence/src/db/schema.sql`

- [ ] **Step 1: Create schema.sql with all 15 tables (PostgreSQL DDL)**

Port all tables from DuckDB schema.sql + migration columns from client.ts. Key changes:
- `VARCHAR` → `TEXT`
- `FLOAT[768]` → `vector(768)`
- `CAST(current_timestamp AS VARCHAR)` → `NOW()::TEXT`
- `DOUBLE` → `DOUBLE PRECISION`
- Add all migration-added columns directly (journey_stage, briefing, summary, fluency_level, etc.)
- Add pgvector extension and HNSW index
- Use `JSONB` for JSON columns (activities.detail, survey_responses.dimensionScores, survey_responses.answers)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  industry TEXT,
  size_bucket TEXT,
  country TEXT,
  notes TEXT,
  description TEXT,
  tags TEXT DEFAULT '[]',
  summary TEXT,
  briefing TEXT,
  briefing_at TEXT,
  journey_stage TEXT,
  journey_override BOOLEAN DEFAULT false,
  created_at TEXT DEFAULT NOW()::TEXT,
  updated_at TEXT DEFAULT NOW()::TEXT
);
-- ... all 15 tables with indexes
-- embeddings table uses vector(768) instead of FLOAT[768]
-- activities.detail uses JSONB instead of TEXT
-- HNSW index on embeddings.embedding
```

Include all indexes from the DuckDB schema.

- [ ] **Step 2: Create client.ts with postgres.js**

Replace the entire DuckDB client with a postgres.js connection pool. The exported API stays the same: `queryAll<T>()`, `queryOne<T>()`, `run()`, `exec()`, `generateId()`.

```typescript
import postgres from "postgres";

const sql = postgres({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "contact_intelligence",
  username: process.env.DB_USER || "ci-app",
  password: process.env.CI_DB_PASSWORD || "",
  max: 5,  // pool size per instance (db-f1-micro has ~25 total)
  idle_timeout: 30,
  connect_timeout: 10,
});

export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}`;
}

export async function queryAll<T>(
  sqlStr: string,
  params?: Record<string, unknown>
): Promise<T[]> {
  // Convert $name params to $1,$2 positional (same logic as DuckDB client)
  // postgres.js can also use tagged templates, but $name→$N keeps service code unchanged
  const { positionalSql, values } = convertParams(sqlStr, params);
  const rows = await sql.unsafe(positionalSql, values);
  return rows as T[];
}

export async function queryOne<T>(
  sqlStr: string,
  params?: Record<string, unknown>
): Promise<T | null> {
  const rows = await queryAll<T>(sqlStr, params);
  return rows[0] ?? null;
}

export async function run(
  sqlStr: string,
  params?: Record<string, unknown>
): Promise<void> {
  const { positionalSql, values } = convertParams(sqlStr, params);
  await sql.unsafe(positionalSql, values);
}

export async function exec(sqlStr: string): Promise<void> {
  await sql.unsafe(sqlStr);
}
```

The `convertParams()` function reuses the same `$name → $1,$2` logic from the current DuckDB client, so all service code keeps working.

No WAL checkpoint, no file locking, no DuckDB-specific cleanup — PostgreSQL handles all of this.

- [ ] **Step 3: Run schema against Cloud SQL**

```bash
# Via Cloud SQL Auth Proxy or gcloud sql connect
psql -h /cloudsql/prod-etai-cm:europe-north1:ci-db -U ci-app -d contact_intelligence -f src/db/schema.sql
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contact-intelligence): PostgreSQL database layer with pgvector"
```

---

## Task 4: Vertex AI Providers

**Files:**
- Create: `tools/contact-intelligence/src/services/providers/vertex-ai-llm.ts`
- Create: `tools/contact-intelligence/src/services/providers/vertex-ai-embeddings.ts`
- Modify: `tools/contact-intelligence/src/services/llm-provider.ts`
- Modify: `tools/contact-intelligence/src/services/embeddings.ts`

- [ ] **Step 1: Create GCP auth helper**

Create `src/services/gcp-auth.ts`:

```typescript
import { GoogleAuth } from "google-auth-library";

// In Cloud Run: uses default service account
// In dev: uses application default credentials (gcloud auth application-default login)
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

export async function getAccessToken(): Promise<string> {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token!;
}

export async function getIdentityToken(audience: string): Promise<string> {
  const client = await auth.getIdTokenClient(audience);
  const headers = await client.getRequestHeaders();
  return headers.Authorization!.replace("Bearer ", "");
}

export const VERTEX_PROJECT = process.env.VERTEX_PROJECT || "prod-etai-cm";
export const VERTEX_LOCATION = process.env.VERTEX_LOCATION || "europe-north1";
```

Add `google-auth-library` to package.json.

- [ ] **Step 2: Create Vertex AI LLM provider**

Implements the existing `LLMProvider` interface using `gemini-2.5-flash` via Vertex AI:

```typescript
export class VertexAILLMProvider implements LLMProvider {
  name = "vertex-ai";

  async isAvailable(): Promise<boolean> {
    return true; // Always available in cloud
  }

  async complete(options: LLMCallOptions): Promise<string | null> {
    const token = await getAccessToken();
    const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/gemini-2.5-flash:generateContent`;
    // ... same request shape as current Gemini API
  }
}
```

- [ ] **Step 3: Create Vertex AI embedding provider**

Update `embeddings.ts` to use Vertex AI endpoint:

```typescript
const VERTEX_EMBEDDING_MODEL = "gemini-embedding-2";

async function embedText(text: string, taskInstruction?: string): Promise<number[]> {
  const token = await getAccessToken();
  const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${VERTEX_EMBEDDING_MODEL}:predict`;

  const instance: Record<string, unknown> = { content: text };
  if (taskInstruction) instance.task_type = taskInstruction;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [instance],
      parameters: { outputDimensionality: EMBEDDING_DIM },
    }),
  });
  // ... parse response
}
```

Also update chunking: increase `CHUNK_TARGET_CHARS` from 2000 to 6000 (embedding-2 handles 8192 tokens).

- [ ] **Step 4: Update llm-provider.ts to default to Vertex AI**

```typescript
export async function initProvider(): Promise<void> {
  const { VertexAILLMProvider } = await import("./providers/vertex-ai-llm.ts");
  provider = new VertexAILLMProvider();
}
```

- [ ] **Step 5: Update embeddings.ts vector search for pgvector**

Change:
```typescript
// DuckDB:
list_cosine_similarity(embedding, ${vecStr}) AS score
// PostgreSQL + pgvector:
1 - (embedding <=> '${vecStr}'::vector) AS score
```

And change the inline vector format from `[0.1,0.2]::FLOAT[768]` to `'[0.1,0.2]'::vector`.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(contact-intelligence): Vertex AI providers for embeddings + LLM"
```

---

## Task 5: GCP Auth Layer

**Files:**
- Modify: `src/services/sync-events.ts` — replace `gcloud.cmd` with `gcp-auth.ts`
- Modify: `src/services/sync-surveys.ts` — same
- Modify: `src/services/sync-courses.ts` — same
- Modify: `src/services/people-lookup.ts` — same
- Modify: `src/services/enrich-contacts.ts` — same
- Modify: `src/services/company-research.ts` — use Vertex AI instead of Gemini API key
- Modify: `src/services/message-generation.ts` — replace `generateWithGemini()` GEMINI_API_KEY with Vertex AI
- Modify: `src/services/enrich-contacts.ts` — remove `GEMINI_API_KEY` guard (always available via Vertex AI)
- Remove: `src/services/backup.ts` (local backup not applicable in cloud)
- Remove: `src/web/routes/backup.tsx` (route for local backup)

- [ ] **Step 1: Replace all `Bun.spawn(["gcloud.cmd", ...])` calls**

In every sync/enrichment file, replace:
```typescript
// OLD:
const proc = Bun.spawn(["gcloud.cmd", "auth", "print-access-token"], { ... });
const text = await new Response(proc.stdout).text();

// NEW:
import { getAccessToken } from "./gcp-auth.ts";
const token = await getAccessToken();
```

Same pattern for `print-identity-token` → `getIdentityToken(audience)`.

- [ ] **Step 2: Update company-research.ts to use Vertex AI**

Replace direct Gemini API call with Vertex AI endpoint (same request format, different URL and auth).

- [ ] **Step 3: Remove or adapt backup.ts**

Local DuckDB export doesn't apply. Replace with PostgreSQL `pg_dump` reference or remove entirely (Cloud SQL has automated backups).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contact-intelligence): replace gcloud CLI with service account auth"
```

---

## Task 6: Port Services (SQL Changes)

**All service files audited for DuckDB → PostgreSQL changes.** Three patterns to fix:

1. `json_extract(col, '$.field')` / `json_extract_string(col, '$.field')` → `col::jsonb->>'field'`
2. `CAST(... AS DOUBLE)` → `CAST(... AS DOUBLE PRECISION)` — **PostgreSQL does NOT accept bare `DOUBLE`**
3. `list_cosine_similarity()` → pgvector `<=>` (handled in Task 4 Step 5)

### Files requiring changes (combined json_extract + CAST DOUBLE in one pass per file):

| File | json_extract | CAST DOUBLE | Other |
|------|-------------|-------------|-------|
| `analytics.ts` | ~13 instances | 3 instances | Largest rewrite |
| `dashboard.ts` | ~7 instances | 2 instances | |
| `companies.ts` | 2 instances | 2 instances | |
| `journey-service.ts` | 3 instances | 1 instance | |
| `lists.ts` | 2 instances | 2 instances | |

### Files audited — no DuckDB-specific SQL changes needed:

| File | Status | Notes |
|------|--------|-------|
| `activities.ts` | No changes | Standard SQL only |
| `contacts.ts` | No changes | Standard SQL only |
| `materialize.ts` | No changes | `split_part()` works in PostgreSQL |
| `signals-service.ts` | No changes | Standard SQL, INTERVAL syntax identical |
| `notebook.ts` | No changes | Standard SQL only |
| `messages.ts` | No changes | Standard SQL only |
| `summary-refresh.ts` | No changes | Uses LLM provider, SQL is standard |
| `sync-events.ts` | No changes | INSERT only, standard SQL |
| `sync-surveys.ts` | No changes | INSERT only, standard SQL |
| `sync-courses.ts` | No changes | INSERT only, standard SQL |
| `llm-briefings.ts` | No changes | No SQL, uses LLM provider |
| `local-llm.ts` | No SQL changes | Rename comments from "LM Studio" to "LLM provider" for clarity. Note: in-memory session store works per-instance; sessions may shift between Cloud Run instances (acceptable for 3-5 user team) |
| `people-lookup.ts` | No changes | Auth handled in Task 5, no SQL |

- [ ] **Step 1: Update analytics.ts** — replace all `json_extract`/`json_extract_string` + `CAST DOUBLE`
- [ ] **Step 2: Update dashboard.ts** — same combined pass
- [ ] **Step 3: Update companies.ts** — same combined pass
- [ ] **Step 4: Update journey-service.ts** — same combined pass
- [ ] **Step 5: Update lists.ts** — same combined pass
- [ ] **Step 6: Verify no DuckDB-specific functions remain**

```bash
grep -rn "json_extract\|list_cosine_similarity\|FLOAT\[768\]\|AS DOUBLE)" src/services/ src/web/
```

Should return 0 results after all changes. Note: `AS DOUBLE)` with closing paren catches `CAST(x AS DOUBLE)` but not `DOUBLE PRECISION`.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(contact-intelligence): port all SQL queries from DuckDB to PostgreSQL"
```

---

## Task 7: Port Frontend + Firebase Auth

**Files:**
- Copy: All `src/web/` files from current project
- Modify: `src/web/pages/layout.tsx` — add Firebase login
- Modify: `src/server.ts` — add auth middleware
- Create: `public/login.html`

- [ ] **Step 1: Copy all web/ files from current project**

All HTMX cards, routes, handlers, layout — copy as-is. The frontend doesn't contain SQL (that's in services/).

- [ ] **Step 2: Add Firebase Auth middleware to server.ts**

```typescript
import { initFirebase } from "../../shared/firebase-init.js";
import { getRequestContext } from "../../shared/request-context.js";
import { isTeamMember } from "../../shared/http.js";

initFirebase();

// All routes except /api/version and static files require auth
app.use("/*", async (c, next) => {
  if (c.req.path === "/api/version" || c.req.path.startsWith("/static/")) {
    return next();
  }
  const ctx = await getRequestContext(c.req.raw);
  if (!ctx || !isTeamMember(ctx.email)) {
    return c.redirect("/login.html");
  }
  c.set("email", ctx.email);
  return next();
});
```

- [ ] **Step 3: Add login page** (copy from survey-ui pattern)

Minimal Google Sign-In page that sets Firebase auth cookie and redirects to `/`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contact-intelligence): port frontend with Firebase Auth"
```

---

## Task 8: Docker + Cloud Run Deployment

- [ ] **Step 1: Test Docker build locally**

```bash
cd tools/contact-intelligence
cp -r ../shared ./shared
docker build -t contact-intelligence .
rm -rf ./shared
```

- [ ] **Step 2: First deploy to Cloud Run**

```bash
bash tools/contact-intelligence/scripts/deploy-cloud.sh
```

- [ ] **Step 3: Verify health endpoint**

```bash
curl https://contact-intelligence-9775734614.europe-north1.run.app/api/version
```

- [ ] **Step 4: Commit any deploy fixes**

```bash
git commit -m "fix(contact-intelligence): deployment adjustments"
```

---

## Task 9: Data Migration (DuckDB → PostgreSQL)

**Files:**
- Create: `tools/contact-intelligence/scripts/migrate-from-duckdb.ts`

Run from local machine (has access to both DuckDB file and Cloud SQL via proxy).

- [ ] **Step 1: Create migration script**

```typescript
// Opens local DuckDB (read-only)
// Connects to Cloud SQL PostgreSQL
// Batch-inserts all tables EXCEPT embeddings (re-embed with new model)
// Tables: companies, contacts, activities, lists, list_members,
//         cms_events, survey_responses, survey_metadata, sync_log,
//         course_enrollments, notebook, messages, maturity_snapshots, signals
```

- [ ] **Step 2: Start Cloud SQL Auth Proxy locally**

```bash
cloud-sql-proxy prod-etai-cm:europe-north1:ci-db --port=5432
```

- [ ] **Step 3: Run migration**

```bash
DB_HOST=localhost DB_PORT=5432 DB_NAME=contact_intelligence DB_USER=ci-app CI_DB_PASSWORD=xxx \
  bun tools/contact-intelligence/scripts/migrate-from-duckdb.ts
```

- [ ] **Step 4: Verify row counts**

```bash
psql -h localhost -U ci-app -d contact_intelligence -c "
  SELECT 'companies' as tbl, COUNT(*) FROM companies
  UNION ALL SELECT 'contacts', COUNT(*) FROM contacts
  UNION ALL SELECT 'activities', COUNT(*) FROM activities
  UNION ALL SELECT 'notebook', COUNT(*) FROM notebook;
"
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(contact-intelligence): DuckDB to PostgreSQL migration script"
```

---

## Task 10: Verification + Go-Live

- [ ] **Step 1: Run /embed articles via the cloud UI**

Navigate to the Cloud Run URL, login, type `/embed articles` in chat. Verify articles are fetched from GCS and embedded via Vertex AI gemini-embedding-2.

- [ ] **Step 2: Run /embed notebooks**

Verify all migrated notebook entries are embedded.

- [ ] **Step 3: Test semantic search**

Type `/search AI governance` — verify results appear with similarity scores.

- [ ] **Step 4: Test core CRM features**

- Dashboard: stats load
- Companies: list, detail, edit notes
- Contacts: list, detail
- Analytics: articles, surveys, engagement
- Chat NLU: natural language queries classify correctly
- Notebook: create, edit, delete, PDF upload
- Journey: overview, company detail
- Signals: feed loads

- [ ] **Step 5: Test sync pipeline**

Trigger `/sync` — verify CMS events, surveys, and course enrollments sync through the cloud service account.

- [ ] **Step 6: Update documentation**

Update in et-cms:
- `.claude/rules/architecture.md` — add Contact Intelligence section
- `.claude/rules/deployment.md` — add deploy command

Update in contact-intelligence:
- `docs/ARCHITECTURE-OVERVIEW.md` — update for cloud deployment

Update in workbench memory:
- Update Contact Intelligence location and architecture

- [ ] **Step 7: Final commit + tag**

```bash
git commit -m "docs: Contact Intelligence cloud deployment documentation"
git tag contact-intelligence-v1.0.0
git push && git push --tags
```

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Vertex AI models not in europe-north1 | Step 5 in Task 1 verifies this. Fall back to europe-west1 for AI calls only |
| db-f1-micro too small for pgvector HNSW | Monitor with `SELECT pg_relation_size('idx_embeddings_hnsw')`. Upgrade to db-g1-small if > 200MB |
| /embed articles exceeds 300s timeout | Run initial embedding via migration script, not web UI. Incremental embeds are fast |
| Cloud SQL connection limit (25) | Pool size 5 per instance × 3 max instances = 15. Headroom for admin connections |
| Data migration misses columns | PostgreSQL schema includes ALL columns (base + migration-added). Verify with \d+ in psql |
