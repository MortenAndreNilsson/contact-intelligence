import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { ArticlesCard } from "../cards/articles-analytics.tsx";
import { ViewsCard } from "../cards/views-analytics.tsx";
import { SurveysCard } from "../cards/surveys-analytics.tsx";
import { EngagementCard } from "../cards/engagement-card.tsx";
import { getTopArticles, getTopPages, getSurveyAnalytics, getEngagementScores } from "../../services/analytics.ts";

const app = new Hono();

app.get("/analytics/articles", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const articles = await getTopArticles();
  const content = <ArticlesCard articles={articles} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

app.get("/analytics/views", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const pages = await getTopPages();
  const content = <ViewsCard pages={pages} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

app.get("/analytics/surveys", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const data = await getSurveyAnalytics();
  const content = <SurveysCard data={data} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

app.get("/analytics/engagement", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const companies = await getEngagementScores();
  const content = <EngagementCard companies={companies} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

export default app;
