import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { DashboardStatsCard } from "../cards/dashboard-stats.tsx";
import { getDashboardStats } from "../../services/dashboard.ts";

const app = new Hono();

app.get("/", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const stats = await getDashboardStats();
  const content = <DashboardStatsCard stats={stats} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

export default app;
