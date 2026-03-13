import { Hono } from "hono";
import { Layout } from "../pages/layout.tsx";
import { MessageListCard } from "../cards/message-list.tsx";
import { MessageComposeCard } from "../cards/message-compose.tsx";
import { MessageDraftCard, MessageErrorCard } from "../cards/message-draft.tsx";
import {
  createMessage,
  getMessage,
  listMessages,
  updateMessage,
  deleteMessage,
  completeMessage,
} from "../../services/messages.ts";
import {
  buildMessagePrompt,
  generateMessage,
} from "../../services/message-generation.ts";
import { getContact } from "../../services/contacts.ts";
import { getCompany } from "../../services/companies.ts";
import { listActivities } from "../../services/activities.ts";
import type { MessageChannel, MessageInput, ContentReference } from "../../types/index.ts";

const app = new Hono();

// ========== GET /messages — list ==========
app.get("/messages", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const channel = c.req.query("channel") as MessageChannel | undefined;
  const messages = await listMessages({ channel: channel || undefined });
  const content = <MessageListCard messages={messages} activeChannel={channel} />;
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// ========== GET /messages/new — compose form ==========
app.get("/messages/new", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const contactId = c.req.query("contact_id");

  let contact = null;
  let company = null;
  let recipientContext = "";

  let contactNotFound = false;
  if (contactId) {
    contact = await getContact(contactId);
    if (!contact) {
      contactNotFound = true;
    }
    if (contact?.company_id) {
      company = await getCompany(contact.company_id);
    }
    if (contact) {
      const parts: string[] = [];
      if (contact.job_title) parts.push(contact.job_title);
      if (company) parts.push(`at ${company.name}`);
      if (company?.industry) parts.push(`(${company.industry})`);
      if (company?.country) parts.push(`· ${company.country}`);

      // Recent activity
      const activities = await listActivities({ contactId, limit: 3 });
      if (activities.length > 0) {
        parts.push(`\nRecent activity:`);
        for (const a of activities) {
          parts.push(`- ${a.title || a.activity_type} (${a.occurred_at.split("T")[0]})`);
        }
      }
      recipientContext = parts.join(" ");
    }
  }

  const content = (
    <div>
      {contactNotFound && (
        <div class="card" style="border-left: 3px solid var(--visma-orange); margin-bottom: var(--space-sm)">
          <div class="text-sm" style="color: var(--visma-orange)">
            Contact not found — enter recipient details manually.
          </div>
        </div>
      )}
      <MessageComposeCard
        contact={contact}
        company={company}
        recipientContext={recipientContext}
      />
    </div>
  );
  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// ========== GET /messages/:id — view/edit ==========
app.get("/messages/:id", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";
  const msg = await getMessage(c.req.param("id"));
  if (!msg) {
    const err = <div class="card"><div class="text-sm text-muted">Message not found.</div></div>;
    if (isHtmx) return c.html(err, 404);
    return c.html(<Layout>{err}</Layout>, 404);
  }

  const content = msg.draft_content
    ? <MessageDraftCard message={msg} />
    : <MessageComposeCard message={msg} />;

  if (isHtmx) return c.html(content);
  return c.html(<Layout>{content}</Layout>);
});

// ========== POST /messages — create + generate ==========
app.post("/messages", async (c) => {
  const body = await c.req.parseBody();

  const refs = parseRefs(body.content_references as string);

  const input: MessageInput = {
    channel: (body.channel as MessageChannel) || "email",
    contact_id: (body.contact_id as string) || undefined,
    company_id: (body.company_id as string) || undefined,
    recipient_name: (body.recipient_name as string) || undefined,
    recipient_context: (body.recipient_context as string) || undefined,
    tone: (body.tone as any) || "professional",
    objective: (body.objective as string) || undefined,
    content_references: refs,
    additional_context: (body.additional_context as string) || undefined,
    provider: (body.provider as string) || "lmstudio",
  };

  const msg = await createMessage(input);

  // Build prompt (use custom if provided and non-default, otherwise auto-build)
  const customPrompt = (body.prompt as string)?.trim();
  const isDefaultPrompt = !customPrompt || customPrompt === "Prompt will be generated from the fields above.";
  const prompt = isDefaultPrompt ? buildMessagePrompt(msg) : customPrompt;

  await updateMessage(msg.id, { prompt, title: input.objective || `${input.channel} message` });

  // Generate
  const result = await generateMessage({ ...msg, prompt }, isDefaultPrompt ? undefined : prompt);

  if (!result) {
    const updated = await getMessage(msg.id);
    return c.html(
      <MessageErrorCard
        error="Generation failed. LM Studio may be unavailable, or try switching to Gemini."
        message={updated!}
      />,
    );
  }

  await updateMessage(msg.id, {
    draft_content: result.content,
    subject_line: result.subjectLine || null,
  });

  const updated = (await getMessage(msg.id))!;
  return c.html(<MessageDraftCard message={updated} />);
});

// ========== POST /messages/:id/generate — generate/regenerate ==========
app.post("/messages/:id/generate", async (c) => {
  const msg = await getMessage(c.req.param("id"));
  if (!msg) return c.html(<div class="card text-sm text-muted">Message not found.</div>, 404);

  const body = await c.req.parseBody();

  // Allow tone/provider override from request
  const tone = (body.tone as string) || msg.tone;
  const provider = (body.provider as string) || msg.provider;
  const customPrompt = (body.prompt as string)?.trim();

  if (tone !== msg.tone || provider !== msg.provider) {
    await updateMessage(msg.id, { tone, provider });
  }

  const updatedMsg = (await getMessage(msg.id))!;
  const prompt = customPrompt || buildMessagePrompt(updatedMsg);
  await updateMessage(msg.id, { prompt });

  const result = await generateMessage(updatedMsg, prompt);

  if (!result) {
    return c.html(
      <MessageErrorCard
        error="Generation failed. Check that your AI provider is running."
        message={updatedMsg}
      />,
    );
  }

  await updateMessage(msg.id, {
    draft_content: result.content,
    subject_line: result.subjectLine || msg.subject_line,
  });

  const final = (await getMessage(msg.id))!;
  return c.html(<MessageDraftCard message={final} />);
});

// ========== POST /messages/:id/regenerate — same as generate ==========
app.post("/messages/:id/regenerate", async (c) => {
  // Reuse the same generation logic as /generate
  const msg = await getMessage(c.req.param("id"));
  if (!msg) return c.html(<div class="card text-sm text-muted">Message not found.</div>, 404);

  const body = await c.req.parseBody();
  const tone = (body.tone as string) || msg.tone;
  const provider = (body.provider as string) || msg.provider;
  const customPrompt = (body.prompt as string)?.trim();

  if (tone !== msg.tone || provider !== msg.provider) {
    await updateMessage(msg.id, { tone, provider });
  }

  const updatedMsg = (await getMessage(msg.id))!;
  const prompt = customPrompt || buildMessagePrompt(updatedMsg);
  await updateMessage(msg.id, { prompt });

  const result = await generateMessage(updatedMsg, prompt);
  if (!result) {
    return c.html(
      <MessageErrorCard
        error="Generation failed. Check that your AI provider is running."
        message={updatedMsg}
      />,
    );
  }

  await updateMessage(msg.id, {
    draft_content: result.content,
    subject_line: result.subjectLine || msg.subject_line,
  });

  const final = (await getMessage(msg.id))!;
  return c.html(<MessageDraftCard message={final} />);
});

// ========== PUT /messages/:id — save edits ==========
app.put("/messages/:id", async (c) => {
  const msg = await getMessage(c.req.param("id"));
  if (!msg) return c.text("Not found", 404);

  const body = await c.req.parseBody();
  const updates: Record<string, any> = {};

  if (body.final_content !== undefined) updates.final_content = body.final_content;
  if (body.subject_line !== undefined) updates.subject_line = body.subject_line;
  if (body.prompt !== undefined) updates.prompt = body.prompt;

  if (Object.keys(updates).length > 0) {
    await updateMessage(msg.id, updates);
  }

  return c.text("Saved", 200);
});

// ========== POST /messages/:id/complete ==========
app.post("/messages/:id/complete", async (c) => {
  const completed = await completeMessage(c.req.param("id"));
  if (!completed) return c.text("Not found", 404);

  const isHtmx = c.req.header("HX-Request") === "true";
  if (isHtmx) {
    const messages = await listMessages();
    return c.html(<MessageListCard messages={messages} />);
  }
  return c.text("Completed", 200);
});

// ========== DELETE /messages/:id ==========
app.delete("/messages/:id", async (c) => {
  await deleteMessage(c.req.param("id"));
  const messages = await listMessages();
  return c.html(<MessageListCard messages={messages} />);
});

// ========== Helper ==========
function parseRefs(raw: string | undefined): ContentReference[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export default app;
