export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  country: string | null;
  notes: string | null;
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

export interface DashboardStats {
  totalCompanies: number;
  totalContacts: number;
  totalActivities: number;
  avgScore: number | null;
  recentActivity: ActivityWithNames[];
  topCompanies: CompanyWithStats[];
}

export interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  country: string | null;
  notes: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface ContactRow extends Omit<Contact, "tags"> {
  tags: string;
}
