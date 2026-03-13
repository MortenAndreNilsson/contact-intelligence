import { queryAll, queryOne, run, generateId } from "../db/client.ts";
import { createActivity } from "./activities.ts";
import type {
  Message,
  MessageRow,
  MessageInput,
  MessageChannel,
  ContentReference,
} from "../types/index.ts";

function parseMessage(row: MessageRow): Message {
  return {
    ...row,
    content_references: row.content_references
      ? JSON.parse(row.content_references)
      : [],
  };
}

// ========== CREATE ==========
export async function createMessage(input: MessageInput): Promise<Message> {
  const id = generateId();
  const refs = input.content_references
    ? JSON.stringify(input.content_references)
    : null;

  await run(
    `INSERT INTO messages (id, channel, contact_id, company_id, recipient_name, recipient_context, tone, objective, content_references, additional_context, provider)
     VALUES ($id, $channel, $contactId, $companyId, $recipientName, $recipientContext, $tone, $objective, $refs, $additionalContext, $provider)`,
    {
      $id: id,
      $channel: input.channel,
      $contactId: input.contact_id ?? null,
      $companyId: input.company_id ?? null,
      $recipientName: input.recipient_name ?? null,
      $recipientContext: input.recipient_context ?? null,
      $tone: input.tone ?? "professional",
      $objective: input.objective ?? null,
      $refs: refs,
      $additionalContext: input.additional_context ?? null,
      $provider: input.provider ?? "lmstudio",
    },
  );

  return (await getMessage(id))!;
}

// ========== GET ==========
export async function getMessage(id: string): Promise<Message | null> {
  const row = await queryOne<MessageRow>(
    `SELECT * FROM messages WHERE id = $id`,
    { $id: id },
  );
  if (!row) return null;
  return parseMessage(row);
}

// ========== LIST ==========
export async function listMessages(opts?: {
  channel?: MessageChannel;
  status?: string;
  contactId?: string;
  limit?: number;
}): Promise<Message[]> {
  let sql = `SELECT * FROM messages WHERE 1=1`;
  const params: Record<string, unknown> = {};

  if (opts?.channel) {
    sql += ` AND channel = $channel`;
    params.$channel = opts.channel;
  }
  if (opts?.status) {
    sql += ` AND status = $status`;
    params.$status = opts.status;
  }
  if (opts?.contactId) {
    sql += ` AND contact_id = $contactId`;
    params.$contactId = opts.contactId;
  }

  sql += ` ORDER BY updated_at DESC`;

  if (opts?.limit) {
    sql += ` LIMIT $limit`;
    params.$limit = opts.limit;
  }

  const rows = await queryAll<MessageRow>(
    sql,
    Object.keys(params).length > 0 ? params : undefined,
  );
  return rows.map(parseMessage);
}

// ========== UPDATE ==========
export async function updateMessage(
  id: string,
  fields: Partial<{
    title: string;
    channel: MessageChannel;
    recipient_name: string;
    recipient_context: string;
    tone: string;
    objective: string;
    content_references: ContentReference[];
    additional_context: string;
    provider: string;
    prompt: string;
    draft_content: string;
    final_content: string;
    subject_line: string;
    status: string;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { $id: id };

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const paramName = `$${key}`;
    if (key === "content_references") {
      sets.push(`content_references = $content_references`);
      params.$content_references = JSON.stringify(value);
    } else {
      sets.push(`${key} = ${paramName}`);
      params[paramName] = value;
    }
  }

  if (sets.length === 0) return;
  sets.push("updated_at = CAST(current_timestamp AS VARCHAR)");
  await run(`UPDATE messages SET ${sets.join(", ")} WHERE id = $id`, params);
}

// ========== DELETE ==========
export async function deleteMessage(id: string): Promise<void> {
  await run(`DELETE FROM messages WHERE id = $id`, { $id: id });
}

// ========== COMPLETE (mark done + log activity) ==========
export async function completeMessage(id: string): Promise<Message | null> {
  const msg = await getMessage(id);
  if (!msg) return null;

  await updateMessage(id, {
    status: "completed",
    final_content: msg.final_content || msg.draft_content,
  });

  if (msg.contact_id) {
    const activityType = `outreach_${msg.channel}`;
    const title = msg.title || msg.objective || `${msg.channel} message`;
    await createActivity(
      msg.contact_id,
      msg.company_id,
      activityType,
      "message-writer",
      `msg-${id}`,
      title,
      JSON.stringify({ channel: msg.channel, messageId: id }),
      new Date().toISOString(),
    );
  }

  return getMessage(id);
}
