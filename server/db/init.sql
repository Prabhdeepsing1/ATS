-- QueueGate: Event-Sourced ATS Pipeline Management System
-- PostgreSQL 16 Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- jobs: a company opens a position with a defined active capacity
CREATE TABLE jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  active_cap    INT NOT NULL CHECK (active_cap > 0),
  decay_window  INTERVAL NOT NULL DEFAULT '48 hours',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- applicants: one row per applicant per job, current_status is derived + cached
CREATE TABLE applicants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  current_status  TEXT NOT NULL DEFAULT 'waitlisted'
                  CHECK (current_status IN ('active','waitlisted','acknowledged','exited','decayed_waitlisted')),
  queue_position  INT,          -- only meaningful when waitlisted or decayed_waitlisted
  penalty_offset  INT DEFAULT 0, -- accumulated decay penalty (increments on each decay)
  promoted_at     TIMESTAMPTZ,  -- timestamp of last promotion to active
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(job_id, email)
);

-- pipeline_events: the immutable log — every state change lives here
CREATE TABLE pipeline_events (
  id            BIGSERIAL PRIMARY KEY,
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  applicant_id  UUID NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  -- event_type values:
  -- APPLIED: applicant submitted application
  -- PROMOTED: applicant moved from waitlist to active
  -- ACKNOWLEDGED: applicant acknowledged their promotion (clicked button)
  -- EXITED: applicant left pipeline (hired, withdrew, rejected)
  -- DECAYED: applicant remained unacknowledged past decay_window
  payload       JSONB,          -- reason, prior_position, new_position, cascade_depth, etc.
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_pipeline_events_job_created ON pipeline_events(job_id, created_at);
CREATE INDEX idx_pipeline_events_applicant_created ON pipeline_events(applicant_id, created_at);
CREATE INDEX idx_applicants_job_status ON applicants(job_id, current_status);
CREATE INDEX idx_applicants_job_queue ON applicants(job_id, queue_position) WHERE current_status IN ('waitlisted', 'decayed_waitlisted');
CREATE INDEX idx_applicants_job_promoted ON applicants(job_id, promoted_at) WHERE current_status = 'active';

-- Audit: track schema version
CREATE TABLE schema_versions (
  version INT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT now(),
  description TEXT
);

INSERT INTO schema_versions (version, description) VALUES 
(1, 'Initial QueueGate schema with event sourcing');
