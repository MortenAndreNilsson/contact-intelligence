/**
 * Notebook service — personal knowledge store.
 * Notes are auto-embedded for semantic search on save.
 * Supports PDF upload: text is extracted and stored as note content.
 */

import { generateId, queryAll, queryOne, run } from "../db/client.ts";
import { embedContent } from "./embeddings.ts";
import type { NotebookEntry, NotebookRow } from "../types/index.ts";
import { existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { PDFParse } from "pdf-parse";

const PDF_DIR = join(import.meta.dir, "../../data/pdfs");

function parse(row: NotebookRow): NotebookEntry {
  return { ...row, tags: JSON.parse(row.tags || "[]") };
}

export async function createNote(fields: {
  title: string;
  content: string;
  url?: string;
  tags?: string[];
  pinned?: boolean;
}): Promise<NotebookEntry> {
  const id = generateId();
  await run(
    `INSERT INTO notebook (id, title, content, url, tags, pinned)
     VALUES ($id, $title, $content, $url, $tags, $pinned)`,
    {
      $id: id,
      $title: fields.title,
      $content: fields.content,
      $url: fields.url ?? null,
      $tags: JSON.stringify(fields.tags ?? []),
      $pinned: fields.pinned ?? false,
    }
  );

  // Auto-embed for semantic search
  const textToEmbed = `${fields.title}\n\n${fields.content}${fields.url ? `\n\nSource: ${fields.url}` : ""}`;
  embedContent("notebook", `notebook:${id}`, textToEmbed, {
    notebook_id: id,
    title: fields.title,
    url: fields.url,
    tags: fields.tags,
  }).catch((err) => console.warn("Failed to embed notebook entry:", err.message));

  return (await getNote(id))!;
}

export async function getNote(id: string): Promise<NotebookEntry | null> {
  const row = await queryOne<NotebookRow>(
    `SELECT * FROM notebook WHERE id = $id`,
    { $id: id }
  );
  return row ? parse(row) : null;
}

export async function listNotes(opts?: {
  query?: string;
  tag?: string;
  pinned?: boolean;
}): Promise<NotebookEntry[]> {
  let sql = `SELECT * FROM notebook WHERE 1=1`;
  const params: Record<string, unknown> = {};

  if (opts?.query) {
    sql += ` AND (title ILIKE $q OR content ILIKE $q)`;
    params.$q = `%${opts.query}%`;
  }
  if (opts?.tag) {
    sql += ` AND tags ILIKE $tag`;
    params.$tag = `%"${opts.tag}"%`;
  }
  if (opts?.pinned !== undefined) {
    sql += ` AND pinned = $pinned`;
    params.$pinned = opts.pinned;
  }

  sql += ` ORDER BY pinned DESC, updated_at DESC`;

  const rows = await queryAll<NotebookRow>(sql, Object.keys(params).length > 0 ? params : undefined);
  return rows.map(parse);
}

export async function updateNote(id: string, fields: Partial<Pick<NotebookEntry, "title" | "content" | "url" | "tags" | "pinned">>): Promise<void> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { $id: id };

  if (fields.title !== undefined) { sets.push("title = $title"); params.$title = fields.title; }
  if (fields.content !== undefined) { sets.push("content = $content"); params.$content = fields.content; }
  if (fields.url !== undefined) { sets.push("url = $url"); params.$url = fields.url; }
  if (fields.tags !== undefined) { sets.push("tags = $tags"); params.$tags = JSON.stringify(fields.tags); }
  if (fields.pinned !== undefined) { sets.push("pinned = $pinned"); params.$pinned = fields.pinned; }

  if (sets.length === 0) return;
  sets.push("updated_at = CAST(current_timestamp AS VARCHAR)");
  await run(`UPDATE notebook SET ${sets.join(", ")} WHERE id = $id`, params);

  // Re-embed if content or title changed
  if (fields.title !== undefined || fields.content !== undefined) {
    const note = await getNote(id);
    if (note) {
      const textToEmbed = `${note.title}\n\n${note.content}${note.url ? `\n\nSource: ${note.url}` : ""}`;
      embedContent("notebook", `notebook:${id}`, textToEmbed, {
        notebook_id: id,
        title: note.title,
        url: note.url,
        tags: note.tags,
      }).catch((err) => console.warn("Failed to re-embed notebook entry:", err.message));
    }
  }
}

export async function deleteNote(id: string): Promise<void> {
  // Clean up embeddings
  await run(
    `DELETE FROM embeddings WHERE source_id IN (SELECT id FROM embedding_sources WHERE source_ref = $ref)`,
    { $ref: `notebook:${id}` }
  );
  await run(`DELETE FROM embedding_sources WHERE source_ref = $ref`, { $ref: `notebook:${id}` });
  await run(`DELETE FROM notebook WHERE id = $id`, { $id: id });
}

export async function togglePin(id: string): Promise<boolean> {
  const note = await getNote(id);
  if (!note) return false;
  const newPinned = !note.pinned;
  await run(`UPDATE notebook SET pinned = $pinned WHERE id = $id`, { $id: id, $pinned: newPinned });
  return newPinned;
}

/**
 * Import a PDF file: extract text, save PDF to data/pdfs/, create notebook entry.
 * Returns the created notebook entry.
 */
export async function importPdf(file: File, tags?: string[]): Promise<NotebookEntry> {
  const buffer = Buffer.from(await file.arrayBuffer());

  // Extract text from PDF using pdf-parse v2
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const text = result.text?.trim();
  if (!text || text.length < 10) {
    throw new Error("Could not extract text from PDF (empty or too short)");
  }
  const numpages = result.total || 0;
  await parser.destroy();

  // Save PDF file to data/pdfs/
  if (!existsSync(PDF_DIR)) mkdirSync(PDF_DIR, { recursive: true });
  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const pdfId = generateId();
  const storedName = `${pdfId}-${safeFilename}`;
  const pdfPath = join(PDF_DIR, storedName);
  await Bun.write(pdfPath, buffer);

  // Use filename (without .pdf) as title
  const title = basename(file.name, ".pdf").replace(/[_-]+/g, " ").trim() || "Imported PDF";

  // Create notebook entry with extracted text
  const pdfTags = [...(tags ?? []), "pdf"];
  const note = await createNote({
    title,
    content: text,
    url: `file://pdfs/${storedName}`,
    tags: pdfTags,
  });

  console.log(`PDF imported: ${file.name} → ${text.length} chars, ${numpages} pages`);
  return note;
}
