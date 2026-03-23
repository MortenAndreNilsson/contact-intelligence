/**
 * Chat route — session management + intent dispatch.
 * All handler logic lives in chat-handlers.tsx.
 */

import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { understandQuery, getHistory, addTurn } from "../../services/local-llm.ts";
import { dispatchIntent } from "./chat-handlers.tsx";
import { HelpCard } from "./chat-handlers.tsx";
import { dismissSignal } from "../../services/signals-service.ts";
import { getActiveSignals } from "../../services/signals-service.ts";
import { SignalsFeedCard } from "../cards/signals-feed.tsx";

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
  console.log(`Chat: "${raw}" → intent=${understanding.intent}, confidence=${understanding.confidence}`);

  // Dispatch to the right handler
  const result = await dispatchIntent(understanding);
  console.log(`Chat: → ${result.summary}`);

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

app.post("/signals/:id/dismiss", async (c) => {
  const id = c.req.param("id");
  await dismissSignal(id);
  const signals = await getActiveSignals();
  return c.html(<SignalsFeedCard signals={signals} />);
});

export default app;
