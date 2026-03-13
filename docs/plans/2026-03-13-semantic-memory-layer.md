# Semantic Memory Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vector embeddings to Contact Intelligence so the chat interface can semantically search CMS articles, company notes, and research profiles.

**Architecture:** Gemini `text-embedding-004` embeds content into 768-dimensional vectors stored in DuckDB `FLOAT[768]` columns. A new `embeddings.ts` service handles chunking, embedding, and cosine similarity search. The chat interface gets a new `memory_search` intent that embeds the query and returns top-10 results.

**Tech Stack:** DuckDB (FLOAT[768] + list_cosine_similarity), Gemini Embedding API, Bun + Hono, HTMX/JSX cards

**Spec:** `docs/specs/2026-03-13-semantic-memory-layer-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/db/schema.sql` | Modify | Add `embeddings` + `embedding_sources` tables |
| `src/db/client.ts` | No change | Tables created via `CREATE TABLE IF NOT EXISTS` in schema.sql |
| `src/types/index.ts` | Modify | Add Embedding + EmbeddingSource types |
| `src/services/embeddings.ts` | Create | Core service: embed, chunk, store, search, article/note/research flows |
| `src/services/company-research.ts` | Modify | Hook embedding after research |
| `src/services/companies.ts` | Modify | Hook embedding after note update |
| `src/services/contacts.ts` | Modify | Hook embedding after note update |
| `src/services/local-llm.ts` | Modify | Add `memory_search` category + regex fallback |
| `src/web/routes/chat-handlers.tsx` | Modify | Add `handleMemorySearch` handler + registry entry |
| `src/web/cards/memory-results.tsx` | Create | HTMX card for search results |
| `src/services/backup.ts` | Create | GCS backup: export, upload, rotate |

---

## Chunk 1: Data Model + Embedding Service Core

### Task 1: Add types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add embedding types to types/index.ts**

Add at the bottom of `src/types/index.ts`:

```typescript
// --- Embedding / Semantic Memory types ---

export type EmbeddingContentType = 'article' | 'note' | 'research';

export interface Embedding {
  id: string;
  content_type: EmbeddingContentType;
  source_id: string;
  chunk_index: number;
  content_text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EmbeddingSource {
  id: string;
  content_type: EmbeddingContentType;
  source_ref: string;
  content_hash: string;
  chunk_count: number;
  last_embedded_at: string;
}

export interface EmbeddingSearchResult {
  id: string;
  content_type: EmbeddingContentType;
  source_id: string;
  chunk_index: number;
  content_text: string;
  metadata: Record<string, unknown>;
  score: number;
}
```

- [ ] **Step 2: Commit**

```bash
cd /c/Projects/contact-intelligence
git add src/types/index.ts
git commit -m "feat(memory): add embedding types"
```

---

### Task 2: Add schema + migration

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/client.ts`

- [ ] **Step 1: Add tables to schema.sql**

Append to the end of `src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS embedding_sources (
  id VARCHAR PRIMARY KEY,
  content_type VARCHAR NOT NULL,
  source_ref VARCHAR NOT NULL,
  content_hash VARCHAR NOT NULL,
  chunk_count INTEGER DEFAULT 1,
  last_embedded_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR),
  UNIQUE(content_type, source_ref)
);

CREATE TABLE IF NOT EXISTS embeddings (
  id VARCHAR PRIMARY KEY,
  content_type VARCHAR NOT NULL,
  source_id VARCHAR NOT NULL REFERENCES embedding_sources(id),
  chunk_index INTEGER DEFAULT 0,
  content_text VARCHAR NOT NULL,
  embedding FLOAT[768] NOT NULL,
  metadata VARCHAR DEFAULT '{}',
  created_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_type ON embeddings(content_type);
CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_id);
CREATE INDEX IF NOT EXISTS idx_embedding_sources_type_ref ON embedding_sources(content_type, source_ref);
```

- [ ] **Step 2: Verify schema loads**

Run:
```bash
cd /c/Projects/contact-intelligence && bun run src/index.ts &
```
Wait 2 seconds, then kill. Check that no schema errors appear. The `CREATE TABLE IF NOT EXISTS` will create the new tables automatically on startup via the schema execution loop in `client.ts:40-48`.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.sql
git commit -m "feat(memory): add embeddings + embedding_sources tables"
```

