import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { ListsCard } from "../cards/lists-card.tsx";
import { ListDetailCard } from "../cards/list-detail-card.tsx";
import { ListCreateCard } from "../cards/list-create-card.tsx";
import {
  createList,
  getList,
  listLists,
  addToList,
  removeFromList,
  deleteList,
  getEffectiveMembers,
} from "../../services/lists.ts";
import { listContacts, getContactByEmail } from "../../services/contacts.ts";
import { enrichContacts } from "../../services/enrich-contacts.ts";
import { researchCompany } from "../../services/company-research.ts";
import { updateCompany } from "../../services/companies.ts";
import { queryAll } from "../../db/client.ts";
import type { FilterCriteria } from "../../types/index.ts";

const app = new Hono();

// GET /lists — list all lists
app.get("/lists", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const lists = await listLists();
  const content = <ListsCard lists={lists} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// GET /lists/new — create list form
app.get("/lists/new", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const content = <ListCreateCard />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// POST /lists — create a new list
app.post("/lists", async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim() || undefined;
  const listType = body.list_type === "smart" ? "smart" as const : "manual" as const;

  if (!name) {
    return c.html(<div class="card"><div class="text-sm" style="color: var(--visma-coral)">Name is required.</div></div>, 400);
  }

  let filterCriteria: FilterCriteria | undefined;
  if (listType === "smart") {
    filterCriteria = {};
    const industry = String(body.filter_industry || "").trim();
    const country = String(body.filter_country || "").trim();
    const tag = String(body.filter_tag || "").trim();
    const minEngagement = Number(body.filter_min_engagement) || 0;
    const hasSurvey = body.filter_has_survey === "true";

    if (industry) filterCriteria.industry = industry;
    if (country) filterCriteria.country = country;
    if (tag) filterCriteria.tag = tag;
    if (minEngagement > 0) filterCriteria.min_engagement = minEngagement;
    if (hasSurvey) filterCriteria.has_survey = true;

    // Need at least one filter for a smart list
    if (Object.keys(filterCriteria).length === 0) {
      return c.html(<div class="card"><div class="text-sm" style="color: var(--visma-coral)">Smart lists need at least one filter criterion.</div></div>, 400);
    }
  }

  const list = await createList(name, listType, description, filterCriteria);
  const full = await getList(list.id);
  const members = await getEffectiveMembers(full!);
  return c.html(<ListDetailCard list={full!} members={members} />);
});

// GET /lists/:id — show list detail
app.get("/lists/:id", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const id = c.req.param("id");
  const list = await getList(id);

  if (!list) {
    const msg = <div class="card"><div class="text-sm text-muted">List not found.</div></div>;
    if (isHtmx) return c.html(msg);
    return c.html(<Layout>{msg}</Layout>);
  }

  const members = await getEffectiveMembers(list);
  const content = <ListDetailCard list={list} members={members} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// POST /lists/:id/add — add a contact to a manual list (search by name/email)
app.post("/lists/:id/add", async (c) => {
  const listId = c.req.param("id");
  const body = await c.req.parseBody();
  const query = String(body.query || "").trim();

  const list = await getList(listId);
  if (!list) {
    return c.html(<div class="card"><div class="text-sm text-muted">List not found.</div></div>, 404);
  }

  if (!query) {
    const members = await getEffectiveMembers(list);
    return c.html(<ListDetailCard list={list} members={members} />);
  }

  // Try email match first
  if (query.includes("@")) {
    const contact = await getContactByEmail(query);
    if (contact) {
      await addToList(listId, contact.id);
      const updated = await getList(listId);
      const members = await getEffectiveMembers(updated!);
      return c.html(<ListDetailCard list={updated!} members={members} />);
    }
  }

  // Search by name
  const contacts = await listContacts({ query, limit: 10 });
  if (contacts.length === 1) {
    await addToList(listId, contacts[0]!.id);
    const updated = await getList(listId);
    const members = await getEffectiveMembers(updated!);
    return c.html(<ListDetailCard list={updated!} members={members} />);
  }

  if (contacts.length > 1) {
    // Show disambiguation — pick-to-add
    const members = await getEffectiveMembers(list);
    return c.html(
      <div>
        <div class="card">
          <div class="card-label mb-xs">Multiple matches for "{query}" — pick one:</div>
          {contacts.map((ct) => (
            <div
              class="table-row card-clickable"
              hx-post={`/lists/${listId}/add`}
              hx-target="#canvas"
              hx-swap="innerHTML"
              hx-vals={JSON.stringify({ query: ct.email })}
            >
              <div class="flex-1">
                <div style="font-weight: 600">{ct.name || ct.email}</div>
                <div class="text-xs text-muted">
                  {[ct.job_title, ct.company_name, ct.email].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
          ))}
        </div>
        <ListDetailCard list={list} members={members} />
      </div>
    );
  }

  // No match
  const members = await getEffectiveMembers(list);
  return c.html(
    <div>
      <div class="card"><div class="text-sm" style="color: var(--visma-coral)">No contact found matching "{query}".</div></div>
      <ListDetailCard list={list} members={members} />
    </div>
  );
});

// DELETE /lists/:id/members/:contactId — remove contact from list
app.delete("/lists/:id/members/:contactId", async (c) => {
  const listId = c.req.param("id");
  const contactId = c.req.param("contactId");

  await removeFromList(listId, contactId);
  const list = await getList(listId);
  if (!list) {
    return c.html(<div class="card"><div class="text-sm text-muted">List not found.</div></div>, 404);
  }
  const members = await getEffectiveMembers(list);
  return c.html(<ListDetailCard list={list} members={members} />);
});

// DELETE /lists/:id — delete a list
app.delete("/lists/:id", async (c) => {
  const id = c.req.param("id");
  await deleteList(id);
  const lists = await listLists();
  return c.html(<ListsCard lists={lists} />);
});

// POST /lists/:id/enrich — bulk enrich all contacts in the list
app.post("/lists/:id/enrich", async (c) => {
  const listId = c.req.param("id");
  const list = await getList(listId);
  if (!list) {
    return c.html(<div class="card"><div class="text-sm text-muted">List not found.</div></div>, 404);
  }

  try {
    const result = await enrichContacts();
    const members = await getEffectiveMembers(list);
    return c.html(
      <div>
        <div class="card">
          <div class="card-label mb-xs">Enrichment Complete</div>
          <div class="text-sm text-secondary">
            Processed {result.processed} contacts — {result.enriched} enriched, {result.failed} not found, {result.companiesCreated} new companies.
          </div>
        </div>
        <ListDetailCard list={list} members={members} />
      </div>
    );
  } catch (err: any) {
    const members = await getEffectiveMembers(list);
    return c.html(
      <div>
        <div class="card"><div class="text-sm" style="color: var(--visma-coral)">{err.message}</div></div>
        <ListDetailCard list={list} members={members} />
      </div>
    );
  }
});

// POST /lists/:id/research — bulk research all companies of list members
app.post("/lists/:id/research", async (c) => {
  const listId = c.req.param("id");
  const list = await getList(listId);
  if (!list) {
    return c.html(<div class="card"><div class="text-sm text-muted">List not found.</div></div>, 404);
  }

  const members = await getEffectiveMembers(list);

  // Collect unique companies from members
  const companyNames = new Set<string>();
  const companyMap = new Map<string, string>(); // name → possible company ID
  for (const m of members) {
    if (m.company_name && !companyNames.has(m.company_name)) {
      companyNames.add(m.company_name);
    }
  }

  let researched = 0;
  let failed = 0;

  for (const name of companyNames) {
    try {
      const description = await researchCompany(name);
      const rows = await queryAll<{ id: string }>(
        `SELECT id FROM companies WHERE name ILIKE $name LIMIT 1`,
        { $name: `%${name}%` }
      );
      if (rows.length > 0 && description) {
        await updateCompany(rows[0]!.id, { description });
        researched++;
      }
    } catch {
      failed++;
    }
  }

  const updatedMembers = await getEffectiveMembers(list);
  return c.html(
    <div>
      <div class="card">
        <div class="card-label mb-xs">Research Complete</div>
        <div class="text-sm text-secondary">
          Researched {researched} companies{failed > 0 ? `, ${failed} failed` : ""}.
        </div>
      </div>
      <ListDetailCard list={list} members={updatedMembers} />
    </div>
  );
});

// GET /lists/:id/export.csv — export list members as CSV
app.get("/lists/:id/export.csv", async (c) => {
  const listId = c.req.param("id");
  const list = await getList(listId);
  if (!list) {
    return c.text("List not found", 404);
  }

  const members = await getEffectiveMembers(list);

  const headers = ["email", "name", "job_title", "company", "activity_count", "engagement_score"];
  const rows = members.map((m) => [
    m.contact_email,
    m.contact_name || "",
    m.job_title || "",
    m.company_name || "",
    String(m.activity_count),
    String(m.engagement_score),
  ]);

  const csv = [
    headers.join(","),
    ...rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")),
  ].join("\n");

  const filename = `${list.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-").toLowerCase()}.csv`;
  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(csv);
});

export default app;
