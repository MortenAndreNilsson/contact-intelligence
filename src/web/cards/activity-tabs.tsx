import type { ActivityWithNames } from "../../types/index.ts";
import { ActivityTimeline } from "./activity-timeline.tsx";

const TAB_FILTERS: Record<string, string[]> = {
  articles: ["article_view", "page_view"],
  surveys: ["survey_completed"],
  notes: ["note_added"],
};

export function ActivityTabs({ activities }: { activities: ActivityWithNames[] }) {
  const articleActivities = activities.filter((a) => TAB_FILTERS.articles.includes(a.activity_type));
  const surveyActivities = activities.filter((a) => TAB_FILTERS.surveys.includes(a.activity_type));
  const noteActivities = activities.filter((a) => TAB_FILTERS.notes.includes(a.activity_type));

  return (
    <div class="card" x-data="{ tab: 'all' }">
      <div class="activity-tabs">
        <button
          class="activity-tab"
          x-bind:class="{ 'activity-tab-active': tab === 'all' }"
          x-on:click="tab = 'all'"
        >
          All <span class="tab-count">{activities.length}</span>
        </button>
        <button
          class="activity-tab"
          x-bind:class="{ 'activity-tab-active': tab === 'articles' }"
          x-on:click="tab = 'articles'"
        >
          Articles <span class="tab-count">{articleActivities.length}</span>
        </button>
        <button
          class="activity-tab"
          x-bind:class="{ 'activity-tab-active': tab === 'surveys' }"
          x-on:click="tab = 'surveys'"
        >
          Surveys <span class="tab-count">{surveyActivities.length}</span>
        </button>
        <button
          class="activity-tab"
          x-bind:class="{ 'activity-tab-active': tab === 'notes' }"
          x-on:click="tab = 'notes'"
        >
          Notes <span class="tab-count">{noteActivities.length}</span>
        </button>
      </div>

      <div x-show="tab === 'all'">
        <ActivityTimeline activities={activities} />
      </div>
      <div x-show="tab === 'articles'" x-cloak>
        <ActivityTimeline activities={articleActivities} />
      </div>
      <div x-show="tab === 'surveys'" x-cloak>
        <ActivityTimeline activities={surveyActivities} />
      </div>
      <div x-show="tab === 'notes'" x-cloak>
        <ActivityTimeline activities={noteActivities} />
      </div>
    </div>
  );
}