---

### Task 3: Create core embedding service

**Files:**
- Create: `src/services/embeddings.ts`

- [ ] **Step 1: Create the embedding service with Gemini API + chunking + CRUD**

Create `src/services/embeddings.ts`:

```typescript
/**
 * Semantic memory layer — embeds content via Gemini text-embedding-004
 * and stores vectors in DuckDB for cosine similarity search.
 */

import { generateId, queryAll, queryOne, run, exec } from "../db/client.ts";
import type { EmbeddingContentType, EmbeddingSearchResult, EmbeddingSource } from "../types/index.ts";

const EMBEDDING_URL = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";
const EMBEDDING_DIM = 768;
const CHUNK_TARGET_CHARS = 2000; // ~500 tokens
const EMBED_DELAY_MS = 100;

// --- Gemini Embedding API ---

async function embedText(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[]> {
  const apiKey = Bun.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const res = await fetch(`${EMBEDDING_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      taskType,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini Embedding API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIM) {
    throw new Error(`Unexpected embedding response: expected ${EMBEDDING_DIM} floats, got ${values?.length}`);
  }
  return values;
}

// --- Text chunking ---

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_TARGET_CHARS) return [text];

  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > CHUNK_TARGET_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? "\n\n" : "") + para;
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.length > 0 ? chunks : [text];
}

function hashContent(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}

// --- Storage helpers ---

async function getEmbeddingSource(contentType: EmbeddingContentType, sourceRef: string): Promise<EmbeddingSource | null> {
  return queryOne<EmbeddingSource>(
    `SELECT * FROM embedding_sources WHERE content_type = $type AND source_ref = $ref`,
    { $type: contentType, $ref: sourceRef }
  );
}

async function upsertEmbeddingSource(
  contentType: EmbeddingContentType,
  sourceRef: string,
  contentHash: string,
  chunkCount: number,
): Promise<string> {
  const existing = await getEmbeddingSource(contentType, sourceRef);
  if (existing) {
    await run(
      `UPDATE embedding_sources SET content_hash = $hash, chunk_count = $chunks, last_embedded_at = CAST(current_timestamp AS VARCHAR) WHERE id = $id`,
      { $id: existing.id, $hash: contentHash, $chunks: chunkCount }
    );
    return existing.id;
  }
  const id = generateId();
  await run(
    `INSERT INTO embedding_sources (id, content_type, source_ref, content_hash, chunk_count) VALUES ($id, $type, $ref, $hash, $chunks)`,
    { $id: id, $type: contentType, $ref: sourceRef, $hash: contentHash, $chunks: chunkCount }
  );
  return id;
}

async function deleteEmbeddingsForSource(sourceId: string): Promise<void> {
  await run(`DELETE FROM embeddings WHERE source_id = $id`, { $id: sourceId });
}

async function insertEmbedding(
  contentType: EmbeddingContentType,
  sourceId: string,
  chunkIndex: number,
  contentText: string,
  embedding: number[],
  metadata: Record<string, unknown>,
): Promise<void> {
  const id = generateId();
  // DuckDB: vector must be inlined as array literal (prepared statements don't bind FLOAT[] well).
  // All other fields use parameterized queries to prevent SQL injection.
  const vecStr = `[${embedding.join(",")}]::FLOAT[${EMBEDDING_DIM}]`;
  await run(
    `INSERT INTO embeddings (id, content_type, source_id, chunk_index, content_text, embedding, metadata)
     VALUES ($id, $type, $sourceId, $chunk, $text, ${vecStr}, $meta)`,
    {
      $id: id,
      $type: contentType,
      $sourceId: sourceId,
      $chunk: chunkIndex,
      $text: contentText,
      $meta: JSON.stringify(metadata),
    }
  );
}

// --- Public: embed content ---

/**
 * Embed a piece of content. Skips if content hash unchanged.
 * Returns true if embedding was performed, false if skipped.
 */
