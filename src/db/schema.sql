CREATE TABLE IF NOT EXISTS companies (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  domain VARCHAR UNIQUE,
  industry VARCHAR,
  size_bucket VARCHAR,
  country VARCHAR,
  notes VARCHAR,
  description VARCHAR,
  tags VARCHAR DEFAULT '[]',
  created_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR),
  updated_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR)
);

CREATE TABLE IF NOT EXISTS contacts (
  id VARCHAR PRIMARY KEY,
  company_id VARCHAR REFERENCES companies(id),
  email VARCHAR UNIQUE,
  name VARCHAR,
  job_title VARCHAR,
  source VARCHAR NOT NULL,
  enrich_skip BOOLEAN DEFAULT FALSE,
  consent_status VARCHAR DEFAULT 'unknown',
  consent_date VARCHAR,
  tags VARCHAR DEFAULT '[]',
  notes VARCHAR,
  created_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR),
  updated_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR)
);

CREATE TABLE IF NOT EXISTS activities (
  id VARCHAR PRIMARY KEY,
  contact_id VARCHAR REFERENCES contacts(id),
  company_id VARCHAR REFERENCES companies(id),
  activity_type VARCHAR NOT NULL,
  source VARCHAR NOT NULL,
  source_ref VARCHAR,
  title VARCHAR,
  detail VARCHAR,
  occurred_at VARCHAR NOT NULL,
  created_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR)
);

CREATE TABLE IF NOT EXISTS lists (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  description VARCHAR,
  list_type VARCHAR NOT NULL,
  filter_criteria VARCHAR,
  created_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR),
  updated_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR)
);

CREATE TABLE IF NOT EXISTS list_members (
  list_id VARCHAR REFERENCES lists(id),
  contact_id VARCHAR REFERENCES contacts(id),
  added_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR),
  PRIMARY KEY (list_id, contact_id)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id VARCHAR PRIMARY KEY,
  source VARCHAR NOT NULL,
  source_ref VARCHAR,
  last_sync_at VARCHAR NOT NULL,
  records_processed INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_skipped INTEGER DEFAULT 0,
  status VARCHAR NOT NULL,
  error_message VARCHAR,
  created_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR)
);

CREATE TABLE IF NOT EXISTS cms_events (
  _id VARCHAR PRIMARY KEY,
  userEmail VARCHAR,
  eventType VARCHAR,
  timestamp VARCHAR,
  date DATE,
  path VARCHAR,
  section VARCHAR,
  slug VARCHAR,
  contentTitle VARCHAR,
  referrer VARCHAR,
  duration BIGINT,
  deviceType VARCHAR
);

CREATE TABLE IF NOT EXISTS survey_responses (
  _id VARCHAR PRIMARY KEY,
  slug VARCHAR,
  email VARCHAR,
  company VARCHAR,
  role VARCHAR,
  overallScore DOUBLE,
  maturityLevel VARCHAR,
  dimensionScores VARCHAR,
  answers VARCHAR,
  completedAt VARCHAR,
  userAgent VARCHAR,
  source VARCHAR DEFAULT 'lighthouse-view'
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_company ON activities(company_id);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_activities_source_ref ON activities(source_ref);
CREATE INDEX IF NOT EXISTS idx_cms_events_email ON cms_events(userEmail);
CREATE INDEX IF NOT EXISTS idx_cms_events_type ON cms_events(eventType);
CREATE TABLE IF NOT EXISTS survey_metadata (
  slug VARCHAR PRIMARY KEY,
  title VARCHAR,
  source VARCHAR,
  synced_at VARCHAR
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_email ON survey_responses(email);
CREATE INDEX IF NOT EXISTS idx_survey_responses_slug ON survey_responses(slug)
