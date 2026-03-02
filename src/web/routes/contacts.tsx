import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { ContactProfileCard } from "../cards/contact-profile.tsx";
import { listContacts, getContact, getContactByEmail } from "../../services/contacts.ts";
import { listActivities } from "../../services/activities.ts";
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

  try {
    const result = await enrichSingleContact(id, contact.email);
    if (result.success) {
      console.log(`Enriched ${contact.email}: ${result.info?.name} @ ${result.info?.organization}`);
    } else {
      console.log(`No info found for ${contact.email}`);
    }
  } catch (err: any) {
    console.error(`Enrich failed for ${contact.email}:`, err.message);
  }

  // Re-fetch and render the updated profile
  const updated = await getContact(id);
  if (!updated) {
    const msg = <div class="card"><div class="text-sm text-muted">Contact not found after enrichment.</div></div>;
    if (isHtmx) return c.html(msg);
    return c.html(<Layout>{msg}</Layout>);
  }

  const activities = await listActivities({ contactId: id, limit: 20 });
  const content = <ContactProfileCard contact={updated} activities={activities} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
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
