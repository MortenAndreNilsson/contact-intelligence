import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { DashboardStatsCard } from "../cards/dashboard-stats.tsx";
import { getDashboardStats, getArticleReaders } from "../../services/dashboard.ts";
import type { ArticleReader } from "../../types/index.ts";
import { relativeDate } from "../cards/helpers.tsx";

const app = new Hono();

app.get("/", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const stats = await getDashboardStats();
  const content = <DashboardStatsCard stats={stats} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

function ArticleReadersCard({ slug, readers }: { slug: string; readers: ArticleReader[] }) {
  const title = readers[0]?.contact_name ? slug : slug; // slug is used as label
  return (
    <div>
      <div class="card">
        <div class="flex items-center gap-xs mb-sm">
          <span
            class="text-sm card-clickable"
            style="color: var(--color-accent)"
            hx-get="/"
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            Dashboard
          </span>
          <span class="text-xs text-muted">/</span>
          <span class="text-sm text-secondary">Article Readers</span>
        </div>
        <div class="card-title">{decodeURIComponent(slug).replace(/-/g, " ")}</div>
        <div class="text-sm text-muted mt-sm">{readers.length} unique readers</div>
      </div>

      <div class="card">
        <div class="card-label mb-xs">Readers</div>
        {readers.map((r) => (
          <div
            class="table-row card-clickable"
            hx-get={`/contacts/by-email/${encodeURIComponent(r.contact_email)}`}
            hx-target="#canvas"
            hx-swap="innerHTML"
          >
            <div class="flex-1">
              <div style="font-weight: 600">{r.contact_name || r.contact_email}</div>
              <div class="text-xs text-muted">
                {[r.company_name, r.contact_email].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div class="text-xs text-muted font-mono">{relativeDate(r.occurred_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// GET /articles/:slug/readers — show who read a specific article
app.get("/articles/:slug/readers", async (c) => {
  const slug = c.req.param("slug");
  const readers = await getArticleReaders(decodeURIComponent(slug));

  const isHtmx = c.req.header("HX-Request") === "true";
  const content = <ArticleReadersCard slug={slug} readers={readers} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

export default app;
