import { queryAll, queryOne } from "../db/client.ts";
import type {
  TopArticleWithMovement,
  TopPageWithMovement,
  CompanySurveyStats,
  SurveyCompletion,
  SurveyOverview,
  SurveyIndexEntry,
  SurveyDetailData,
  QuestionDistribution,
  CompanyEngagement,
} from "../types/index.ts";

/** Build a WHERE clause fragment for date filtering. Returns empty string for "all". */
function dateFilter(alias: string, days: number | null, column = "occurred_at"): string {
  if (days === null) return "";
  return ` AND ${alias}.${column} >= CAST(current_timestamp - INTERVAL '${days} days' AS VARCHAR)`;
}

/** Top articles ranked by unique readers, with 7-day movement */
export async function getTopArticles(limit = 25, days: number | null = null): Promise<TopArticleWithMovement[]> {
  return queryAll<TopArticleWithMovement>(
    `SELECT
       a.title,
       json_extract_string(a.detail, '$.slug') AS slug,
       json_extract_string(a.detail, '$.section') AS section,
       COUNT(DISTINCT ct.email) AS reader_count,
       COUNT(DISTINCT CASE
         WHEN a.occurred_at >= CAST(current_timestamp - INTERVAL '7 days' AS VARCHAR) THEN ct.email
       END) AS new_readers_7d,
       MAX(a.occurred_at) AS last_read
     FROM activities a
     LEFT JOIN contacts ct ON a.contact_id = ct.id
     WHERE a.activity_type = 'article_view'
       AND a.title IS NOT NULL
       AND json_extract_string(a.detail, '$.slug') IS NOT NULL
       AND json_extract_string(a.detail, '$.slug') != ''
       AND a.title NOT LIKE '/%'
       ${dateFilter("a", days)}
     GROUP BY a.title, slug, section
     ORDER BY reader_count DESC, last_read DESC
     LIMIT $limit`,
    { $limit: limit }
  );
}

/** Top pages ranked by total views, with unique visitors and 7-day movement */
export async function getTopPages(limit = 25, days: number | null = null): Promise<TopPageWithMovement[]> {
  return queryAll<TopPageWithMovement>(
    `SELECT
       a.title,
       json_extract_string(a.detail, '$.slug') AS path,
       json_extract_string(a.detail, '$.section') AS section,
       COUNT(*) AS view_count,
       COUNT(DISTINCT ct.email) AS unique_visitors,
       COUNT(CASE
         WHEN a.occurred_at >= CAST(current_timestamp - INTERVAL '7 days' AS VARCHAR) THEN 1
       END) AS new_views_7d,
       MAX(a.occurred_at) AS last_viewed
     FROM activities a
     LEFT JOIN contacts ct ON a.contact_id = ct.id
     WHERE a.activity_type = 'page_view'
       AND a.title IS NOT NULL
       AND a.title NOT LIKE '/%'
       ${dateFilter("a", days)}
     GROUP BY a.title, path, section
     ORDER BY view_count DESC, last_viewed DESC
     LIMIT $limit`,
    { $limit: limit }
  );
}

function maturityLevel(score: number): string {
  if (score >= 4.5) return "Leader";
  if (score >= 3.5) return "Advanced";
  if (score >= 2.5) return "Intermediate";
  if (score >= 1.5) return "Developing";
  return "Beginner";
}

