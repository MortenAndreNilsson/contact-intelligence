/**
 * Memory handlers — semantic search, article embedding, embedding stats, backup.
 * G5 Semantic Memory Layer chat integration.
 */

import type { IntentHandler } from "../chat-handlers.tsx";
import { searchEmbeddings, embedArticles, embedNotebooks, getEmbeddingStats } from "../../../services/embeddings.ts";
import { createLocalBackup, uploadToGCS } from "../../../services/backup.ts";
import { listNotes } from "../../../services/notebook.ts";
import { MemoryResultsCard, EmbeddingStatsCard } from "../../cards/memory-results.tsx";
import { NotebookListCard } from "../../cards/notebook-card.tsx";

export const handleMemorySearch: IntentHandler = async (entities) => {
  const query = entities.name || "";
  if (!query) {
    return {
      html: <div class="card"><div class="text-sm text-muted">What are you looking for? Try: "articles about AI governance" or "/search cloud migration"</div></div>,
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

export const handleEmbedArticles: IntentHandler = async () => {
  try {
    const result = await embedArticles();
    return {
      html: (
        <div class="card">
          <div class="card-label mb-xs">Article Embedding</div>
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

export const handleEmbedNotebooks: IntentHandler = async () => {
  try {
    const result = await embedNotebooks();
    return {
      html: (
        <div class="card">
          <div class="card-label mb-xs">Notebook Embedding</div>
          <div class="stat-grid" style="grid-template-columns: repeat(4, 1fr)">
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem">{result.processed}</div>
              <div class="stat-label">Notes</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem; color: var(--visma-yellow)">{result.embedded}</div>
              <div class="stat-label">Embedded</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem">{result.skipped}</div>
              <div class="stat-label">Unchanged</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" style="font-size: 1.5rem; color: var(--visma-coral)">{result.errors}</div>
              <div class="stat-label">Errors</div>
            </div>
          </div>
        </div>
      ),
      summary: `Embedded ${result.embedded}/${result.processed} notebook entries`,
    };
  } catch (err: any) {
    return {
      html: <div class="card"><div class="text-sm" style="color: var(--visma-coral)">Notebook embedding error: {err.message}</div></div>,
      summary: `Notebook embedding failed: ${err.message}`,
    };
  }
};

export const handleEmbeddingStats: IntentHandler = async () => {
  const stats = await getEmbeddingStats();
  return {
    html: <EmbeddingStatsCard stats={stats} />,
    summary: `Embedding stats: ${stats.totalChunks} chunks across ${stats.totalSources} sources`,
  };
};

export const handleNotebook: IntentHandler = async () => {
  const notes = await listNotes();
  return {
    html: <NotebookListCard notes={notes} />,
    summary: `Notebook: ${notes.length} notes`,
  };
};

export const handleBackup: IntentHandler = async () => {
  try {
    const local = await createLocalBackup();
    let gcsInfo = "";
    try {
      const gcs = await uploadToGCS(local.path);
      gcsInfo = ` + uploaded to gs://${gcs.bucket}/${gcs.object}`;
    } catch {
      gcsInfo = " (GCS upload skipped — no gcloud auth)";
    }
    return {
      html: (
        <div class="card">
          <div class="card-label mb-xs" style="color: var(--visma-turquoise)">Backup Complete</div>
          <div class="text-sm">Local backup: {local.sizeKB} KB{gcsInfo}</div>
        </div>
      ),
      summary: `Backup created (${local.sizeKB} KB)${gcsInfo}`,
    };
  } catch (err: any) {
    return {
      html: <div class="card"><div class="text-sm" style="color: var(--visma-coral)">Backup failed: {err.message}</div></div>,
      summary: `Backup failed: ${err.message}`,
    };
  }
};
