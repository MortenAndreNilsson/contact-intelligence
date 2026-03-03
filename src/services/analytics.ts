import { queryAll, queryOne } from "../db/client.ts";
import type {
  TopArticleWithMovement,
  TopPageWithMovement,
  CompanySurveyStats,
  SurveyCompletion,
  SurveyOverview,
  CompanyEngagement,
} from "../types/index.ts";

/** Top articles ranked by unique readers, with 7-day movement */
export async function getTopArticles(limit = 25): Promise<TopArticleWithMovement[]> {
  return queryAll<TopArticleWithMovement>(
    `SELECT
       a.title,
       json_extract_string(a.detail, '$.slug') AS slug,
       json_extract_string(a.detail, '$.section') AS section,
       COUNT(DISTINCT ct.email) AS reader_count,
       COUNT(DISTINCT CASE
         WHEN a.occurred_at >= current_timestamp - INTERVAL '7 days' THEN ct.email
       END) AS new_readers_7d,
       MAX(a.occurred_at) AS last_read
     FROM activities a
     LEFT JOIN contacts ct ON a.contact_id = ct.id
     WHERE a.activity_type = 'article_view'
       AND a.title IS NOT NULL
       AND json_extract_string(a.detail, '$.slug') IS NOT NULL
       AND json_extract_string(a.detail, '$.slug') != ''
       AND a.title NOT LIKE '/%'
     GROUP BY a.title, slug, section
     ORDER BY reader_count DESC, last_read DESC
     LIMIT $limit`,
    { $limit: limit }
  );
}

/** Top pages ranked by total views, with unique visitors and 7-day movement */
export async function getTopPages(limit = 25): Promise<TopPageWithMovement[]> {
  return queryAll<TopPageWithMovement>(
    `SELECT
       a.title,
       json_extract_string(a.detail, '$.slug') AS path,
       json_extract_string(a.detail, '$.section') AS section,
       COUNT(*) AS view_count,
       COUNT(DISTINCT ct.email) AS unique_visitors,
       COUNT(CASE
         WHEN a.occurred_at >= current_timestamp - INTERVAL '7 days' THEN 1
       END) AS new_views_7d,
       MAX(a.occurred_at) AS last_viewed
     FROM activities a
     LEFT JOIN contacts ct ON a.contact_id = ct.id
     WHERE a.activity_type = 'page_view'
       AND a.title IS NOT NULL
       AND a.title NOT LIKE '/%'
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
export async function getSurveyAnalytics(): Promise<SurveyOverview> {
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
  }>(
    `SELECT
       ct.name AS contact_name,
       ct.email AS contact_email,
       comp.name AS company_name,
       CAST(json_extract_string(a.detail, '$.avgScore') AS DOUBLE) AS score,
       a.occurred_at AS completed_at
     FROM activities a
     LEFT JOIN contacts ct ON a.contact_id = ct.id
     LEFT JOIN companies comp ON a.company_id = comp.id
     WHERE a.activity_type = 'survey_completed'
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
     WHERE a.activity_type = 'survey_completed'`
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
export async function getEngagementScores(limit = 20): Promise<CompanyEngagement[]> {
  // Raw counts per company
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
       COUNT(CASE WHEN a.occurred_at >= current_timestamp - INTERVAL '30 days' THEN 1 END) AS activity_last_30d,
       COUNT(CASE WHEN a.occurred_at >= current_timestamp - INTERVAL '60 days'
                   AND a.occurred_at < current_timestamp - INTERVAL '30 days' THEN 1 END) AS activity_prev_30d
     FROM activities a
     JOIN companies comp ON a.company_id = comp.id
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
