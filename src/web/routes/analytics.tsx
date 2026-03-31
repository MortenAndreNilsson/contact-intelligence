import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { ArticlesCard } from "../cards/articles-analytics.tsx";
import { ViewsCard } from "../cards/views-analytics.tsx";
import { SurveysCard } from "../cards/surveys-analytics.tsx";
import { SurveyDetailCard } from "../cards/survey-detail.tsx";
import { EngagementCard } from "../cards/engagement-card.tsx";
import { SurveyDimensionsCard } from "../cards/survey-dimensions.tsx";
import { CompanyTimelineCard } from "../cards/company-timeline.tsx";
import { ArticleTrendCard } from "../cards/article-trend.tsx";
import { CoursesCard } from "../cards/courses-analytics.tsx";
import {
  getTopArticles, getTopPages, getSurveyAnalytics, getSurveyIndex, getSurveyDetail,
  getEngagementScores, getSurveyDimensions, getCompanyTimeline, getArticleTrend,
  getCourseOverview,
} from "../../services/analytics.ts";
import type { Period } from "../cards/helpers.tsx";
import { periodToDays } from "../cards/helpers.tsx";

const app = new Hono();

function parsePeriod(raw: string | undefined): Period {
  if (raw === "7d" || raw === "30d" || raw === "90d") return raw;
  return "all";
}

app.get("/analytics/articles", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const period = parsePeriod(c.req.query("period"));
  const articles = await getTopArticles(25, periodToDays(period));
  const content = <ArticlesCard articles={articles} period={period} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

app.get("/analytics/views", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const period = parsePeriod(c.req.query("period"));
  const pages = await getTopPages(25, periodToDays(period));
  const content = <ViewsCard pages={pages} period={period} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

app.get("/analytics/surveys", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const period = parsePeriod(c.req.query("period"));
  const days = periodToDays(period);
  const [data, surveys] = await Promise.all([
    getSurveyAnalytics(days),
    getSurveyIndex(days),
  ]);
  const content = <SurveysCard data={data} surveys={surveys} period={period} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

app.get("/analytics/courses", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const period = parsePeriod(c.req.query("period"));
  const data = await getCourseOverview(periodToDays(period));
  const content = <CoursesCard data={data} period={period} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// Per-survey detail — must be before company dimensions to avoid slug/companyId conflict
app.get("/analytics/surveys/:slug", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const slug = decodeURIComponent(c.req.param("slug"));
  const period = parsePeriod(c.req.query("period"));
  const data = await getSurveyDetail(slug, periodToDays(period));
  const content = <SurveyDetailCard data={data} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

app.get("/analytics/engagement", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const period = parsePeriod(c.req.query("period"));
  const companies = await getEngagementScores(20, periodToDays(period));
  const content = <EngagementCard companies={companies} period={period} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// Company survey dimension breakdown (moved from /analytics/surveys/:companyId/dimensions)
app.get("/analytics/company/:companyId/survey-dimensions", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const companyId = c.req.param("companyId");
  const data = await getSurveyDimensions(companyId);
  const content = <SurveyDimensionsCard data={data} companyId={companyId} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// Company engagement timeline
app.get("/companies/:id/timeline", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const id = c.req.param("id");
  const data = await getCompanyTimeline(id);
  const content = <CompanyTimelineCard data={data} companyId={id} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// Article reader trend
app.get("/analytics/articles/:slug/trend", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const slug = c.req.param("slug");
  const data = await getArticleTrend(decodeURIComponent(slug));
  const content = <ArticleTrendCard data={data} slug={slug} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

export default app;
