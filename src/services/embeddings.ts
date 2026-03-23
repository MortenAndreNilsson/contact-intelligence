/**
 * Semantic memory layer — embeds content via Gemini text-embedding-004
 * and stores vectors in DuckDB for cosine similarity search.
 */

import { generateId, queryAll, queryOne, run } from "../db/client.ts";
import type { EmbeddingContentType, EmbeddingSearchResult, EmbeddingSource } from "../types/index.ts";

const EMBEDDING_URL = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";
const EMBEDDING_DIM = 768;
const CHUNK_TARGET_CHARS = 2000; // ~500 tokens
const EMBED_DELAY_MS = 100;

// --- Gemini Embedding API ---

async function embedText(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
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

// --- Article embedding (batch) ---

const GCS_BUCKET = "et-cms-content-prod-etai-cm";

async function getGcsToken(): Promise<string> {
  const proc = Bun.spawn(["gcloud.cmd", "auth", "print-access-token"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  if (!text.trim()) throw new Error("Failed to get access token");
  return text.trim();
}

/** Fetch article markdown from GCS. Tries published/{section}/{slug}.md and {section}/{slug}.md. */
async function fetchArticleContent(section: string, slug: string, token: string): Promise<{ title: string; content: string } | null> {
  const paths = [
    `published/${section}/${slug}.md`,
    `${section}/${slug}.md`,
  ];

  for (const path of paths) {
    try {
      const url = `https://storage.googleapis.com/storage/v1/b/${GCS_BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;

      const markdown = await res.text();
      if (!markdown || markdown.length < 50) continue;

      // Extract title from frontmatter or first heading
      let title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const titleMatch = markdown.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      if (titleMatch) title = titleMatch[1]!;
      else {
        const h1Match = markdown.match(/^#\s+(.+)$/m);
        if (h1Match) title = h1Match[1]!;
      }

      // Strip frontmatter for embedding
      const content = markdown.replace(/^---[\s\S]*?---\n*/m, "").trim();
      if (content.length < 50) continue;

      return { title, content };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Embed all CMS articles that contacts have read (from cms_events).
 * Skips articles already embedded with same content hash.
 * Returns count of newly embedded articles.
 */
export async function embedArticles(): Promise<{ processed: number; embedded: number; skipped: number; errors: number }> {
  const articles = await queryAll<{ section: string; slug: string; contentTitle: string }>(
    `SELECT DISTINCT section, slug, MAX(contentTitle) as contentTitle
     FROM cms_events
     WHERE slug IS NOT NULL AND section IS NOT NULL
       AND slug != '' AND section != ''
     GROUP BY section, slug
     ORDER BY section, slug`
  );

  const token = await getGcsToken();
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

/**
 * Embed all notebook entries. Skips unchanged (via content hash).
 */
export async function embedNotebooks(): Promise<{ processed: number; embedded: number; skipped: number; errors: number }> {
  const { queryAll: q } = await import("../db/client.ts");
  const notes = await q<{ id: string; title: string; content: string; url: string | null; tags: string }>(
    `SELECT id, title, content, url, tags FROM notebook ORDER BY updated_at DESC`
  );

  let embedded = 0;
  let skipped = 0;
  let errors = 0;

  for (const note of notes) {
    try {
      const textToEmbed = `${note.title}\n\n${note.content}${note.url ? `\n\nSource: ${note.url}` : ""}`;
      const didEmbed = await embedContent("notebook", `notebook:${note.id}`, textToEmbed, {
        notebook_id: note.id,
        title: note.title,
        url: note.url,
        tags: JSON.parse(note.tags || "[]"),
      });

      if (didEmbed) {
        embedded++;
        console.log(`  Embedded notebook: ${note.title}`);
      } else {
        skipped++;
      }
    } catch (err: any) {
      console.warn(`  Error embedding notebook ${note.id}:`, err.message);
      errors++;
    }
  }

  return { processed: notes.length, embedded, skipped, errors };
}
