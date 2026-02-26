import { generateId, queryAll, queryOne, run } from "../db/client.ts";
import type { Contact, ContactWithDetails, ContactRow } from "../types/index.ts";

function parseContact(row: ContactRow): Contact {
  return { ...row, tags: JSON.parse(row.tags || "[]") };
}

export async function createContact(
  email: string,
  name?: string,
  companyId?: string,
  jobTitle?: string,
  source: string = "manual"
): Promise<Contact> {
  const id = generateId();
  await run(
    `INSERT INTO contacts (id, email, name, company_id, job_title, source)
     VALUES ($id, $email, $name, $companyId, $jobTitle, $source)`,
    { $id: id, $email: email, $name: name ?? null, $companyId: companyId ?? null, $jobTitle: jobTitle ?? null, $source: source }
  );
  return (await getContact(id))! as Contact;
}

export async function getContact(id: string): Promise<ContactWithDetails | null> {
  const row = await queryOne<ContactRow & { company_name: string | null; activity_count: number }>(
    `SELECT ct.*,
       comp.name AS company_name,
       (SELECT COUNT(*) FROM activities WHERE contact_id = ct.id) AS activity_count
     FROM contacts ct
     LEFT JOIN companies comp ON ct.company_id = comp.id
     WHERE ct.id = $id`,
    { $id: id }
  );
  if (!row) return null;
  return { ...parseContact(row), company_name: row.company_name, activity_count: row.activity_count };
}

export async function listContacts(opts?: { companyId?: string; query?: string; limit?: number }): Promise<ContactWithDetails[]> {
  let sql = `SELECT ct.*,
    comp.name AS company_name,
    (SELECT COUNT(*) FROM activities WHERE contact_id = ct.id) AS activity_count
    FROM contacts ct
    LEFT JOIN companies comp ON ct.company_id = comp.id
    WHERE 1=1`;

  const params: Record<string, unknown> = {};

  if (opts?.companyId) {
    sql += ` AND ct.company_id = $companyId`;
    params.$companyId = opts.companyId;
  }
  if (opts?.query) {
    sql += ` AND (ct.name LIKE $query OR ct.email LIKE $query OR ct.job_title LIKE $query)`;
    params.$query = `%${opts.query}%`;
  }

  sql += ` ORDER BY ct.updated_at DESC`;

  if (opts?.limit) {
    sql += ` LIMIT $limit`;
    params.$limit = opts.limit;
  }

  const rows = await queryAll<ContactRow & { company_name: string | null; activity_count: number }>(sql, Object.keys(params).length > 0 ? params : undefined);
  return rows.map((r) => ({
    ...parseContact(r),
    company_name: r.company_name,
    activity_count: r.activity_count,
  }));
}

export async function updateContact(id: string, fields: Partial<Pick<Contact, "name" | "email" | "company_id" | "job_title" | "consent_status" | "consent_date" | "notes" | "tags">>): Promise<void> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { $id: id };

  if (fields.name !== undefined) { sets.push("name = $name"); params.$name = fields.name; }
  if (fields.email !== undefined) { sets.push("email = $email"); params.$email = fields.email; }
  if (fields.company_id !== undefined) { sets.push("company_id = $companyId"); params.$companyId = fields.company_id; }
  if (fields.job_title !== undefined) { sets.push("job_title = $jobTitle"); params.$jobTitle = fields.job_title; }
  if (fields.consent_status !== undefined) { sets.push("consent_status = $consentStatus"); params.$consentStatus = fields.consent_status; }
  if (fields.consent_date !== undefined) { sets.push("consent_date = $consentDate"); params.$consentDate = fields.consent_date; }
  if (fields.notes !== undefined) { sets.push("notes = $notes"); params.$notes = fields.notes; }
  if (fields.tags !== undefined) { sets.push("tags = $tags"); params.$tags = JSON.stringify(fields.tags); }

  if (sets.length === 0) return;
  sets.push("updated_at = CAST(current_timestamp AS VARCHAR)");
  await run(`UPDATE contacts SET ${sets.join(", ")} WHERE id = $id`, params);
}

export async function deleteContact(id: string): Promise<void> {
  // GDPR: anonymize activities, then delete contact
  await run(`UPDATE activities SET contact_id = NULL WHERE contact_id = $id`, { $id: id });
  await run(`DELETE FROM contacts WHERE id = $id`, { $id: id });
}

export async function getContactByEmail(email: string): Promise<ContactWithDetails | null> {
  const row = await queryOne<{ id: string }>(`SELECT id FROM contacts WHERE email = $email`, { $email: email });
  if (!row) return null;
  return getContact(row.id);
}