export async function embedContent(
  contentType: EmbeddingContentType,
  sourceRef: string,
  text: string,
  metadata: Record<string, unknown> = {},
): Promise<boolean> {
  if (!text || text.trim().length < 20) return false;

  const hash = hashContent(text);
  const existing = await getEmbeddingSource(contentType, sourceRef);
  if (existing && existing.content_hash === hash) return false;

  const chunks = chunkText(text);

  // Embed all chunks
  const vectors: number[][] = [];
  for (const chunk of chunks) {
    const vec = await embedText(chunk, "RETRIEVAL_DOCUMENT");
    vectors.push(vec);
    if (chunks.length > 1) await new Promise((r) => setTimeout(r, EMBED_DELAY_MS));
  }

  // Upsert source + replace embeddings atomically
  const sourceId = await upsertEmbeddingSource(contentType, sourceRef, hash, chunks.length);
  await deleteEmbeddingsForSource(sourceId);

  for (let i = 0; i < chunks.length; i++) {
    await insertEmbedding(contentType, sourceId, i, chunks[i]!, vectors[i]!, metadata);
  }

  return true;
}

// --- Public: semantic search ---

export async function searchEmbeddings(
  query: string,
  opts?: { limit?: number; minScore?: number; contentType?: EmbeddingContentType },
): Promise<EmbeddingSearchResult[]> {
  const queryVec = await embedText(query, "RETRIEVAL_QUERY");
  const limit = opts?.limit ?? 10;
  const minScore = opts?.minScore ?? 0.65;

  const vecStr = `[${queryVec.join(",")}]::FLOAT[${EMBEDDING_DIM}]`;

  // Vector and numeric thresholds are safe to inline (not user input).
  // contentType filter uses parameterized query.
  let sql = `SELECT id, content_type, source_id, chunk_index, content_text, metadata,
    list_cosine_similarity(embedding, ${vecStr}) AS score
    FROM embeddings
    WHERE list_cosine_similarity(embedding, ${vecStr}) > ${minScore}`;

  const params: Record<string, unknown> = {};
  if (opts?.contentType) {
    sql += ` AND content_type = $contentType`;
    params.$contentType = opts.contentType;
  }

  sql += ` ORDER BY score DESC LIMIT ${limit}`;

  const rows = await queryAll<{
    id: string;
    content_type: string;
    source_id: string;
    chunk_index: number;
    content_text: string;
    metadata: string;
    score: number;
  }>(sql, Object.keys(params).length > 0 ? params : undefined);

  return rows.map((r) => ({
    id: r.id,
    content_type: r.content_type as EmbeddingContentType,
    source_id: r.source_id,
    chunk_index: r.chunk_index,
    content_text: r.content_text,
    metadata: JSON.parse(r.metadata || "{}"),
    score: typeof r.score === "number" ? r.score : Number(r.score),
  }));
}

// --- Public: stats ---

export async function getEmbeddingStats(): Promise<{ totalSources: number; totalChunks: number; byType: Record<string, number> }> {
  const total = await queryOne<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM embeddings`);
  const sources = await queryOne<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM embedding_sources`);
  const byType = await queryAll<{ content_type: string; cnt: number }>(
    `SELECT content_type, COUNT(*) AS cnt FROM embeddings GROUP BY content_type`
  );
  return {
    totalSources: sources?.cnt ?? 0,
    totalChunks: total?.cnt ?? 0,
    byType: Object.fromEntries(byType.map((r) => [r.content_type, r.cnt])),
  };
}
```

- [ ] **Step 2: Verify service compiles**

```bash
cd /c/Projects/contact-intelligence && bun build src/services/embeddings.ts --no-bundle 2>&1 | head -5
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/embeddings.ts
git commit -m "feat(memory): core embedding service with Gemini API + chunking + cosine search"
```

---

## Chunk 2: Integration Hooks

### Task 4: Hook into company research

**Files:**
- Modify: `src/services/company-research.ts`

- [ ] **Step 1: Add embedding call after successful research**

At the top of `company-research.ts`, add:

```typescript
import { embedContent } from "./embeddings.ts";
```

At the end of `researchCompany()`, before the final `return`, add embedding (after the `try { const parsed = JSON.parse(text); ...` block, before the return):

Replace the existing return statement inside the try block (line ~65-71):

```typescript
    const result: CompanyResearchResult = {
      description: parsed.description || null,
      industry: parsed.industry || null,
      country: parsed.country || null,
      size_bucket: parsed.size_bucket || null,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: string) => String(t).toLowerCase().trim()).filter(Boolean) : [],
    };

    // Embed research description for semantic search (fire-and-forget)
    if (result.description) {
      embedContent("research", `company:${name}`, result.description, {
        company_name: name,
        domain: domain || undefined,
        industry: result.industry,
      }).catch((err) => console.warn("Failed to embed research:", err.message));
    }

    return result;
