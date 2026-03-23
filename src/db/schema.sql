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
CREATE INDEX IF NOT EXISTS idx_survey_responses_slug ON survey_responses(slug);

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR PRIMARY KEY,
  title VARCHAR,
  channel VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'draft',
  contact_id VARCHAR,
  company_id VARCHAR,
  recipient_name VARCHAR,
  recipient_context VARCHAR,
  tone VARCHAR,
  objective VARCHAR,
  content_references VARCHAR,
  additional_context VARCHAR,
  provider VARCHAR,
  prompt VARCHAR,
  draft_content VARCHAR,
  final_content VARCHAR,
  subject_line VARCHAR,
  created_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR),
  updated_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR)
);

CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);

-- AI Maturity Journey (G6)
CREATE TABLE IF NOT EXISTS maturity_snapshots (
  id VARCHAR PRIMARY KEY,
  company_id VARCHAR NOT NULL,
  snapshot_date DATE NOT NULL,
  trigger_type VARCHAR NOT NULL,
  total_respondents INTEGER DEFAULT 0,
  beginner_count INTEGER DEFAULT 0,
  developing_count INTEGER DEFAULT 0,
  intermediate_count INTEGER DEFAULT 0,
  advanced_count INTEGER DEFAULT 0,
  leader_count INTEGER DEFAULT 0,
  avg_score REAL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_company ON maturity_snapshots(company_id);

-- G7: Engagement Signals
CREATE TABLE IF NOT EXISTS signals (
  id VARCHAR PRIMARY KEY,
  signal_type VARCHAR NOT NULL,
  company_id VARCHAR NOT NULL,
  title VARCHAR NOT NULL,
  detail VARCHAR,
  detected_at VARCHAR NOT NULL,
  dismissed BOOLEAN DEFAULT false,
  created_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR)
);

CREATE INDEX IF NOT EXISTS idx_signals_company ON signals(company_id);
CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_signals_dismissed ON signals(dismissed);

-- G5: Semantic Memory Layer
CREATE TABLE IF NOT EXISTS embedding_sources (
  id VARCHAR PRIMARY KEY,
  content_type VARCHAR NOT NULL,
  source_ref VARCHAR NOT NULL,
  content_hash VARCHAR NOT NULL,
  chunk_count INTEGER DEFAULT 1,
  last_embedded_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR),
  UNIQUE(content_type, source_ref)
);

CREATE TABLE IF NOT EXISTS embeddings (
  id VARCHAR PRIMARY KEY,
  content_type VARCHAR NOT NULL,
  source_id VARCHAR NOT NULL REFERENCES embedding_sources(id),
  chunk_index INTEGER DEFAULT 0,
  content_text VARCHAR NOT NULL,
  embedding FLOAT[768] NOT NULL,
  metadata VARCHAR DEFAULT '{}',
  created_at VARCHAR DEFAULT CAST(current_timestamp AS VARCHAR)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_type ON embeddings(content_type);
CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_id);
CREATE INDEX IF NOT EXISTS idx_embedding_sources_type_ref ON embedding_sources(content_type, source_ref)
