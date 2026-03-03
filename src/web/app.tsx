import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import dashboard from "./routes/dashboard.tsx";
import companies from "./routes/companies.tsx";
import contacts from "./routes/contacts.tsx";
import chat from "./routes/chat.tsx";
import sync from "./routes/sync.tsx";
import analytics from "./routes/analytics.tsx";

const app = new Hono();

// Middleware
app.use("/static/*", serveStatic({ root: "./" }));
app.use("*", cors({ origin: "http://localhost:3000" }));

// Routes
app.route("/", dashboard);
app.route("/", companies);
app.route("/", contacts);
app.route("/", chat);
app.route("/", sync);
app.route("/", analytics);

// 404
app.notFound((c) => {
  return c.html(
    <div style="padding: 2rem; color: #9CA3AF; font-family: 'JetBrains Mono', monospace; text-align: center;">
      404 — Not found
    </div>,
    404
  );
});

export default app;