```

- [ ] **Step 2: Commit**

```bash
git add src/services/company-research.ts
git commit -m "feat(memory): embed company research descriptions"
```

---

### Task 5: Hook into company note updates

**Files:**
- Modify: `src/services/companies.ts`

- [ ] **Step 1: Add embedding after note update**

At the top of `companies.ts`, add:

```typescript
import { embedContent } from "./embeddings.ts";
```

At the end of `updateCompany()`, after the final `await run(...)` call (line ~89), add:

```typescript
  // Embed updated notes for semantic search (fire-and-forget)
  if (fields.notes !== undefined && fields.notes) {
    const company = await queryOne<{ name: string }>(`SELECT name FROM companies WHERE id = $id`, { $id: id });
    embedContent("note", `company:${id}`, fields.notes, {
      company_id: id,
      company_name: company?.name,
    }).catch((err) => console.warn("Failed to embed company note:", err.message));
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/services/companies.ts
git commit -m "feat(memory): embed company notes on update"
```

---

### Task 6: Hook into contact note updates

**Files:**
- Modify: `src/services/contacts.ts`

- [ ] **Step 1: Add embedding after note update**

At the top of `contacts.ts`, add:

```typescript
import { embedContent } from "./embeddings.ts";
```

At the end of `updateContact()`, after the reattach loop (line ~125), add:

```typescript
  // Embed updated notes for semantic search (fire-and-forget)
  if (fields.notes !== undefined && fields.notes) {
    const contact = await queryOne<{ name: string; email: string }>(
      `SELECT name, email FROM contacts WHERE id = $id`, { $id: id }
    );
    embedContent("note", `contact:${id}`, fields.notes, {
      contact_id: id,
      contact_name: contact?.name,
      contact_email: contact?.email,
    }).catch((err) => console.warn("Failed to embed contact note:", err.message));
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/services/contacts.ts
git commit -m "feat(memory): embed contact notes on update"
```

---

### Task 7: Add article embedding command

**Files:**
- Modify: `src/services/embeddings.ts`

- [ ] **Step 1: Add embedArticles function**

Add to `src/services/embeddings.ts` after the existing functions:

```typescript
// --- Article embedding (batch) ---

const CMS_URL = "https://et-cms-9775734614.europe-north1.run.app";

async function getCmsToken(): Promise<string> {
  const proc = Bun.spawn(["gcloud.cmd", "auth", "print-identity-token"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  if (!text.trim()) throw new Error("Failed to get identity token");
  return text.trim();
}

async function fetchArticleContent(section: string, slug: string, token: string): Promise<{ title: string; content: string } | null> {
  try {
    const res = await fetch(`${CMS_URL}/api/content/${section}/${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // CMS returns markdown content with frontmatter
    const content = data?.content || data?.body || data?.markdown || "";
    const title = data?.title || data?.metadata?.title || slug;
    if (!content || content.length < 50) return null;
    return { title, content };
  } catch {
    return null;
  }
}

/**
 * Embed all CMS articles that contacts have read (from cms_events).
 * Skips articles already embedded with same content hash.
 * Returns count of newly embedded articles.
 */
export async function embedArticles(): Promise<{ processed: number; embedded: number; skipped: number; errors: number }> {
  // Get distinct articles from cms_events
  const articles = await queryAll<{ section: string; slug: string; contentTitle: string }>(
    `SELECT DISTINCT section, slug, contentTitle
     FROM cms_events
     WHERE slug IS NOT NULL AND section IS NOT NULL AND eventType = 'page_view'
     ORDER BY section, slug`
  );

  const token = await getCmsToken();
  let embedded = 0;
  let skipped = 0;
  let errors = 0;

  for (const article of articles) {
    try {
      const data = await fetchArticleContent(article.section, article.slug, token);
      if (!data) {
        skipped++;
        continue;
      }

      const didEmbed = await embedContent("article", `${article.section}/${article.slug}`, data.content, {
        slug: article.slug,
        section: article.section,
        contentTitle: data.title || article.contentTitle,
      });

      if (didEmbed) {
        embedded++;
        console.log(`  Embedded: ${article.section}/${article.slug}`);
      } else {
        skipped++;
      }
    } catch (err: any) {
      console.warn(`  Error embedding ${article.section}/${article.slug}:`, err.message);
      errors++;
    }
  }

  return { processed: articles.length, embedded, skipped, errors };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/embeddings.ts
git commit -m "feat(memory): add batch article embedding from CMS"
```

---

## Chunk 3: Chat Integration

### Task 8: Add memory_search intent to LLM classifier

**Files:**
- Modify: `src/services/local-llm.ts`

- [ ] **Step 1: Update category prompt**

In `local-llm.ts`, update the `CATEGORY_PROMPT` string (line ~89). Add a new category after `admin`:

Replace the categories list in the prompt:

```
Categories:
- view_data: user wants to see data (dashboard, articles, page views, surveys, engagement scores, lists overview)
- entity_lookup: user wants to see a specific company, contact, list, or asks about a named entity ("show Visma", "who is Hanne?", "who works at Spotify?", "timeline for Acme", "survey dimensions for Visma")
- action: user wants to DO something (run sync, enrich contacts, research a company)
- memory_search: user wants to search across knowledge — articles content, notes, research profiles ("what articles about AI governance?", "what do we know about cloud migration?", "any notes on sustainability?", "find insights about leadership")
- admin: help, commands, sync status, backup database, embed articles
- unknown: cannot determine
```

- [ ] **Step 2: Update validCategories and the switch statement in understandQuery**

In the `understandQuery` function, update the `validCategories` array (~line 198) to include `"memory_search"`:

```typescript
    const validCategories = ["view_data", "entity_lookup", "action", "memory_search", "admin", "unknown"];
```

In the switch block (~line 217-223), add the new case:

```typescript
      case "memory_search": intent = "memory_search"; break;
```

- [ ] **Step 3: Update admin sub-classifier for new commands**

Update `subClassifyAdmin`:

```typescript
function subClassifyAdmin(msg: string): string {
  const lower = msg.toLowerCase();
  if (/\b(sync status|sync log|when.* last sync|last sync)\b/.test(lower)) return "sync_status";
  if (/\b(backup|back up|export database)\b/.test(lower)) return "backup";
  if (/\b(embed articles|index articles|build embeddings|reindex)\b/.test(lower)) return "embed_articles";
  if (/\b(embedding stats|memory stats|how many embeddings)\b/.test(lower)) return "embedding_stats";
  return "help";
}
```

- [ ] **Step 4: Add regex fallback patterns for memory_search**

**IMPORTANT:** These patterns must be added BEFORE the existing lookup patterns (~line 462) in `regexFallback`, because the lookup patterns match "what do we know about..." which overlaps. Insert this block before the `// Lookup patterns` comment:

```typescript
  // Memory search (must be before lookup patterns to catch "what do we know about...")
  if (/\b(articles about|notes on|research on|insights about|search.*memory|what have.*read about)\b/.test(slashStripped)) {
    const searchMatch = slashStripped.match(/(?:articles about|notes on|research on|insights about|search.*memory|what have.*read about)\s*(.*)/);
    const searchQuery = searchMatch?.[1]?.replace(/[?.!]+$/, "").trim() || slashStripped;
    return { intent: "memory_search", entities: { name: searchQuery }, confidence: 0.8 };
  }
```

Also add slash commands near the bottom (before the final `return { intent: "unknown" ...`):

```typescript
  if (slashStripped.startsWith("search ") || slashStripped.startsWith("memory ")) {
    return { intent: "memory_search", entities: { name: slashStripped.replace(/^(search|memory)\s+/, "").trim() }, confidence: 1.0 };
  }
  if (slashStripped === "embed articles" || slashStripped === "index articles") {
    return { intent: "embed_articles", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "embedding stats" || slashStripped === "memory stats") {
    return { intent: "embedding_stats", entities: {}, confidence: 1.0 };
  }
  if (slashStripped === "backup" || slashStripped === "backup database") {
    return { intent: "backup", entities: {}, confidence: 1.0 };
  }
```

Note: "what do we know about X" will still route to `lookup` (existing behavior). This is correct — entity lookups should take priority. Users wanting semantic search use `/search X` or "articles about X".

- [ ] **Step 5: Commit**

```bash
git add src/services/local-llm.ts
git commit -m "feat(memory): add memory_search intent to query classifier"
```

---

### Task 9: Create memory results card

**Files:**
- Create: `src/web/cards/memory-results.tsx`

- [ ] **Step 1: Create the HTMX card component**

```tsx
import type { EmbeddingSearchResult } from "../../types/index.ts";

function typeLabel(type: string): string {
  switch (type) {
    case "article": return "Article";
    case "note": return "Note";
    case "research": return "Research";
    default: return type;
  }
}

function typeColor(type: string): string {
  switch (type) {
    case "article": return "var(--visma-turquoise)";
    case "note": return "var(--visma-lime)";
    case "research": return "var(--visma-purple, #8b5cf6)";
    default: return "var(--visma-turquoise)";
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "...";
}

export function MemoryResultsCard({ results, query }: { results: EmbeddingSearchResult[]; query: string }) {
  if (results.length === 0) {
    return (
      <div class="card">
        <div class="card-label mb-xs">Memory Search</div>
        <div class="text-sm text-muted">No results found for "{query}". Try embedding articles first: <span class="font-mono">/embed articles</span></div>
      </div>
    );
  }

  // Group by content_type
  const grouped: Record<string, EmbeddingSearchResult[]> = {};
  for (const r of results) {
    (grouped[r.content_type] ??= []).push(r);
  }

  return (
    <div class="card">
      <div class="card-label mb-xs">Memory Search: "{query}"</div>
      <div class="text-xs text-muted mb-sm">{results.length} results found</div>

      {Object.entries(grouped).map(([type, items]) => (
        <div class="mb-sm">
          <div class="section-title" style={`color: ${typeColor(type)}; font-size: 0.75rem; margin-bottom: 0.25rem`}>
            {typeLabel(type)} ({items.length})
          </div>
          {items.map((r) => {
            const meta = r.metadata || {};
            const title = (meta.contentTitle as string) || (meta.company_name as string) || (meta.contact_name as string) || (meta.slug as string) || "Untitled";
            const score = Math.round(r.score * 100);
            return (
              <div class="table-row" style="align-items: flex-start">
                <div class="flex-1">
                  <div class="text-sm" style="font-weight: 600">{title}</div>
                  <div class="text-xs text-muted" style="margin-top: 2px; line-height: 1.4">
                    {truncate(r.content_text, 200)}
                  </div>
                </div>
                <div class="text-xs" style={`color: ${typeColor(type)}; white-space: nowrap; margin-left: 8px`}>
                  {score}%
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function EmbeddingStatsCard({ stats }: { stats: { totalSources: number; totalChunks: number; byType: Record<string, number> } }) {
  return (
    <div class="card">
      <div class="card-label mb-xs">Embedding Stats</div>
      <div class="stat-grid" style="grid-template-columns: repeat(2, 1fr)">
        <div class="stat-box">
          <div class="stat-value" style="font-size: 1.5rem">{stats.totalSources}</div>
          <div class="stat-label">Sources</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style="font-size: 1.5rem">{stats.totalChunks}</div>
          <div class="stat-label">Chunks</div>
        </div>
      </div>
      {Object.entries(stats.byType).length > 0 && (
        <div class="text-xs text-muted mt-sm">
          {Object.entries(stats.byType).map(([type, count]) => (
            <span style="margin-right: 12px">{typeLabel(type)}: {count}</span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/cards/memory-results.tsx
git commit -m "feat(memory): add memory search results HTMX card"
```

---

### Task 10: Add chat handlers

**Files:**
- Modify: `src/web/routes/chat-handlers.tsx`

- [ ] **Step 1: Add imports**

At the top of `chat-handlers.tsx`, add:

```typescript
import { searchEmbeddings, embedArticles, getEmbeddingStats } from "../../services/embeddings.ts";
import { MemoryResultsCard, EmbeddingStatsCard } from "../cards/memory-results.tsx";
```

- [ ] **Step 2: Add handler functions**

Before the handler registry object (~line 366), add:

```typescript
const handleMemorySearch: IntentHandler = async (entities) => {
  const query = entities.name || "";
  if (!query) {
    return {
      html: <div class="card"><div class="text-sm text-muted">What are you looking for? Try: "articles about AI governance" or "search cloud migration"</div></div>,
      summary: "Asked for search query",
    };
  }
  try {
    const results = await searchEmbeddings(query);
    return {
      html: <MemoryResultsCard results={results} query={query} />,
      summary: `Memory search: ${results.length} results for "${query}"`,
    };
  } catch (err: any) {
    return {
      html: <div class="card"><div class="text-sm" style="color: var(--visma-coral)">Search error: {err.message}</div></div>,
      summary: `Memory search failed: ${err.message}`,
    };
  }
};

const handleEmbedArticles: IntentHandler = async () => {
  try {
    const result = await embedArticles();
    return {
      html: (
        <div class="card">
          <div class="card-label mb-xs">Article Embedding</div>
          <div class="section-title">Embedding Complete</div>
          <div class="stat-grid" style="grid-template-columns: repeat(4, 1fr)">
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem">{result.processed}</div>
              <div class="stat-label">Articles</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem; color: var(--visma-turquoise)">{result.embedded}</div>
              <div class="stat-label">Embedded</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem">{result.skipped}</div>
              <div class="stat-label">Skipped</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem; color: var(--visma-coral)">{result.errors}</div>
              <div class="stat-label">Errors</div>
            </div>
          </div>
        </div>
      ),
      summary: `Embedded ${result.embedded}/${result.processed} articles`,
    };
  } catch (err: any) {
    return {
      html: <div class="card"><div class="text-sm" style="color: var(--visma-coral)">Embedding error: {err.message}</div></div>,
      summary: `Article embedding failed: ${err.message}`,
    };
  }
};

const handleEmbeddingStats: IntentHandler = async () => {
  const stats = await getEmbeddingStats();
  return {
    html: <EmbeddingStatsCard stats={stats} />,
    summary: `Embedding stats: ${stats.totalChunks} chunks across ${stats.totalSources} sources`,
  };
};
```

- [ ] **Step 3: Register in handler map**

Add to the `handlers` object:

```typescript
  memory_search: handleMemorySearch,
  embed_articles: handleEmbedArticles,
  embedding_stats: handleEmbeddingStats,
```

- [ ] **Step 4: Update HelpCard**

Add these lines to the HelpCard JSX (after the `/research [company]` line):

```tsx
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/search [query]</span> — semantic search across articles, notes, research</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/embed articles</span> — index CMS articles for semantic search</div>
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/embedding stats</span> — show embedding statistics</div>
```

- [ ] **Step 5: Commit**

```bash
git add src/web/routes/chat-handlers.tsx
git commit -m "feat(memory): add memory_search + embed_articles + embedding_stats chat handlers"
```

---

## Chunk 4: GCS Backup

### Task 11: Create backup service

**Files:**
- Create: `src/services/backup.ts`

- [ ] **Step 1: Create the backup service**

```typescript
/**
 * GCS backup for the DuckDB database.
 * Uses DuckDB EXPORT DATABASE + gcloud storage upload.
 */

import { exec } from "../db/client.ts";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const BUCKET = "contact-intel-backups";
const MAX_BACKUPS = 5;
const BACKUP_DIR = join(import.meta.dir, "../../data/backup-tmp");

export interface BackupResult {
  success: boolean;
  path?: string;
  error?: string;
}

export async function backupToGCS(): Promise<BackupResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const exportDir = join(BACKUP_DIR, timestamp);

  try {
    // Clean up any previous temp
    if (existsSync(BACKUP_DIR)) rmSync(BACKUP_DIR, { recursive: true });
    mkdirSync(exportDir, { recursive: true });

    // Export DuckDB to directory
    await exec(`EXPORT DATABASE '${exportDir.replace(/\\/g, "/")}'`);

    // Tar and upload
    const tarPath = `${BACKUP_DIR}/${timestamp}.tar.gz`;
    const tarProc = Bun.spawn(["tar", "-czf", tarPath, "-C", BACKUP_DIR, timestamp], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await tarProc.exited;

    // Upload to GCS
    const gcsPath = `gs://${BUCKET}/backups/contact-intel-${timestamp}.tar.gz`;
    const uploadProc = Bun.spawn(
      ["gcloud.cmd", "storage", "cp", tarPath, gcsPath],
      { stdout: "pipe", stderr: "pipe" }
    );
    const exitCode = await uploadProc.exited;
    const stderr = await new Response(uploadProc.stderr).text();

    if (exitCode !== 0) {
      throw new Error(`GCS upload failed: ${stderr}`);
    }

    // Rotate old backups
    await rotateBackups();

    // Clean up temp
    rmSync(BACKUP_DIR, { recursive: true });

    return { success: true, path: gcsPath };
  } catch (err: any) {
    // Clean up temp on error
    if (existsSync(BACKUP_DIR)) rmSync(BACKUP_DIR, { recursive: true });
    return { success: false, error: err.message };
  }
}

async function rotateBackups(): Promise<void> {
  try {
    const listProc = Bun.spawn(
      ["gcloud.cmd", "storage", "ls", `gs://${BUCKET}/backups/`],
      { stdout: "pipe", stderr: "pipe" }
    );
    const output = await new Response(listProc.stdout).text();
    const files = output.trim().split("\n").filter(Boolean).sort();

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(0, files.length - MAX_BACKUPS);
      for (const file of toDelete) {
        Bun.spawn(["gcloud.cmd", "storage", "rm", file], { stdout: "pipe", stderr: "pipe" });
      }
    }
  } catch {
    // Best effort rotation
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/backup.ts
git commit -m "feat(memory): add GCS database backup service"
```

---

### Task 12: Add backup chat handler

**Files:**
- Modify: `src/web/routes/chat-handlers.tsx`

- [ ] **Step 1: Add import**

```typescript
import { backupToGCS } from "../../services/backup.ts";
```

- [ ] **Step 2: Add handler**

```typescript
const handleBackup: IntentHandler = async () => {
  try {
    const result = await backupToGCS();
    if (result.success) {
      return {
        html: (
          <div class="card">
            <div class="card-label mb-xs" style="color: var(--visma-turquoise)">Backup Complete</div>
            <div class="text-sm">Database exported to GCS</div>
            <div class="text-xs text-muted mt-xs">{result.path}</div>
          </div>
        ),
        summary: `Database backed up to ${result.path}`,
      };
    }
    throw new Error(result.error);
  } catch (err: any) {
    return {
      html: <div class="card"><div class="text-sm" style="color: var(--visma-coral)">Backup failed: {err.message}</div></div>,
      summary: `Backup failed: ${err.message}`,
    };
  }
};
```

- [ ] **Step 3: Register in handler map**

Add to the `handlers` object:

```typescript
  backup: handleBackup,
```

- [ ] **Step 4: Update HelpCard**

Add after the `/embedding stats` line:

```tsx
        <div><span class="font-mono" style="color: var(--visma-turquoise)">/backup</span> — backup database to GCS</div>
```

- [ ] **Step 5: Commit**

```bash
git add src/web/routes/chat-handlers.tsx
git commit -m "feat(memory): add backup chat command"
```

---

## Chunk 5: End-to-End Verification

### Task 13: Manual end-to-end test

- [ ] **Step 1: Start the server**

```bash
cd /c/Projects/contact-intelligence && bun run src/index.ts
```

- [ ] **Step 2: Test embedding stats (should be empty)**

In the chat UI at `http://localhost:3002`, type: `/embedding stats`

Expected: Shows 0 sources, 0 chunks.

- [ ] **Step 3: Test article embedding**

Type: `/embed articles`

Expected: Shows progress, embeds articles from CMS events. This calls the Gemini embedding API — requires `GEMINI_API_KEY` in `.env`.

- [ ] **Step 4: Test semantic search**

Type: `search AI governance` or `articles about cloud migration`

Expected: Returns matching article chunks with relevance scores.

- [ ] **Step 5: Test research embedding**

Type: `research Visma` (or any company)

Expected: Research completes AND the description is embedded (check `/embedding stats` afterwards — research count should increment).

- [ ] **Step 6: Verify embedding stats updated**

Type: `/embedding stats`

Expected: Shows non-zero counts for articles and research.

- [ ] **Step 7: Final commit with any fixes**

```bash
git add -A
git commit -m "feat(memory): semantic memory layer complete — articles, notes, research, search"
```

- [ ] **Step 8: Push**

```bash
git push
```
