import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { ContactProfileCard } from "../cards/contact-profile.tsx";
import { listContacts, getContact, getContactByEmail, updateContact } from "../../services/contacts.ts";
import { listActivities, createActivity } from "../../services/activities.ts";
import { enrichSingleContact } from "../../services/enrich-contacts.ts";
import type { ContactWithDetails } from "../../types/index.ts";

const app = new Hono();

function ContactListCard({ contacts }: { contacts: ContactWithDetails[] }) {
  if (contacts.length === 0) {
    return (
      <div class="empty-state">
        <div class="empty-state-icon">◇</div>
        <div>No contacts found.</div>
      </div>
    );
  }

  return (
    <div class="card">
      <div class="card-label mb-xs">Contacts ({contacts.length})</div>
      {contacts.map((ct) => (
        <div
          class="table-row card-clickable"
          hx-get={`/contacts/${ct.id}`}
          hx-target="#canvas"
          hx-swap="innerHTML"
        >
          <div class="flex-1">
            <div style="font-weight: 600">{ct.name || ct.email}</div>
            <div class="text-xs text-muted">
              {[ct.job_title, ct.company_name, ct.email].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div class="text-xs text-muted font-mono">{ct.activity_count} activities</div>
        </div>
      ))}
    </div>
  );
}

app.get("/contacts", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const query = c.req.query("q");
  const companyId = c.req.query("company");
  const contacts = await listContacts({ query: query ?? undefined, companyId: companyId ?? undefined });
  const content = <ContactListCard contacts={contacts} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

app.get("/contacts/by-email/:email", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const email = decodeURIComponent(c.req.param("email"));
  const contact = await getContactByEmail(email);

  if (!contact) {
    const msg = <div class="card"><div class="text-sm text-muted">Contact not found for {email}.</div></div>;
    if (isHtmx) return c.html(msg);
    return c.html(<Layout>{msg}</Layout>);
  }

  const activities = await listActivities({ contactId: contact.id, limit: 20 });
  const content = <ContactProfileCard contact={contact} activities={activities} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// POST /contacts/:id/enrich — enrich a single contact via Discovery Engine
app.post("/contacts/:id/enrich", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const id = c.req.param("id");
  const contact = await getContact(id);

  if (!contact) {
    const msg = <div class="card"><div class="text-sm text-muted">Contact not found.</div></div>;
    if (isHtmx) return c.html(msg);
    return c.html(<Layout>{msg}</Layout>);
  }

  let feedbackHtml: any = null;
  try {
    const result = await enrichSingleContact(id, contact.email);
    if (result.success) {
      console.log(`Enriched ${contact.email}: ${result.info?.name} @ ${result.info?.organization}`);
      feedbackHtml = (
        <div class="card">
          <div class="card-label mb-xs" style="color: var(--visma-turquoise)">Enrichment Result</div>
          <div class="text-sm text-secondary">
            {result.info?.name && <div>Name: <strong>{result.info.name}</strong></div>}
            {result.info?.jobTitle && <div>Title: <strong>{result.info.jobTitle}</strong></div>}
            {result.info?.organization && <div>Organization: <strong>{result.info.organization}</strong>{result.companyCreated ? " (new)" : ""}</div>}
            {result.info?.country && <div>Country: {result.info.country}</div>}
            {!result.info?.name && !result.info?.jobTitle && !result.info?.organization && <div>No new data found.</div>}
          </div>
        </div>
      );
    } else {
      console.log(`No info found for ${contact.email}`);
      feedbackHtml = (
        <div class="card">
          <div class="text-sm text-muted">No information found for {contact.email} in Discovery Engine.</div>
        </div>
      );
    }
  } catch (err: any) {
    console.error(`Enrich failed for ${contact.email}:`, err.message);
    feedbackHtml = (
      <div class="card">
        <div class="text-sm" style="color: var(--visma-coral)">Enrichment failed: {err.message}</div>
      </div>
    );
  }

  // Re-fetch and render the updated profile
  const updated = await getContact(id);
  if (!updated) {
    const msg = <div class="card"><div class="text-sm text-muted">Contact not found after enrichment.</div></div>;
    if (isHtmx) return c.html(msg);
    return c.html(<Layout>{msg}</Layout>);
  }

  const activities = await listActivities({ contactId: id, limit: 20 });
  const content = (
    <div>
      {feedbackHtml}
      <ContactProfileCard contact={updated} activities={activities} />
    </div>
  );

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// PATCH /contacts/:id — update contact fields inline
app.patch("/contacts/:id", async (c) => {
  const id = c.req.param("id");
  const contact = await getContact(id);
  if (!contact) {
    return c.html(<div class="text-sm" style="color: var(--visma-coral)">Contact not found.</div>, 404);
  }

  const body = await c.req.parseBody();
  const fields: Record<string, unknown> = {};
  for (const key of ["job_title", "notes", "name", "company_id"]) {
    if (key in body) {
      fields[key] = String(body[key]).trim() || null;
    }
  }
  if ("tags" in body) {
    try {
      fields.tags = JSON.parse(String(body.tags));
    } catch {
      fields.tags = [];
    }
  }

  if (Object.keys(fields).length > 0) {
    await updateContact(id, fields);
  }

  const updated = await getContact(id);
  const activities = await listActivities({ contactId: id, limit: 20 });
  return c.html(<ContactProfileCard contact={updated!} activities={activities} />);
});

// POST /contacts/:id/note — add a note to a contact
app.post("/contacts/:id/note", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const note = String(body.note || "").trim();
  const contact = await getContact(id);

  if (!contact || !note) {
    const msg = <div class="card"><div class="text-sm text-muted">{!contact ? "Contact not found." : "Note cannot be empty."}</div></div>;
    return c.html(msg);
  }

  await createActivity(
    id,
    contact.company_id,
    "note_added",
    "web_ui",
    null,
    note,
    null,
    new Date().toISOString()
  );

  const updated = await getContact(id);
  const activities = await listActivities({ contactId: id, limit: 20 });
  return c.html(<ContactProfileCard contact={updated!} activities={activities} />);
});

app.get("/contacts/:id", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const id = c.req.param("id");
  const contact = await getContact(id);

  if (!contact) {
    const msg = <div class="card"><div class="text-sm text-muted">Contact not found.</div></div>;
    if (isHtmx) return c.html(msg);
    return c.html(<Layout>{msg}</Layout>);
  }

  const activities = await listActivities({ contactId: id, limit: 20 });
  const content = <ContactProfileCard contact={contact} activities={activities} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

export default app;
