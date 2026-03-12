# G3: Behavior-Based Smart Lists + G4: Entity Briefings

Design spec for Contact Intelligence features G3 and G4.

---

## G3: Behavior-Based Smart Lists with NL Input

### Problem

Current smart list filters only support company attributes (industry, country, tag, engagement threshold, has_survey). The real value is filtering by behavior: what people read, which surveys they completed, how they scored. The form-based filter UI also requires knowing the exact field names.

### New FilterCriteria fields

Add 5 behavior-based fields to the existing `FilterCriteria` type. All optional, AND-combined with existing fields.

| Field | Type | Example NL | SQL logic |
|-------|------|-----------|-----------|
| `read_section` | `string` | "people who read Explore articles" | `EXISTS (activity WHERE type='article_view' AND detail.section ILIKE ...)` |
| `completed_survey` | `string` | "people who did AI Pulse" | `EXISTS (survey_responses WHERE email=ct.email AND slug ILIKE ...)` |
| `min_score` | `number` | "scored above 3" | `EXISTS (survey_responses WHERE email=ct.email AND overallScore >= N)` |
| `max_score` | `number` | "scored below 2.5" | `EXISTS (survey_responses WHERE email=ct.email AND overallScore <= N)` |
| `active_days` | `number` | "active in last 30 days" | `EXISTS (activity WHERE contact_id=ct.id AND occurred_at >= now - N days)` |

### NL-to-filter parsing

New function `parseListFilter(input: string)` in `local-llm.ts` with a dedicated system prompt (separate from the chat intent classifier). Returns a `FilterCriteria` object or null if LM Studio unavailable.

The system prompt knows:
- All 10 filter fields (5 existing + 5 new)
- Available article sections (explore, learn, blog)
- That survey slugs are kebab-case strings
- Score range is 1-5

### Auto-generated list description

When a smart list is created or updated, call LM Studio (or simple template logic) to generate a human-readable description from the filter criteria. Example: "Contacts in the software industry who read Explore articles and scored above 3.0 on surveys". Stored in the list's `description` field. Makes lists browsable without opening each one.

Fallback: if LM Studio unavailable, build a simple template string from the criteria fields.

### UI changes to list creation form

Add to the smart list section of `list-create-card.tsx`:

1. **NL text input** at the top: "Describe your list in plain English"
   - On form submit with NL text, calls `POST /lists/parse-filter`
   - Response populates the filter form fields for review
   - User can adjust before saving

2. **New form fields** below existing ones:
   - "Read section" — dropdown (Explore / Learn / Blog / Any)
   - "Completed survey" — text input (survey slug)
   - "Min score" — number input
   - "Max score" — number input
   - "Active in last N days" — number input

### Routes

- `POST /lists/parse-filter` — accepts `{ input: string }`, returns `FilterCriteria` JSON
- `POST /lists` — extended to handle new form fields

### Files changed

| File | Change |
|------|--------|
| `src/types/index.ts` | Extend FilterCriteria with 5 new fields |
| `src/services/lists.ts` | New SQL clauses in getSmartListMembers() |
| `src/services/local-llm.ts` | New parseListFilter() function with dedicated prompt |
| `src/web/cards/list-create-card.tsx` | NL text input + new form fields for behavior filters |
| `src/web/routes/lists.tsx` | New POST /lists/parse-filter + handle new fields in POST /lists |

### Skipped (by design)

- OR logic between filter groups — overkill for our scale
- Negation filters ("has NOT done X") — adds SQL complexity, low usage
- Per-filter recency ("read Explore in last 30 days") — global `active_days` is enough
- `read_article` by specific slug — section-level covers 80% of use cases

---

## G4: Entity Briefings

### Problem

Company and contact profiles show raw activity timelines. When preparing for a meeting or sharing context with colleagues, you need a narrative: what's the story with this company, what are they interested in, how engaged are they.

### Two tiers

#### Inline summary (always visible, lightweight)

New function `summarizeActivities(activities, context)` in `local-llm.ts`.

- Input: last 10-15 activities + context (company/contact name)
- System prompt: "Summarize this CRM activity into 1-2 factual sentences. No hype."
- Rendered as subtle text block at top of company/contact profile cards, above activity tabs
- Cached by activity hash (re-summarize only when activities change)
- If LM Studio unavailable: section hidden (graceful degradation)

#### Full briefing (on-demand, shareable)

"Get Briefing" button on company/contact profiles. Gathers richer data:

- All activities (not just last 10)
- Survey scores and dimension breakdowns
- Content reading patterns (which sections, frequency)
- Contact list (for companies)
- Company metadata (industry, size, country)

LM Studio gets a longer prompt with all context, returns a structured briefing:
- **Engagement summary** — 1-2 sentences on overall engagement level and trend
- **Content interests** — what they've been reading, which topics
- **Survey insights** — scores, maturity level, strengths/gaps (if applicable)
- **Key contacts** — who's most active (for company briefings)
- **Recommendation** — suggested next action

Rendered in a dedicated briefing card with copy-to-clipboard button.

### Fallback

- Inline summary: hidden when LM Studio down
- Briefing button: shows "LM Studio unavailable" tooltip, disabled state

### Routes

- `POST /companies/:id/briefing` — generates full company briefing
- `POST /contacts/:id/briefing` — generates full contact briefing

### Files changed

| File | Change |
|------|--------|
| `src/services/local-llm.ts` | New summarizeActivities() and generateBriefing() functions |
| `src/web/cards/company-profile.tsx` | Inline summary block + "Get Briefing" button |
| `src/web/cards/contact-profile.tsx` | Inline summary block + "Get Briefing" button |
| `src/web/cards/briefing-card.tsx` | **New** — full briefing display with copy button |
| `src/web/routes/companies.tsx` | New POST /:id/briefing route |
| `src/web/routes/contacts.tsx` | New POST /:id/briefing route |

---

## Implementation order

1. **G3 first** — extend FilterCriteria, update SQL, add form fields, add NL parsing, auto-description
2. **G4 inline summaries** — add summarizeActivities(), wire into profile cards
3. **G4 full briefings** — add generateBriefing(), briefing card, routes

G3 and G4 are independent but this order lets us validate LM Studio structured output (G3) before tackling free-form generation (G4).

---

## Future roadmap items noted during design

- **Chat dispatch refactor** — the intent classifier in local-llm.ts has 18+ intents and growing. Needs review: possibly split into category routers, or add a "create_list" chat intent that delegates to the NL filter parser.
- **OR filter groups** — if users need "X OR Y" filtering
- **Per-filter recency** — "read Explore in last 30 days" vs global active_days
