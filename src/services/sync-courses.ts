/**
 * Sync course enrollments from ET-CMS Course Studio (Firestore) into DuckDB.
 *
 * Auth: uses gcloud access token for morten.andre.nilsson@visma.com
 * Source: prod-etai-cm
 *   - published-courses index → course_enrollments/{courseId}/users
 */

import { queryOne, run, generateId } from "../db/client.ts";

const ETCMS_PROJECT = "prod-etai-cm";

function firestoreBase(project: string): string {
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
}

async function getAccessToken(): Promise<string> {
  const proc = Bun.spawn(["gcloud.cmd", "auth", "print-access-token"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  if (!text.trim()) {
    throw new Error(`Failed to get access token: ${err}`);
  }
  return text.trim();
}

function parseFirestoreValue(val: any): any {
  if (!val) return null;
  if ("stringValue" in val) return val.stringValue;
  if ("integerValue" in val) return Number(val.integerValue);
  if ("doubleValue" in val) return val.doubleValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("nullValue" in val) return null;
  if ("mapValue" in val) {
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      obj[k] = parseFirestoreValue(v);
    }
    return obj;
  }
  if ("arrayValue" in val) {
    return (val.arrayValue.values || []).map(parseFirestoreValue);
  }
  return null;
}

async function fetchCollection(token: string, project: string, path: string): Promise<any[]> {
  const url = `${firestoreBase(project)}/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Firestore API error for ${project}/${path}: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.documents || [];
}

export interface SyncResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
}

interface PublishedCourse {
  courseId: string;
  slug: string;
  title: string | null;
}

interface EnrollmentRow {
  _id: string;
  courseId: string;
  courseSlug: string | null;
  courseTitle: string | null;
  email: string;
  totalSteps: number | null;
  completedSteps: number;
  quizScores: string | null;
  startedAt: string | null;
  lastActivityAt: string | null;
  completedAt: string | null;
  verificationId: string | null;
  source: string;
}

export async function syncCourseEnrollments(): Promise<SyncResult> {
  const token = await getAccessToken();
  let processed = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Step 1: Fetch published-courses index
  const publishedDocs = await fetchCollection(token, ETCMS_PROJECT, "published-courses");

  const courses: PublishedCourse[] = [];
  for (const doc of publishedDocs) {
    if (!doc.fields) continue;
    const slug = doc.name?.split("/").pop();
    if (!slug) continue;

    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(doc.fields)) {
      fields[k] = parseFirestoreValue(v);
    }

    const courseId = fields.courseId || slug;
    courses.push({
      courseId,
      slug,
      title: fields.title || null,
    });
  }

  // Step 2: For each course, fetch enrollments
  for (const course of courses) {
    const enrollmentDocs = await fetchCollection(
      token,
      ETCMS_PROJECT,
      `course_enrollments/${course.courseId}/users`
    );

    for (const doc of enrollmentDocs) {
      if (!doc.fields) { skipped++; continue; }

      const email = doc.name?.split("/").pop();
      if (!email) { skipped++; continue; }

      const fields: Record<string, any> = {};
      for (const [k, v] of Object.entries(doc.fields)) {
        fields[k] = parseFirestoreValue(v);
      }

      const completedStepsArr: any[] = Array.isArray(fields.completedSteps) ? fields.completedSteps : [];
      const completedStepsCount = completedStepsArr.length;
      const quizScores = fields.quizScores ? JSON.stringify(fields.quizScores) : null;

      const enrollment: EnrollmentRow = {
        _id: `${course.courseId}:${email}`,
        courseId: course.courseId,
        courseSlug: course.slug,
        courseTitle: course.title,
        email,
        totalSteps: fields.totalSteps ?? null,
        completedSteps: completedStepsCount,
        quizScores,
        startedAt: fields.startedAt || null,
        lastActivityAt: fields.lastActivityAt || null,
        completedAt: fields.completedAt || null,
        verificationId: fields.verificationId || null,
        source: "et-cms",
      };

      processed++;

      // Check if enrollment already exists
      const existing = await queryOne<{ _id: string; completedSteps: number; completedAt: string | null }>(
        "SELECT _id, completedSteps, completedAt FROM course_enrollments WHERE _id = $id",
        { $id: enrollment._id }
      );

      if (existing) {
        // Update if progress changed
        const progressChanged =
          existing.completedSteps !== enrollment.completedSteps ||
          existing.completedAt !== enrollment.completedAt;

        if (progressChanged) {
          await run(
            `UPDATE course_enrollments SET
              completedSteps = $completedSteps,
              quizScores = $quizScores,
              lastActivityAt = $lastActivityAt,
              completedAt = $completedAt,
              verificationId = $verificationId,
              courseTitle = $courseTitle
            WHERE _id = $id`,
            {
              $id: enrollment._id,
              $completedSteps: enrollment.completedSteps,
              $quizScores: enrollment.quizScores,
              $lastActivityAt: enrollment.lastActivityAt,
              $completedAt: enrollment.completedAt,
              $verificationId: enrollment.verificationId,
              $courseTitle: enrollment.courseTitle,
            }
          );
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Insert new enrollment
        await run(
          `INSERT INTO course_enrollments (_id, courseId, courseSlug, courseTitle, email, totalSteps, completedSteps, quizScores, startedAt, lastActivityAt, completedAt, verificationId, source)
           VALUES ($id, $courseId, $courseSlug, $courseTitle, $email, $totalSteps, $completedSteps, $quizScores, $startedAt, $lastActivityAt, $completedAt, $verificationId, $source)`,
          {
            $id: enrollment._id,
            $courseId: enrollment.courseId,
            $courseSlug: enrollment.courseSlug,
            $courseTitle: enrollment.courseTitle,
            $email: enrollment.email,
            $totalSteps: enrollment.totalSteps,
            $completedSteps: enrollment.completedSteps,
            $quizScores: enrollment.quizScores,
            $startedAt: enrollment.startedAt,
            $lastActivityAt: enrollment.lastActivityAt,
            $completedAt: enrollment.completedAt,
            $verificationId: enrollment.verificationId,
            $source: enrollment.source,
          }
        );
        created++;
      }
    }
  }

  // Log sync result
  await run(
    `INSERT INTO sync_log (id, source, last_sync_at, records_processed, records_created, records_skipped, status)
     VALUES ($id, 'course_enrollments', CAST(current_timestamp AS VARCHAR), $processed, $created, $skipped, 'success')`,
    { $id: generateId(), $processed: processed, $created: created, $skipped: skipped + updated }
  );

  return { processed, created, updated, skipped };
}
