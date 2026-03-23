import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { NotebookListCard, NotebookDetailCard, NotebookFormCard } from "../cards/notebook-card.tsx";
import { createNote, getNote, listNotes, updateNote, deleteNote, togglePin, importPdf } from "../../services/notebook.ts";

const app = new Hono();

// ========== GET /notebook — list ==========
app.get("/notebook", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const query = c.req.query("query") || undefined;
  const notes = await listNotes({ query });
  const content = <NotebookListCard notes={notes} query={query} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// ========== GET /notebook/new — create form ==========
app.get("/notebook/new", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const content = <NotebookFormCard />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// ========== POST /notebook — create ==========
app.post("/notebook", async (c) => {
  const body = await c.req.parseBody();
  const title = String(body.title || "").trim();
  const content = String(body.content || "").trim();
  const url = String(body.url || "").trim() || undefined;
  const tagsRaw = String(body.tags || "").trim();
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) : [];

  if (!title || !content) {
    return c.html(<NotebookFormCard />);
  }

  const note = await createNote({ title, content, url, tags });
  return c.html(<NotebookDetailCard note={note} />);
});

// ========== POST /notebook/upload-pdf — import PDF ==========
app.post("/notebook/upload-pdf", async (c) => {
  const body = await c.req.parseBody();
  const file = body.pdf;
  if (!file || !(file instanceof File) || !file.name.endsWith(".pdf")) {
    const notes = await listNotes();
    return c.html(
      <div>
        <div class="card" style="margin-bottom: 0.5rem">
          <div class="text-sm" style="color: var(--visma-coral)">Please select a PDF file.</div>
        </div>
        <NotebookListCard notes={notes} />
      </div>
    );
  }

  try {
    const note = await importPdf(file);
    return c.html(<NotebookDetailCard note={note} />);
  } catch (err: any) {
    const notes = await listNotes();
    return c.html(
      <div>
        <div class="card" style="margin-bottom: 0.5rem">
          <div class="text-sm" style="color: var(--visma-coral)">PDF import failed: {err.message}</div>
        </div>
        <NotebookListCard notes={notes} />
      </div>
    );
  }
});

// ========== GET /notebook/:id — detail ==========
app.get("/notebook/:id", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const note = await getNote(c.req.param("id"));
  if (!note) {
    const notes = await listNotes();
    return c.html(<NotebookListCard notes={notes} />);
  }
  const content = <NotebookDetailCard note={note} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// ========== GET /notebook/:id/edit — edit form ==========
app.get("/notebook/:id/edit", async (c) => {
  const note = await getNote(c.req.param("id"));
  if (!note) {
    const notes = await listNotes();
    return c.html(<NotebookListCard notes={notes} />);
  }
  return c.html(<NotebookFormCard note={note} isEdit />);
});

// ========== POST /notebook/:id — update ==========
app.post("/notebook/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const title = String(body.title || "").trim();
  const content = String(body.content || "").trim();
  const url = String(body.url || "").trim() || undefined;
  const tagsRaw = String(body.tags || "").trim();
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) : [];

  await updateNote(id, { title: title || undefined, content: content || undefined, url, tags });
  const note = await getNote(id);
  if (!note) {
    const notes = await listNotes();
    return c.html(<NotebookListCard notes={notes} />);
  }
  return c.html(<NotebookDetailCard note={note} />);
});

// ========== POST /notebook/:id/pin — toggle pin ==========
app.post("/notebook/:id/pin", async (c) => {
  await togglePin(c.req.param("id"));
  const note = await getNote(c.req.param("id"));
  if (!note) {
    const notes = await listNotes();
    return c.html(<NotebookListCard notes={notes} />);
  }
  return c.html(<NotebookDetailCard note={note} />);
});

// ========== DELETE /notebook/:id — delete ==========
app.delete("/notebook/:id", async (c) => {
  await deleteNote(c.req.param("id"));
  const notes = await listNotes();
  return c.html(<NotebookListCard notes={notes} />);
});

export default app;
