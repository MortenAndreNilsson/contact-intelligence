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
import { updateCompany, getCompany } from "../../services/companies.ts";
import { queryAll } from "../../db/client.ts";
import type { FilterCriteria } from "../../types/index.ts";
import { parseListFilter, generateListDescription } from "../../services/local-llm.ts";

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

// POST /lists/parse-filter — NL-to-filter parsing (G3)
app.post("/lists/parse-filter", async (c) => {
  const body = await c.req.parseBody();
  const input = String(body.nl_input || "").trim();

  if (!input) {
    return c.html(
      <div id="filter-fields">
        <div class="text-sm" style="color: var(--visma-coral)">Please enter a description.</div>
      </div>
    );
  }

  const criteria = await parseListFilter(input);
  if (!criteria) {
    return c.html(
      <div id="filter-fields">
        <div class="text-sm" style="color: var(--visma-coral)">Could not parse filters. LM Studio may be unavailable.</div>
      </div>
    );
  }

  // Return the filter fields pre-populated with parsed values
  return c.html(
    <div id="filter-fields">
      <div class="card-label mb-xs">Filter Criteria (parsed from NL)</div>
      <div class="text-xs mb-sm" style="color: var(--visma-turquoise)">{generateListDescription(criteria)}</div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-xs); margin-bottom: var(--space-xs)">
        <div>
          <div class="text-xs text-muted mb-xs">Industry contains</div>
          <input type="text" name="filter_industry" class="chat-input" value={criteria.industry || ""}
            placeholder="e.g. SaaS" style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
        </div>
        <div>
          <div class="text-xs text-muted mb-xs">Country contains</div>
          <input type="text" name="filter_country" class="chat-input" value={criteria.country || ""}
            placeholder="e.g. Norway" style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-xs); margin-bottom: var(--space-xs)">
        <div>
          <div class="text-xs text-muted mb-xs">Has tag</div>
          <input type="text" name="filter_tag" class="chat-input" value={criteria.tag || ""}
            placeholder="e.g. priority" style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
        </div>
        <div>
          <div class="text-xs text-muted mb-xs">Min engagement score</div>
          <input type="number" name="filter_min_engagement" class="chat-input"
            value={criteria.min_engagement ? String(criteria.min_engagement) : ""}
            placeholder="e.g. 10" min="0" style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
        </div>
      </div>
      <div style="margin-bottom: var(--space-xs)">
        <label class="flex items-center gap-xs text-sm" style="cursor: pointer">
          <input type="checkbox" name="filter_has_survey" value="true"
            checked={criteria.has_survey || false}
            style="accent-color: var(--visma-turquoise)" />
          <span>Has completed a survey</span>
        </label>
      </div>

      <div class="card-label mb-xs mt-sm" style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted)">Behavior Filters</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-xs); margin-bottom: var(--space-xs)">
        <div>
          <div class="text-xs text-muted mb-xs">Read section</div>
          <select name="filter_read_section" class="chat-input"
            style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem">
            <option value="">Any</option>
            <option value="explore" selected={criteria.read_section === "explore"}>Explore</option>
            <option value="learn" selected={criteria.read_section === "learn"}>Learn</option>
            <option value="blog" selected={criteria.read_section === "blog"}>Blog</option>
          </select>
        </div>
        <div>
          <div class="text-xs text-muted mb-xs">Completed survey (slug)</div>
          <input type="text" name="filter_completed_survey" class="chat-input"
            value={criteria.completed_survey || ""} placeholder="e.g. ai-maturity"
            style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-xs); margin-bottom: var(--space-sm)">
        <div>
          <div class="text-xs text-muted mb-xs">Min score</div>
          <input type="number" name="filter_min_score" class="chat-input"
            value={criteria.min_score ? String(criteria.min_score) : ""}
            placeholder="e.g. 3" min="1" max="5" step="0.1"
            style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
        </div>
        <div>
          <div class="text-xs text-muted mb-xs">Max score</div>
          <input type="number" name="filter_max_score" class="chat-input"
            value={criteria.max_score ? String(criteria.max_score) : ""}
            placeholder="e.g. 2.5" min="1" max="5" step="0.1"
            style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
        </div>
        <div>
          <div class="text-xs text-muted mb-xs">Active in last N days</div>
          <input type="number" name="filter_active_days" class="chat-input"
            value={criteria.active_days ? String(criteria.active_days) : ""}
            placeholder="e.g. 30" min="1"
            style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
        </div>
      </div>
    </div>
  );
});

// POST /lists — create a new list
app.post("/lists", async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name || "").trim();
  let description = String(body.description || "").trim() || undefined;
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

    // Behavior-based filters (G3)
    const readSection = String(body.filter_read_section || "").trim();
    const completedSurvey = String(body.filter_completed_survey || "").trim();
    const minScore = Number(body.filter_min_score) || 0;
    const maxScore = Number(body.filter_max_score) || 0;
    const activeDays = Number(body.filter_active_days) || 0;

    if (readSection) filterCriteria.read_section = readSection;
    if (completedSurvey) filterCriteria.completed_survey = completedSurvey;
    if (minScore > 0) filterCriteria.min_score = minScore;
    if (maxScore > 0) filterCriteria.max_score = maxScore;
    if (activeDays > 0) filterCriteria.active_days = activeDays;

    // Need at least one filter for a smart list
    if (Object.keys(filterCriteria).length === 0) {
      return c.html(<div class="card"><div class="text-sm" style="color: var(--visma-coral)">Smart lists need at least one filter criterion.</div></div>, 400);
    }

    // Auto-generate description if not provided
    if (!description) {
      description = generateListDescription(filterCriteria);
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
      const result = await researchCompany(name);
      const rows = await queryAll<{ id: string }>(
        `SELECT id FROM companies WHERE name ILIKE $name LIMIT 1`,
        { $name: `%${name}%` }
      );
      if (rows.length > 0 && result) {
        const company = await getCompany(rows[0]!.id);
        const fields: Record<string, unknown> = {};
        if (result.description) fields.description = result.description;
        if (result.industry && !company?.industry) fields.industry = result.industry;
        if (result.country && !company?.country) fields.country = result.country;
        if (result.size_bucket && !company?.size_bucket) fields.size_bucket = result.size_bucket;
        if (result.tags.length > 0) {
          const existing = company?.tags || [];
          const merged = [...new Set([...existing, ...result.tags])];
          fields.tags = merged;
        }
        if (Object.keys(fields).length > 0) {
          await updateCompany(rows[0]!.id, fields);
        }
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
