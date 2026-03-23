import type { NotebookEntry } from "../../types/index.ts";
import { relativeDate } from "./helpers.tsx";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "...";
}

export function NotebookListCard({ notes, query }: { notes: NotebookEntry[]; query?: string }) {
  return (
    <div class="card">
      <div class="card-label mb-xs" style="display: flex; align-items: center; justify-content: space-between">
        <span>Notebook ({notes.length})</span>
        <button class="btn btn-sm" hx-get="/notebook/new" hx-target="#canvas" hx-swap="innerHTML">+ New Note</button>
      </div>

      {query && <div class="text-xs text-muted mb-sm">Showing results for "{query}"</div>}

      <form hx-get="/notebook" hx-target="#canvas" hx-swap="innerHTML" style="margin-bottom: 0.75rem">
        <input type="text" name="query" class="chat-input" placeholder="Search notes..." value={query || ""} style="font-size: 0.8rem; padding: 0.4rem 0.6rem" />
      </form>

      {notes.length === 0 && (
        <div class="text-sm text-muted" style="padding: 1rem 0; text-align: center">
          No notes yet. Start collecting knowledge.
        </div>
      )}

      {notes.map((note) => (
        <div class="table-row card-clickable" hx-get={`/notebook/${note.id}`} hx-target="#canvas" hx-swap="innerHTML">
          <div class="flex-1">
            <div style="display: flex; align-items: center; gap: 6px">
              {note.pinned && <span style="color: var(--visma-yellow); font-size: 0.7rem">&#9733;</span>}
              <span class="text-sm" style="font-weight: 600">{note.title}</span>
            </div>
            <div class="text-xs text-muted" style="margin-top: 2px; line-height: 1.4">
              {truncate(note.content, 120)}
            </div>
            <div class="text-xs text-muted" style="margin-top: 4px; display: flex; gap: 8px; align-items: center">
              <span>{relativeDate(note.updated_at)}</span>
              {note.url && <span style="color: var(--visma-turquoise)">&#128279; link</span>}
              {note.tags.length > 0 && note.tags.map((t) => (
                <span class="badge badge-turquoise" style="font-size: 0.6rem">{t}</span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function NotebookDetailCard({ note }: { note: NotebookEntry }) {
  return (
    <div class="card">
      <div class="card-label mb-xs" style="display: flex; align-items: center; justify-content: space-between">
        <div style="display: flex; align-items: center; gap: 8px">
          <button class="btn btn-sm" hx-get="/notebook" hx-target="#canvas" hx-swap="innerHTML">&larr; Back</button>
          <span>{note.pinned ? "&#9733; " : ""}{note.title}</span>
        </div>
        <div style="display: flex; gap: 4px">
          <button class="btn btn-sm" hx-post={`/notebook/${note.id}/pin`} hx-target="#canvas" hx-swap="innerHTML">
            {note.pinned ? "Unpin" : "Pin"}
          </button>
          <button class="btn btn-sm" hx-get={`/notebook/${note.id}/edit`} hx-target="#canvas" hx-swap="innerHTML">Edit</button>
          <button class="btn btn-sm" style="color: var(--visma-coral)" hx-delete={`/notebook/${note.id}`} hx-target="#canvas" hx-swap="innerHTML" hx-confirm="Delete this note?">Delete</button>
        </div>
      </div>

      {note.url && (
        <div class="text-xs mb-sm">
          <span class="text-muted">Source: </span>
          <a href={note.url} target="_blank" style="color: var(--visma-turquoise); text-decoration: none">{note.url}</a>
        </div>
      )}

      {note.tags.length > 0 && (
        <div class="mb-sm" style="display: flex; gap: 4px; flex-wrap: wrap">
          {note.tags.map((t) => <span class="badge badge-turquoise">{t}</span>)}
        </div>
      )}

      <div class="text-sm" style="white-space: pre-wrap; line-height: 1.7; color: var(--color-text-secondary)">
        {note.content}
      </div>

      <div class="text-xs text-muted" style="margin-top: 1rem; border-top: 1px solid var(--color-border); padding-top: 0.5rem">
        Created {relativeDate(note.created_at)} · Updated {relativeDate(note.updated_at)}
      </div>
    </div>
  );
}

export function NotebookFormCard({ note, isEdit }: { note?: NotebookEntry; isEdit?: boolean }) {
  return (
    <div class="card">
      <div class="card-label mb-xs" style="display: flex; align-items: center; gap: 8px">
        <button class="btn btn-sm" hx-get={isEdit ? `/notebook/${note!.id}` : "/notebook"} hx-target="#canvas" hx-swap="innerHTML">&larr; Cancel</button>
        <span>{isEdit ? "Edit Note" : "New Note"}</span>
      </div>

      <form hx-post={isEdit ? `/notebook/${note!.id}` : "/notebook"} hx-target="#canvas" hx-swap="innerHTML">
        <div style="margin-bottom: 0.75rem">
          <label class="text-xs text-muted" style="display: block; margin-bottom: 4px">Title</label>
          <input type="text" name="title" class="chat-input" placeholder="Note title..." value={note?.title || ""} required style="font-size: 0.85rem; padding: 0.5rem 0.6rem" />
        </div>

        <div style="margin-bottom: 0.75rem">
          <label class="text-xs text-muted" style="display: block; margin-bottom: 4px">Content</label>
          <textarea name="content" class="chat-input" placeholder="Write your note..." required style="font-size: 0.85rem; padding: 0.5rem 0.6rem; min-height: 200px; resize: vertical; font-family: var(--font-body); line-height: 1.6">{note?.content || ""}</textarea>
        </div>

        <div style="margin-bottom: 0.75rem">
          <label class="text-xs text-muted" style="display: block; margin-bottom: 4px">URL / Link (optional)</label>
          <input type="url" name="url" class="chat-input" placeholder="https://..." value={note?.url || ""} style="font-size: 0.85rem; padding: 0.5rem 0.6rem" />
        </div>

        <div style="margin-bottom: 1rem">
          <label class="text-xs text-muted" style="display: block; margin-bottom: 4px">Tags (comma-separated)</label>
          <input type="text" name="tags" class="chat-input" placeholder="ai, strategy, tools..." value={note?.tags.join(", ") || ""} style="font-size: 0.85rem; padding: 0.5rem 0.6rem" />
        </div>

        <button type="submit" class="btn" style="background: var(--visma-turquoise); color: white; padding: 0.5rem 1.5rem">
          {isEdit ? "Save Changes" : "Save Note"}
        </button>
      </form>
    </div>
  );
}
