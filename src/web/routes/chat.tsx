/**
 * Chat route — session management + intent dispatch.
 * All handler logic lives in chat-handlers.tsx.
 */

import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { understandQuery, getHistory, addTurn } from "../../services/local-llm.ts";
import { dispatchIntent } from "./chat-handlers.tsx";
import { HelpCard } from "./chat-handlers.tsx";

const app = new Hono();

app.post("/chat", async (c) => {
  const body = await c.req.parseBody();
  const raw = (body.message as string || "").trim();
  if (!raw) {
    return c.html(<HelpCard />);
  }

  // Session management
  const sessionId = getCookie(c, "ci_session") || crypto.randomUUID();
  setCookie(c, "ci_session", sessionId, { path: "/", maxAge: 1800 });
  const history = getHistory(sessionId);

  // Understand the query (LLM with regex fallback)
  const understanding = await understandQuery(raw, history);

  // Dispatch to the right handler
  const result = await dispatchIntent(understanding);

  // Record conversation turns
  addTurn(sessionId, { role: "user", content: raw, intent: understanding.intent });
  addTurn(sessionId, {
    role: "assistant",
    content: result.summary,
    intent: understanding.intent,
    entityId: result.entityId,
    entityName: result.entityName,
    entityType: result.entityType,
  });

  return c.html(result.html);
});

export default app;
