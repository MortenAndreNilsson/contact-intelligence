# Semantic Memory Layer — Design Spec

> **Goal:** Add vector embeddings to Contact Intelligence so the chat interface can answer semantic questions like "what articles about AI governance have contacts read?" or "what do we know about Visma's strategy?" — grounded in CMS articles, company research, and manual notes.

**Date:** 2026-03-13
**Status:** Approved
**Project:** Contact Intelligence (`C:\Projects\contact-intelligence\`)

---

## Architecture Overview

```
CMS Sync ──→ Article content ──→ Gemini text-embedding-004 ──→ DuckDB FLOAT[768]
Note save ──→ Note text ────────→ Gemini text-embedding-004 ──→ DuckDB FLOAT[768]
Research  ──→ Company profile ──→ Gemini text-embedding-004 ──→ DuckDB FLOAT[768]

Chat query ──→ understandQuery() ──→ memory_search intent
                                        ↓
                               Embed query (RETRIEVAL_QUERY)
                                        ↓
                               Cosine similarity in DuckDB
                                        ↓
                               Top-10 results → HTMX cards
```

**Embedding provider:** Gemini `text-embedding-004` (768 dimensions, ~3KB per vector). Non-PII content only — notes containing PII are a future consideration for local embeddings via LM Studio.

**Storage:** DuckDB vector columns (`FLOAT[768]`), same database file as existing tables.

**No memory compaction.** Embeddings accumulate. Re-embedding replaces stale vectors via content hash comparison.

---

## 1. Data Model

Two new tables in `src/db/schema.sql`:

### `embeddings` — vector store

```sql
CREATE TABLE IF NOT EXISTS embeddings (
  id VARCHAR PRIMARY KEY,
  content_type VARCHAR NOT NULL,       -- 'article' | 'note' | 'research'
  source_id VARCHAR NOT NULL,          -- FK to embedding_sources.id
  chunk_index INTEGER DEFAULT 0,       -- for long content split into chunks
  content_text TEXT NOT NULL,           -- original text that was embedded
  embedding FLOAT[768] NOT NULL,       -- Gemini text-embedding-004 output
  metadata JSON,                       -- flexible: {slug, section, company_id, ...}
  created_at TIMESTAMP DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_embeddings_type ON embeddings(content_type);
CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_id);
```

### `embedding_sources` — change tracking

```sql
CREATE TABLE IF NOT EXISTS embedding_sources (
  id VARCHAR PRIMARY KEY,
  content_type VARCHAR NOT NULL,       -- 'article' | 'note' | 'research'
  source_ref VARCHAR NOT NULL,         -- article slug, company_id, contact_id
  content_hash VARCHAR NOT NULL,       -- SHA-256 of source text for change detection
  chunk_count INTEGER DEFAULT 1,
  last_embedded_at TIMESTAMP DEFAULT current_timestamp,
  UNIQUE(content_type, source_ref)
);
```

### Chunk strategy

- **Articles:** Split at ~500 tokens per chunk at paragraph boundaries (`\n\n`). Typical article = 2–5 chunks.
- **Notes:** Single embedding each (typically 1–3 paragraphs).
- **Research results:** Single embedding each (Gemini-generated company description).

---

## 2. Embedding Pipeline

New service: `src/services/embeddings.ts`

### 2.1 Gemini Embedding API

```
POST https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent
Authorization: key from GEMINI_API_KEY

Request:
{
  "content": { "parts": [{ "text": "..." }] },
  "taskType": "RETRIEVAL_DOCUMENT"   // indexing
}

Response:
{
  "embedding": { "values": [0.123, -0.456, ...] }  // 768 floats
}
```

Two task types:
- `RETRIEVAL_DOCUMENT` — for indexing content (articles, notes, research)
- `RETRIEVAL_QUERY` — for search queries (optimized differently by Gemini)

### 2.2 Article Embedding Flow

**Trigger:** After `syncEvents()` + `materialize()`, or manually via chat command.

1. Query `cms_events` for distinct `(section, slug)` pairs
2. Fetch article content from ET CMS API: `GET /api/content/{section}/{slug}`
3. Compute SHA-256 hash of content
4. Check `embedding_sources` — skip if hash unchanged
5. Split content into ~500-token chunks at paragraph boundaries
6. Embed each chunk via Gemini with `taskType: RETRIEVAL_DOCUMENT`
7. Delete old embeddings for this source, insert new ones
8. Update `embedding_sources` with new hash and chunk count
9. Metadata per chunk: `{ slug, section, contentTitle }`

### 2.3 Note Embedding Flow

**Trigger:** When `updateCompany()` or `updateContact()` changes the `notes` field.

1. Compute SHA-256 of new note text
2. Check `embedding_sources` — skip if unchanged
3. Embed full note text (single chunk, typically short)
4. Replace old embedding if exists
5. Metadata: `{ company_id, company_name }` or `{ contact_id, contact_email, contact_name }`

### 2.4 Research Embedding Flow

**Trigger:** After `researchCompany()` returns a Gemini-generated profile.

1. Compute SHA-256 of research description
2. Embed the full description text
3. Metadata: `{ company_id, company_name, domain, industry }`

### 2.5 Rate Limiting

Sequential processing with 100ms delay between API calls. At this scale (hundreds of articles, not thousands), no batching or queue needed.

---

## 3. Semantic Search

Integrated into the existing chat interface as a new intent.

### 3.1 New Intent: `memory_search`

Added to the intent classification in `local-llm.ts` and `chat-handlers.tsx`:

- **Category:** `memory_search`
- **Triggers:** Queries that don't match existing entity/action intents, or contain semantic keywords like "what do we know about...", "articles about...", "any notes on..."
- **Regex fallback patterns:** `what.*know about`, `articles about`, `notes on`, `research on`, `memory.*search`

### 3.2 Search Flow

1. `understandQuery()` classifies as `memory_search` with extracted search text
2. Embed search text via Gemini with `taskType: RETRIEVAL_QUERY`
3. DuckDB cosine similarity query:
   ```sql
   SELECT id, content_type, source_id, chunk_index, content_text, metadata,
          list_cosine_similarity(embedding, $1::FLOAT[768]) AS score
   FROM embeddings
   WHERE list_cosine_similarity(embedding, $1::FLOAT[768]) > 0.65
   ORDER BY score DESC
   LIMIT 10
   ```
4. Group results by `content_type` (articles, notes, research)
5. Render as HTMX chat response cards with:
   - Score badge (relevance %)
   - Content snippet (first 200 chars of matching chunk)
   - Link to source entity (article page, company card, contact card)

### 3.3 No Frontend Changes

Results render as standard chat response HTML — same card pattern as existing handlers. No new HTMX partials or Alpine.js components needed.

---

## 4. GCS Backup

New service: `src/services/backup.ts`

### 4.1 Mechanism

- Uses DuckDB `EXPORT DATABASE '/tmp/ci-backup'` to dump to a temp directory
- Tarballs the export and uploads to GCS
- Bucket: `contact-intel-backups` in existing `test-disco-cm` project
- Object path: `backups/contact-intel-{ISO-date}.tar.gz`

### 4.2 Retention

- Keeps last 5 backups
- Deletes older objects after successful upload

### 4.3 Trigger

- Manual via chat command: "backup database"
- New intent handler: `handleBackup()` in chat-handlers
- Future: cron job (not in this scope)

### 4.4 Restore

Manual process — download tarball, extract, use DuckDB `IMPORT DATABASE`. No automated restore in scope.

---

## 5. File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/db/schema.sql` | Modify | Add `embeddings` + `embedding_sources` tables |
| `src/db/client.ts` | Modify | Add migration for new tables, embedding CRUD helpers |
| `src/services/embeddings.ts` | Create | Core embedding pipeline: embed, chunk, store, search |
| `src/services/backup.ts` | Create | GCS backup: export, upload, rotate |
| `src/services/companies.ts` | Modify | Hook note embedding after `updateCompany()` |
| `src/services/contacts.ts` | Modify | Hook note embedding after `updateContact()` |
| `src/services/company-research.ts` | Modify | Hook research embedding after `researchCompany()` |
| `src/services/sync-events.ts` | Modify | Trigger article embedding after sync |
| `src/services/local-llm.ts` | Modify | Add `memory_search` intent classification |
| `src/web/routes/chat-handlers.tsx` | Modify | Add `handleMemorySearch()` + `handleBackup()` handlers |
| `src/types/index.ts` | Modify | Add embedding types |

---

## 6. Privacy Boundary

- **Gemini API (cloud):** CMS article content (public), company research descriptions (non-PII)
- **Notes with PII:** Embedded via Gemini for now (notes are internal-only, not published). Future: local embeddings via LM Studio when embedding models are available
- **No contact emails or personal data** sent to Gemini — only note text and article content

---

## 7. Out of Scope

- Memory compaction / summarization
- Local embedding via LM Studio (future phase)
- Automatic scheduled backups (cron)
- Automated restore from GCS
- Cross-project embedding (Workbench articles)
- Embedding search filters (by content_type, date range) — can add later