/** Survey analytics: company rankings + recent completions + totals */
export async function getSurveyAnalytics(days: number | null = null): Promise<SurveyOverview> {
  const companyRows = await queryAll<{
    company_name: string;
    company_id: string;
    avg_score: number;
    completion_count: number;
    latest_completion: string;
  }>(
    `SELECT
       comp.name AS company_name,
       comp.id AS company_id,
       AVG(CAST(json_extract_string(a.detail, '$.avgScore') AS DOUBLE)) AS avg_score,
       COUNT(*) AS completion_count,
       MAX(a.occurred_at) AS latest_completion
     FROM activities a
     JOIN companies comp ON a.company_id = comp.id
     WHERE a.activity_type = 'survey_completed'
       ${dateFilter("a", days)}
     GROUP BY comp.id, comp.name
     ORDER BY avg_score DESC`
  );

  const company_rankings: CompanySurveyStats[] = companyRows.map((r) => ({
    ...r,
    maturity_level: maturityLevel(r.avg_score),
  }));

  const recentRows = await queryAll<{
    contact_name: string | null;
    contact_email: string;
    company_name: string | null;
    score: number;
    completed_at: string;
    source: string | null;
  }>(
    `SELECT
       ct.name AS contact_name,
       ct.email AS contact_email,
       comp.name AS company_name,
       CAST(json_extract_string(a.detail, '$.avgScore') AS DOUBLE) AS score,
       a.occurred_at AS completed_at,
       a.source AS source
     FROM activities a
     LEFT JOIN contacts ct ON a.contact_id = ct.id
     LEFT JOIN companies comp ON a.company_id = comp.id
     WHERE a.activity_type = 'survey_completed'
       ${dateFilter("a", days)}
     ORDER BY a.occurred_at DESC
     LIMIT 10`
  );

  const recent_completions: SurveyCompletion[] = recentRows.map((r) => ({
    ...r,
    maturity_level: maturityLevel(r.score),
  }));

  const summary = await queryOne<{
    total_completions: number;
    avg_overall_score: number | null;
    companies_surveyed: number;
  }>(
    `SELECT
       COUNT(*) AS total_completions,
       AVG(CAST(json_extract_string(a.detail, '$.avgScore') AS DOUBLE)) AS avg_overall_score,
       COUNT(DISTINCT a.company_id) AS companies_surveyed
     FROM activities a
     WHERE a.activity_type = 'survey_completed'
       ${dateFilter("a", days)}`
  );

  return {
    total_completions: summary?.total_completions ?? 0,
    avg_overall_score: summary?.avg_overall_score ?? null,
    companies_surveyed: summary?.companies_surveyed ?? 0,
    company_rankings,
    recent_completions,
  };
}

/** Composite engagement scores per company with trend indicators */
export async function getEngagementScores(limit = 20, days: number | null = null): Promise<CompanyEngagement[]> {
  const rows = await queryAll<{
    company_id: string;
    company_name: string;
    article_reads: number;
    page_views: number;
    survey_completions: number;
    activity_last_30d: number;
    activity_prev_30d: number;
  }>(
    `SELECT
       comp.id AS company_id,
       comp.name AS company_name,
       COUNT(CASE WHEN a.activity_type = 'article_view' THEN 1 END) AS article_reads,
       COUNT(CASE WHEN a.activity_type = 'page_view' THEN 1 END) AS page_views,
       COUNT(CASE WHEN a.activity_type = 'survey_completed' THEN 1 END) AS survey_completions,
       COUNT(CASE WHEN a.occurred_at >= CAST(current_timestamp - INTERVAL '30 days' AS VARCHAR) THEN 1 END) AS activity_last_30d,
       COUNT(CASE WHEN a.occurred_at >= CAST(current_timestamp - INTERVAL '60 days' AS VARCHAR)
                   AND a.occurred_at < CAST(current_timestamp - INTERVAL '30 days' AS VARCHAR) THEN 1 END) AS activity_prev_30d
     FROM activities a
     JOIN companies comp ON a.company_id = comp.id
     WHERE 1=1
       ${dateFilter("a", days)}
     GROUP BY comp.id, comp.name
     HAVING COUNT(*) > 0
     ORDER BY (COUNT(CASE WHEN a.activity_type = 'survey_completed' THEN 1 END) * 5
              + COUNT(CASE WHEN a.activity_type = 'article_view' THEN 1 END) * 3
              + COUNT(CASE WHEN a.activity_type = 'page_view' THEN 1 END) * 1) DESC
     LIMIT $limit`,
    { $limit: limit }
  );

  return rows.map((r) => {
    const engagement_score = r.survey_completions * 5 + r.article_reads * 3 + r.page_views * 1;
    let trend: "rising" | "stable" | "cooling" = "stable";
    if (r.activity_prev_30d > 0) {
      const change = (r.activity_last_30d - r.activity_prev_30d) / r.activity_prev_30d;
      if (change > 0.2) trend = "rising";
      else if (change < -0.2) trend = "cooling";
    } else if (r.activity_last_30d > 0) {
      trend = "rising";
    }
    return {
      company_id: r.company_id,
      company_name: r.company_name,
      article_reads: r.article_reads,
      page_views: r.page_views,
      survey_completions: r.survey_completions,
      engagement_score,
      activity_last_30d: r.activity_last_30d,
      trend,
    };
  });
}

