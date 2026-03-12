export function ListCreateCard() {
  return (
    <div>
      <div class="card">
        <div class="flex items-center gap-xs mb-sm">
          <span
            class="text-sm card-clickable"
            style="color: var(--color-accent)"
            hx-get="/lists"
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            Lists
          </span>
          <span class="text-xs text-muted">/</span>
          <span class="text-sm text-secondary">New List</span>
        </div>
        <div class="card-title">Create a New List</div>
      </div>

      <div class="card" x-data="{ listType: 'manual' }">
        <form hx-post="/lists" hx-target="#canvas" hx-swap="innerHTML">
          <div style="margin-bottom: var(--space-sm)">
            <div class="card-label mb-xs">Name</div>
            <input
              type="text"
              name="name"
              class="chat-input"
              placeholder="e.g. Key Accounts, Survey Completers..."
              required
              style="width: 100%; font-size: 0.9rem"
            />
          </div>

          <div style="margin-bottom: var(--space-sm)">
            <div class="card-label mb-xs">Description (optional)</div>
            <input
              type="text"
              name="description"
              class="chat-input"
              placeholder="What is this list for?"
              style="width: 100%; font-size: 0.9rem"
            />
          </div>

          <div style="margin-bottom: var(--space-sm)">
            <div class="card-label mb-xs">Type</div>
            <div class="flex gap-xs">
              <button
                type="button"
                class="period-btn"
                x-bind:class="{ 'period-btn-active': listType === 'manual' }"
                x-on:click="listType = 'manual'"
              >
                Manual
              </button>
              <button
                type="button"
                class="period-btn"
                x-bind:class="{ 'period-btn-active': listType === 'smart' }"
                x-on:click="listType = 'smart'"
              >
                Smart (filter-based)
              </button>
            </div>
            <input type="hidden" name="list_type" x-bind:value="listType" />
          </div>

          {/* Smart list filter fields */}
          <div x-show="listType === 'smart'" x-cloak>
            {/* NL input for smart filter */}
            <div style="margin-bottom: var(--space-sm); margin-top: var(--space-sm)">
              <div class="card-label mb-xs">Describe your list in plain English</div>
              <div class="flex gap-xs">
                <input
                  type="text"
                  name="nl_input"
                  class="chat-input"
                  placeholder='e.g. "people who read Explore articles and scored above 3"'
                  style="flex: 1; font-size: 0.85rem; padding: 0.4rem 0.6rem"
                />
                <button
                  type="button"
                  class="period-btn"
                  hx-post="/lists/parse-filter"
                  hx-include="[name='nl_input']"
                  hx-target="#filter-fields"
                  hx-swap="outerHTML"
                  style="white-space: nowrap; font-size: 0.8rem"
                >
                  Parse
                </button>
              </div>
              <div class="text-xs text-muted" style="margin-top: 0.25rem">Populates the filter fields below for review. Needs LM Studio.</div>
            </div>

            <div id="filter-fields">
              <div class="card-label mb-xs">Filter Criteria</div>
              <div class="text-xs text-muted mb-sm">Contacts matching ALL criteria will be auto-included.</div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-xs); margin-bottom: var(--space-xs)">
                <div>
                  <div class="text-xs text-muted mb-xs">Industry contains</div>
                  <input type="text" name="filter_industry" class="chat-input" placeholder="e.g. SaaS"
                    style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
                </div>
                <div>
                  <div class="text-xs text-muted mb-xs">Country contains</div>
                  <input type="text" name="filter_country" class="chat-input" placeholder="e.g. Norway"
                    style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-xs); margin-bottom: var(--space-xs)">
                <div>
                  <div class="text-xs text-muted mb-xs">Has tag</div>
                  <input type="text" name="filter_tag" class="chat-input" placeholder="e.g. priority"
                    style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
                </div>
                <div>
                  <div class="text-xs text-muted mb-xs">Min engagement score</div>
                  <input type="number" name="filter_min_engagement" class="chat-input" placeholder="e.g. 10"
                    min="0" style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
                </div>
              </div>
              <div style="margin-bottom: var(--space-xs)">
                <label class="flex items-center gap-xs text-sm" style="cursor: pointer">
                  <input type="checkbox" name="filter_has_survey" value="true" style="accent-color: var(--visma-turquoise)" />
                  <span>Has completed a survey</span>
                </label>
              </div>

              {/* Behavior-based filters */}
              <div class="card-label mb-xs mt-sm" style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted)">Behavior Filters</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-xs); margin-bottom: var(--space-xs)">
                <div>
                  <div class="text-xs text-muted mb-xs">Read section</div>
                  <select name="filter_read_section" class="chat-input"
                    style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem">
                    <option value="">Any</option>
                    <option value="explore">Explore</option>
                    <option value="learn">Learn</option>
                    <option value="blog">Blog</option>
                  </select>
                </div>
                <div>
                  <div class="text-xs text-muted mb-xs">Completed survey (slug)</div>
                  <input type="text" name="filter_completed_survey" class="chat-input" placeholder="e.g. ai-maturity"
                    style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-xs); margin-bottom: var(--space-sm)">
                <div>
                  <div class="text-xs text-muted mb-xs">Min score</div>
                  <input type="number" name="filter_min_score" class="chat-input" placeholder="e.g. 3"
                    min="1" max="5" step="0.1" style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
                </div>
                <div>
                  <div class="text-xs text-muted mb-xs">Max score</div>
                  <input type="number" name="filter_max_score" class="chat-input" placeholder="e.g. 2.5"
                    min="1" max="5" step="0.1" style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
                </div>
                <div>
                  <div class="text-xs text-muted mb-xs">Active in last N days</div>
                  <input type="number" name="filter_active_days" class="chat-input" placeholder="e.g. 30"
                    min="1" style="width: 100%; font-size: 0.85rem; padding: 0.4rem 0.6rem" />
                </div>
              </div>
            </div>
          </div>

          <button type="submit" class="chat-submit mt-sm" style="width: 100%">
            Create List
          </button>
        </form>
      </div>
    </div>
  );
}
