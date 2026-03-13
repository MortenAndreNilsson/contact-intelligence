export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  country: string | null;
  notes: string | null;
  description: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface CompanyWithStats extends Company {
  contact_count: number;
  avg_score: number | null;
  last_activity: string | null;
}

export interface Contact {
  id: string;
  company_id: string | null;
  email: string;
  name: string | null;
  job_title: string | null;
  source: string;
  consent_status: string;
  consent_date: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactWithDetails extends Contact {
  company_name: string | null;
  activity_count: number;
}

export interface Activity {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  activity_type: string;
  source: string;
  source_ref: string | null;
  title: string | null;
  detail: string | null;
  occurred_at: string;
  created_at: string;
}

export interface ActivityWithNames extends Activity {
  contact_name: string | null;
  contact_email: string | null;
  company_name: string | null;
}

export interface TopArticle {
  title: string;
  slug: string | null;
  section: string | null;
  reader_count: number;
  last_read: string;
}

export interface ArticleReader {
  contact_name: string | null;
  contact_email: string;
  company_name: string | null;
  occurred_at: string;
}

export interface DashboardStats {
  totalCompanies: number;
  totalContacts: number;
  totalActivities: number;
  avgScore: number | null;
  recentActivity: ActivityWithNames[];
  topCompanies: CompanyWithStats[];
  topArticles: TopArticle[];
  newContent: { title: string; section: string | null; slug: string | null; first_seen: string }[];
}

export interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  country: string | null;
  notes: string | null;
  description: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface ContactRow extends Omit<Contact, "tags"> {
  tags: string;
}

export interface PersonInfo {
  name: string | null;
  organization: string | null;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  country: string | null;
}

export interface EnrichResult {
  processed: number;
  enriched: number;
  failed: number;
  companiesCreated: number;
}

export interface PageVisitor {
  contact_name: string | null;
  contact_email: string;
  company_name: string | null;
  view_count: number;
  last_viewed: string;
}

// --- Analytics types ---

export interface TopArticleWithMovement {
  title: string;
  slug: string | null;
  section: string | null;
  reader_count: number;
  new_readers_7d: number;
  last_read: string;
}

export interface TopPageWithMovement {
  title: string;
  path: string | null;
  section: string | null;
  view_count: number;
  unique_visitors: number;
  new_views_7d: number;
  last_viewed: string;
}

export interface CompanySurveyStats {
  company_name: string;
  company_id: string;
  avg_score: number;
  completion_count: number;
  latest_completion: string;
  maturity_level: string;
}

export interface SurveyCompletion {
  contact_name: string | null;
  contact_email: string;
  company_name: string | null;
  score: number;
  maturity_level: string;
  completed_at: string;
  source: string | null;
}

export interface SurveyOverview {
  total_completions: number;
  avg_overall_score: number | null;
  companies_surveyed: number;
  company_rankings: CompanySurveyStats[];
  recent_completions: SurveyCompletion[];
}

// --- Per-survey analytics types ---

export interface SurveyIndexEntry {
  slug: string;
  title: string | null;
  response_count: number;
  avg_score: number | null;
  is_scored: boolean;
  latest_completion: string;
  source: string | null;
}

export interface QuestionDistribution {
  question_id: string;
  question_index: number;
  sample_label: string | null;
  answers: { label: string; count: number; percentage: number }[];
}

export interface SurveyDetailData {
  slug: string;
  title: string | null;
  response_count: number;
  avg_score: number | null;
  is_scored: boolean;
  maturity_distribution: { level: string; count: number }[];
  question_distributions: QuestionDistribution[];
  recent_completions: SurveyCompletion[];
}

// --- List types ---

export interface FilterCriteria {
  industry?: string;
  country?: string;
  tag?: string;
  min_engagement?: number;
  has_survey?: boolean;
  // Behavior-based filters (G3)
  read_section?: string;
  completed_survey?: string;
  min_score?: number;
  max_score?: number;
  active_days?: number;
}

export interface List {
  id: string;
  name: string;
  description: string | null;
  list_type: "manual" | "smart";
  filter_criteria: FilterCriteria | null;
  created_at: string;
  updated_at: string;
}

export interface ListRow extends Omit<List, "filter_criteria"> {
  filter_criteria: string | null;
}

export interface ListWithStats extends List {
  member_count: number;
}

export interface ListMember {
  contact_id: string;
  contact_name: string | null;
  contact_email: string;
  company_name: string | null;
  job_title: string | null;
  activity_count: number;
  engagement_score: number;
  added_at: string | null;
}

// --- LLM intent classification types ---

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  intent?: string;
  entityId?: string;
  entityName?: string;
  entityType?: "company" | "contact" | "article" | "list";
}

export interface QueryUnderstanding {
  intent: string;
  entities: {
    name?: string;
    email?: string;
    domain?: string;
    industry?: string;
    country?: string;
    days?: number;
    limit?: number;
    listName?: string;
    slug?: string;
  };
  confidence: number;
  resolvedFromContext?: boolean;
}

export interface DispatchResult {
  html: any;
  summary: string;
  entityId?: string;
  entityName?: string;
  entityType?: "company" | "contact" | "article" | "list";
}

export interface CompanyEngagement {
  company_id: string;
  company_name: string;
  article_reads: number;
  page_views: number;
  survey_completions: number;
  engagement_score: number;
  activity_last_30d: number;
  trend: "rising" | "stable" | "cooling";
}

// ========== Messages ==========

export type MessageChannel = "email" | "slack" | "linkedin";
export type MessageTone = "professional" | "warm" | "direct" | "casual";
export type MessageStatus = "draft" | "completed";

export interface ContentReference {
  url?: string;
  title?: string;
  snippet?: string;
}

export interface Message {
  id: string;
  title: string | null;
  channel: MessageChannel;
  status: MessageStatus;
  contact_id: string | null;
  company_id: string | null;
  recipient_name: string | null;
  recipient_context: string | null;
  tone: MessageTone | null;
  objective: string | null;
  content_references: ContentReference[];
  additional_context: string | null;
  provider: string | null;
  prompt: string | null;
  draft_content: string | null;
  final_content: string | null;
  subject_line: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow extends Omit<Message, "content_references"> {
  content_references: string | null; // JSON string, parsed by service
}

export interface MessageInput {
  channel: MessageChannel;
  contact_id?: string;
  company_id?: string;
  recipient_name?: string;
  recipient_context?: string;
  tone?: MessageTone;
  objective?: string;
  content_references?: ContentReference[];
  additional_context?: string;
  provider?: string;
}