/** Survey dimension breakdown for a specific company */
export async function getSurveyDimensions(companyId: string): Promise<{
  company_name: string;
  dimensions: { name: string; avg_score: number }[];
  completions: number;
}> {
  const company = await queryOne<{ name: string }>(
    "SELECT name FROM companies WHERE id = $id",
    { $id: companyId }
  );

  const rows = await queryAll<{ detail: string }>(
    `SELECT a.detail
     FROM activities a
     WHERE a.company_id = $companyId
       AND a.activity_type = 'survey_completed'
       AND a.detail IS NOT NULL`,
    { $companyId: companyId }
  );

  const dimensionTotals: Record<string, { sum: number; count: number }> = {};

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.detail);
      const dims = parsed.dimensions || parsed.dimensionScores;
      if (dims && typeof dims === "object") {
        for (const [key, val] of Object.entries(dims)) {
          const num = Number(val);
          if (!isNaN(num)) {
            if (!dimensionTotals[key]) dimensionTotals[key] = { sum: 0, count: 0 };
            dimensionTotals[key].sum += num;
            dimensionTotals[key].count++;
          }
        }
      }
    } catch { /* skip malformed */ }
  }

  const dimensions = Object.entries(dimensionTotals)
    .map(([name, { sum, count }]) => ({ name, avg_score: sum / count }))
    .sort((a, b) => b.avg_score - a.avg_score);

  return {
    company_name: company?.name || "Unknown",
    dimensions,
    completions: rows.length,
  };
}

/** Weekly activity aggregation for a company timeline */
export async function getCompanyTimeline(companyId: string): Promise<{
  company_name: string;
  weeks: { week_start: string; articles: number; pages: number; surveys: number; total: number }[];
}> {
  const company = await queryOne<{ name: string }>(
    "SELECT name FROM companies WHERE id = $id",
    { $id: companyId }
  );

  const rows = await queryAll<{
    week_start: string;
    articles: number;
    pages: number;
    surveys: number;
    total: number;
  }>(
    `SELECT
       date_trunc('week', CAST(a.occurred_at AS TIMESTAMP))::DATE::VARCHAR AS week_start,
       COUNT(CASE WHEN a.activity_type = 'article_view' THEN 1 END) AS articles,
       COUNT(CASE WHEN a.activity_type = 'page_view' THEN 1 END) AS pages,
       COUNT(CASE WHEN a.activity_type = 'survey_completed' THEN 1 END) AS surveys,
       COUNT(*) AS total
     FROM activities a
     WHERE a.company_id = $companyId
     GROUP BY week_start
     ORDER BY week_start DESC
     LIMIT 26`,
    { $companyId: companyId }
  );

  return {
    company_name: company?.name || "Unknown",
    weeks: rows.reverse(), // chronological order
  };
}

/** Weekly reader trend for a specific article */
export async function getArticleTrend(slug: string): Promise<{
  title: string;
  weeks: { week_start: string; readers: number }[];
}> {
  const titleRow = await queryOne<{ title: string }>(
    `SELECT a.title FROM activities a
     WHERE json_extract_string(a.detail, '$.slug') = $slug
       AND a.title IS NOT NULL
     LIMIT 1`,
    { $slug: slug }
  );

  const rows = await queryAll<{ week_start: string; readers: number }>(
    `SELECT
       date_trunc('week', CAST(a.occurred_at AS TIMESTAMP))::DATE::VARCHAR AS week_start,
       COUNT(DISTINCT ct.email) AS readers
     FROM activities a
     LEFT JOIN contacts ct ON a.contact_id = ct.id
     WHERE a.activity_type = 'article_view'
       AND json_extract_string(a.detail, '$.slug') = $slug
     GROUP BY week_start
     ORDER BY week_start DESC
     LIMIT 26`,
    { $slug: slug }
  );

  return {
    title: titleRow?.title || decodeURIComponent(slug).replace(/-/g, " "),
    weeks: rows.reverse(),
  };
}

/** List all surveys with response counts, avg scores, and metadata */
export async function getSurveyIndex(days: number | null = null): Promise<SurveyIndexEntry[]> {
  return queryAll<SurveyIndexEntry>(
    `SELECT
       sr.slug,
       sm.title,
       COUNT(*) AS response_count,
       CASE WHEN COUNT(sr.overallScore) > 0
            THEN AVG(sr.overallScore)
            ELSE NULL END AS avg_score,
       CASE WHEN COUNT(sr.overallScore) > 0 THEN true ELSE false END AS is_scored,
       MAX(sr.completedAt) AS latest_completion,
       sm.source
     FROM survey_responses sr
     LEFT JOIN survey_metadata sm ON sr.slug = sm.slug
     WHERE sr.slug IS NOT NULL
       ${dateFilter("sr", days, "completedAt")}
     GROUP BY sr.slug, sm.title, sm.source
     ORDER BY response_count DESC`
  );
}

