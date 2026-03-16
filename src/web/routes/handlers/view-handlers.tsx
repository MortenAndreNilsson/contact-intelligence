/**
 * View data handlers — dashboard, articles, views, surveys, engagement.
 * Pure data fetching + card rendering, no entity resolution.
 */

import { DashboardStatsCard } from "../../cards/dashboard-stats.tsx";
import { ArticlesCard } from "../../cards/articles-analytics.tsx";
import { ViewsCard } from "../../cards/views-analytics.tsx";
import { SurveysCard } from "../../cards/surveys-analytics.tsx";
import { EngagementCard } from "../../cards/engagement-card.tsx";
import { getDashboardStats } from "../../../services/dashboard.ts";
import { getTopArticles, getTopPages, getSurveyAnalytics, getSurveyIndex, getEngagementScores } from "../../../services/analytics.ts";
import type { IntentHandler } from "../chat-handlers.tsx";

export const handleDashboard: IntentHandler = async () => {
  const stats = await getDashboardStats();
  return { html: <DashboardStatsCard stats={stats} />, summary: "Showed dashboard overview" };
};

export const handleArticles: IntentHandler = async (entities) => {
  const articles = await getTopArticles(entities.limit ?? 25, entities.days ?? null);
  return { html: <ArticlesCard articles={articles} />, summary: `Showed top ${articles.length} articles` };
};

export const handleViews: IntentHandler = async (entities) => {
  const pages = await getTopPages(entities.limit ?? 25, entities.days ?? null);
  return { html: <ViewsCard pages={pages} />, summary: `Showed top ${pages.length} pages` };
};

export const handleSurveys: IntentHandler = async (entities) => {
  const days = entities.days ?? null;
  const [data, surveys] = await Promise.all([
    getSurveyAnalytics(days),
    getSurveyIndex(days),
  ]);
  return { html: <SurveysCard data={data} surveys={surveys} />, summary: "Showed survey analytics" };
};

export const handleEngagement: IntentHandler = async (entities) => {
  const companies = await getEngagementScores(entities.limit ?? 20, entities.days ?? null);
  return { html: <EngagementCard companies={companies} />, summary: `Showed engagement for ${companies.length} companies` };
};