/** Full detail for a single survey: summary, maturity distribution, answer distributions, recent completions */
export async function getSurveyDetail(slug: string, days: number | null = null): Promise<SurveyDetailData> {
  // Summary
  const summary = await queryOne<{
    response_count: number;
    avg_score: number | null;
    scored_count: number;
  }>(
    `SELECT
       COUNT(*) AS response_count,
       CASE WHEN COUNT(overallScore) > 0 THEN AVG(overallScore) ELSE NULL END AS avg_score,
       COUNT(overallScore) AS scored_count
     FROM survey_responses
     WHERE slug = $slug
       ${dateFilter("survey_responses", days, "completedAt")}`,
    { $slug: slug }
  );

  const isScored = (summary?.scored_count ?? 0) > 0;

  // Title from metadata
  const meta = await queryOne<{ title: string | null }>(
    "SELECT title FROM survey_metadata WHERE slug = $slug",
    { $slug: slug }
  );

  // Maturity distribution (scored surveys only)
  let maturityDist: { level: string; count: number }[] = [];
  if (isScored) {
    maturityDist = await queryAll<{ level: string; count: number }>(
      `SELECT maturityLevel AS level, COUNT(*) AS count
       FROM survey_responses
       WHERE slug = $slug AND maturityLevel IS NOT NULL
         ${dateFilter("survey_responses", days, "completedAt")}
       GROUP BY maturityLevel
       ORDER BY count DESC`,
      { $slug: slug }
    );
  }

  // Answer distributions — fetch all answers JSON, aggregate in TypeScript
  const answerRows = await queryAll<{ answers: string }>(
    `SELECT answers FROM survey_responses
     WHERE slug = $slug AND answers IS NOT NULL
       ${dateFilter("survey_responses", days, "completedAt")}`,
    { $slug: slug }
  );

  const questionAgg = new Map<string, Map<string, number>>();
  for (const row of answerRows) {
    try {
      const parsed = JSON.parse(row.answers);
      if (typeof parsed !== "object" || parsed === null) continue;
      for (const [qId, answer] of Object.entries(parsed)) {
        if (!questionAgg.has(qId)) questionAgg.set(qId, new Map());
        const counts = questionAgg.get(qId)!;
        // Answer can be { value, label } or just a string/number
        const label = typeof answer === "object" && answer !== null
          ? (answer as any).label || (answer as any).value || String(answer)
          : String(answer);
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    } catch { /* skip malformed */ }
  }

  // Sort question IDs (they are timestamps like q1772796771967 — lexicographic sort preserves order)
  const sortedQIds = [...questionAgg.keys()].sort();
  const questionDistributions: QuestionDistribution[] = sortedQIds.map((qId, idx) => {
    const counts = questionAgg.get(qId)!;
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const answers = [...counts.entries()]
      .map(([label, count]) => ({ label, count, percentage: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count);
    return {
      question_id: qId,
      question_index: idx + 1,
      sample_label: answers[0]?.label ?? null,
      answers,
    };
  });

  // Recent completions
  const recentRows = await queryAll<{
    contact_name: string | null;
    contact_email: string;
    company_name: string | null;
    score: number | null;
    completed_at: string;
    source: string | null;
  }>(
    `SELECT
       ct.name AS contact_name,
       sr.email AS contact_email,
       comp.name AS company_name,
       sr.overallScore AS score,
       sr.completedAt AS completed_at,
       sr.source
     FROM survey_responses sr
     LEFT JOIN contacts ct ON sr.email = ct.email
     LEFT JOIN companies comp ON ct.company_id = comp.id
     WHERE sr.slug = $slug
       ${dateFilter("sr", days, "completedAt")}
     ORDER BY sr.completedAt DESC
     LIMIT 10`,
    { $slug: slug }
  );

  const recentCompletions: SurveyCompletion[] = recentRows.map((r) => ({
    ...r,
    contact_email: r.contact_email || "",
    score: r.score ?? 0,
    maturity_level: r.score != null ? maturityLevel(r.score) : "",
  }));

  return {
    slug,
    title: meta?.title ?? null,
    response_count: summary?.response_count ?? 0,
    avg_score: summary?.avg_score ?? null,
    is_scored: isScored,
    maturity_distribution: maturityDist,
    question_distributions: questionDistributions,
    recent_completions: recentCompletions,
  };
}
