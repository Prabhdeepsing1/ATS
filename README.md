# QueueGate

**Event-sourced ATS pipeline management system.** Treat state transitions as immutable events, not column updates. One word, memorable, describes exactly what it does: it gates the queue.

---

## Quick Start

```bash
# Clone the repository
cd queuegate

# Start the entire stack with Docker Compose
docker compose up --build

# The system is now running:
# - Client (React) at http://localhost:3000
# - API server at http://localhost:3001
# - PostgreSQL at localhost:5432
# - Health check: http://localhost:3001/health
```

One command. Everything runs. That's the goal.

**Frontend is included!** The React client is built with vanilla CSS and includes:
- Landing page with quick-start modals
- Company dashboard with real-time pipeline view
- Applicant status page with countdown timer
- Full audit trail visualization

Navigate to **http://localhost:3000** to start using the platform.

---

## What It Does (3 sentences)

QueueGate manages applicant pipelines for hiring workflows. Every state change (applied, promoted, acknowledged, exited, decayed) is an immutable event. Current status is derived from replaying event history, giving you full auditability and the ability to reconstruct pipeline state at any point in time.

---

## Architecture: Event Sourcing

### Why This Isn't Just CRUD

Most ATS submissions build: POST /apply → update `applicants.status` → done. **QueueGate is different** because it treats state transitions as first-class events, not column updates.

#### The Pattern

Every movement through the pipeline is an immutable log entry in `pipeline_events`. The current status of any applicant is **derived** from replaying their event history.

```sql
-- This is the immutable log:
-- APPLIED: applicant submitted
-- PROMOTED: moved from waitlist to active
-- ACKNOWLEDGED: applicant confirmed promotion
-- EXITED: hired, withdrew, or rejected
-- DECAYED: remained unacknowledged past decay_window
```

#### Why This Is Correct for Hiring

1. **Full auditability (requirement 6)**: The entire history is immutable. You know exactly when and why each transition happened.
2. **Time-travel reconstruction**: Reconstruct the pipeline state at any point in history.
3. **Clear causality**: "What happened and why?" is always answered by the event log, not guesswork from column snapshots.

### Three Core Tables

#### `jobs` — A position with defined capacity

```sql
CREATE TABLE jobs (
  id            UUID PRIMARY KEY,
  company_id    UUID NOT NULL,
  title         TEXT NOT NULL,
  active_cap    INT NOT NULL,         -- max number of active candidates
  decay_window  INTERVAL DEFAULT '48 hours',
  created_at    TIMESTAMPTZ
);
```

#### `applicants` — One row per applicant per job (derived state cached)

```sql
CREATE TABLE applicants (
  id              UUID PRIMARY KEY,
  job_id          UUID REFERENCES jobs(id),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  current_status  TEXT DEFAULT 'waitlisted'
                  CHECK (current_status IN ('active','waitlisted','acknowledged','exited','decayed_waitlisted')),
  queue_position  INT,                -- only when waitlisted/decayed
  penalty_offset  INT DEFAULT 0,      -- increments on each decay
  promoted_at     TIMESTAMPTZ,        -- timestamp of last promotion to active
  created_at      TIMESTAMPTZ
);
```

**Key insight**: `current_status` and `queue_position` are cached for query performance, but they're derived from `pipeline_events`. On a fresh start, you could rebuild the entire state by replaying events.

#### `pipeline_events` — The immutable event log

```sql
CREATE TABLE pipeline_events (
  id            BIGSERIAL PRIMARY KEY,
  job_id        UUID REFERENCES jobs(id),
  applicant_id  UUID REFERENCES applicants(id),
  event_type    TEXT NOT NULL,
  payload       JSONB,          -- reason, positions, penalties, etc.
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

Every state change is recorded here. Forever.

---

## Race Condition Handling: PostgreSQL Advisory Locks

### The Problem

Without coordination, this happens:

```
Request A: Check active_count = 4, cap = 5 → promote
Request B: Check active_count = 4, cap = 5 → promote  ← DOUBLE PROMOTION!
```

Both requests see the same count and promote themselves. Now you have 6 active candidates in a job with capacity 5.

### The Solution: `pg_advisory_xact_lock`

QueueGate uses PostgreSQL's transaction-scoped advisory locks to serialize access.

```javascript
// From lockManager.js
async function withJobLock(jobId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const lockKey = uuidToLockKey(jobId);
    // This blocks until the lock is released by any other transaction
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
    
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } finally {
    client.release();
  }
}
```

#### How It Works

1. Request A arrives: `withJobLock(jobId, ...)`
2. Acquires advisory lock on jobId → proceeds
3. Request B arrives: `withJobLock(jobId, ...)`
4. **Waits** for lock (PostgreSQL's queue)
5. Request A checks active_count = 4, cap = 5 → promotes to active, increments to 5
6. Request A commits, releases lock
7. Request B's lock is granted
8. Request B checks active_count = 5, cap = 5 → adds to waitlist
9. Request B commits

**No double-promotion.** The database enforces it.

### Why Not App-Level Locks?

App-level locks (Node.js `Mutex` libraries) fail in multi-process deployments and don't survive crashes. Database locks are durable, work across any number of app instances, and are exactly what advisory locks are designed for.

---

## Three Core Engines

### 1. PipelineEngine

The heart of the system. Every entry point calls through here.

#### `applyToJob(jobId, applicantData)`
- Acquires advisory lock on jobId
- Counts active applicants for this job
- If count < active_cap: set status = 'active', promoted_at = now()
- Else: set status = 'waitlisted', assign queue_position
- Log APPLIED or PROMOTED event
- Release lock

#### `exitApplicant(applicantId, reason)`
- Mark as 'exited'
- Log EXITED event with reason
- Call `promoteNext(jobId)` to bring up the next person

#### `promoteNext(jobId, [client])`
- Acquire advisory lock on jobId
- Find top waitlisted applicant (lowest penalty_offset, then lowest queue_position)
- Set status = 'active', promoted_at = now()
- Log PROMOTED event
- Release lock

### 2. CascadeEngine

The autonomous decay system. Runs entirely inside the Node process — no external scheduler.

#### How It Works

On server startup, `CascadeEngine.start()` runs a `setInterval` every 5 minutes. Each tick:

1. Queries for all applicants where:
   - current_status = 'active'
   - promoted_at < now() - decay_window
   - No ACKNOWLEDGED event exists after their promotion

2. For each found:
   - Set current_status = 'decayed_waitlisted'
   - Calculate new queue_position = max_waitlist_position + (penalty_offset * 5) + 1
   - Increment penalty_offset by 1
   - Log DECAYED event
   - Call `promoteNext(jobId)` to bring up the next person

3. The cascade: promoteNext brings up a new person who also has a decay_window. Next tick, if they don't acknowledge, they decay too — autonomous cascade, entirely self-contained.

#### Decay Decisions (Configurable Per Job)

| Decision | Value | Rationale |
|----------|-------|-----------|
| **Decay Window** | 48 hours (configurable per job) | A candidate should respond within 2 days. Hiring decisions take hours or days; 48 hours is generous. |
| **Penalty Formula** | `queue_pos = tail + (penalty_offset * 5)` | First decay: go just past tail. Second decay: 5 further back. Third: 10 further. Incentivizes responsiveness. |
| **Cascade Tick** | Every 5 minutes | Balances responsiveness with database load. 300,000ms is sufficient for hiring workflows. |

### 3. LockManager

Wraps PostgreSQL advisory locks. Zero external infrastructure.

```javascript
withJobLock(jobId, async (client) => {
  // Your code runs here with lock held
  // Lock is released when transaction commits/rolls back
});
```

---

## API Reference

### Response Envelope

All endpoints return a consistent structure:

```json
{
  "ok": true,
  "data": { ... },
  "meta": { "timestamp": "...", "request_id": "..." }
}
```

Errors:
```json
{
  "ok": false,
  "error": { "code": "ERROR_CODE", "message": "..." },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

---

### Jobs

#### `POST /api/jobs`
**Create a job opening**

Request:
```json
{
  "company_id": "uuid",
  "title": "Senior Backend Engineer",
  "description": "optional",
  "active_cap": 5,
  "decay_window": "48 hours"
}
```

Response (201):
```json
{
  "ok": true,
  "data": {
    "id": "job-uuid",
    "company_id": "company-uuid",
    "title": "Senior Backend Engineer",
    "active_cap": 5,
    "decay_window": "2 days",
    "created_at": "2026-04-24T12:00:00Z"
  }
}
```

---

#### `GET /api/jobs/:jobId`
**Get job details + pipeline snapshot**

Response (200):
```json
{
  "ok": true,
  "data": {
    "job": {
      "id": "job-uuid",
      "company_id": "company-uuid",
      "title": "Senior Backend Engineer",
      "active_cap": 5,
      "created_at": "2026-04-24T12:00:00Z"
    },
    "pipeline_snapshot": {
      "active": 4,
      "waitlisted": 12,
      "decayed_waitlisted": 2,
      "acknowledged": 0,
      "exited": 8
    }
  }
}
```

---

#### `POST /api/jobs/:jobId/apply`
**Submit an application**

Request:
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+1-555-1234"
}
```

Response (201 if promoted, 202 if waitlisted):
```json
{
  "ok": true,
  "data": {
    "applicant": {
      "id": "applicant-uuid",
      "job_id": "job-uuid",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "current_status": "active",
      "promoted_at": "2026-04-24T12:00:00Z"
    },
    "event": {
      "id": 1,
      "event_type": "PROMOTED",
      "created_at": "2026-04-24T12:00:00Z"
    },
    "promoted": true
  }
}
```

Or if waitlisted (202):
```json
{
  "promoted": false,
  "applicant": {
    "current_status": "waitlisted",
    "queue_position": 5
  }
}
```

---

#### `GET /api/jobs/:jobId/waitlist`
**Get ordered waitlist with positions**

Response (200):
```json
{
  "ok": true,
  "data": {
    "waitlist": [
      {
        "position": 1,
        "applicant_id": "uuid",
        "name": "John Doe",
        "email": "john@example.com",
        "queue_position": 5,
        "penalty_offset": 0,
        "status": "waitlisted"
      }
    ],
    "total": 1
  }
}
```

---

#### `GET /api/jobs/:jobId/events`
**Full event log for a job (audit trail)**

Query params: `?limit=100&offset=0`

Response (200):
```json
{
  "ok": true,
  "data": {
    "events": [
      {
        "id": 1,
        "applicant_id": "uuid",
        "applicant_name": "Jane Doe",
        "applicant_email": "jane@example.com",
        "applicant_status": "active",
        "event_type": "PROMOTED",
        "payload": {
          "reason": "waitlist_promotion",
          "prior_position": 3
        },
        "created_at": "2026-04-24T12:00:00Z"
      }
    ],
    "pagination": {
      "limit": 100,
      "offset": 0,
      "total": 50
    }
  }
}
```

---

### Applicants

#### `POST /api/applicants/:id/acknowledge`
**Applicant acknowledges promotion**

Response (200):
```json
{
  "ok": true,
  "data": {
    "applicant_id": "uuid",
    "status": "active",
    "acknowledged": true
  }
}
```

---

#### `POST /api/applicants/:id/exit`
**Exit an applicant**

Request:
```json
{
  "reason": "hired"  // or "withdrew", "rejected"
}
```

Response (200):
```json
{
  "ok": true,
  "data": {
    "applicant": { ... },
    "event": { ... },
    "promoted_next": { ... } // or null if no one to promote
  }
}
```

---

#### `GET /api/applicants/:id/status`
**Get applicant status + queue position**

Response (200):
```json
{
  "ok": true,
  "data": {
    "applicant_id": "uuid",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "status": "active",
    "queue_position": null,
    "penalty_offset": 0,
    "promoted_at": "2026-04-24T12:00:00Z",
    "decay_deadline": "2026-04-26T12:00:00Z",
    "time_until_decay_ms": 172800000
  }
}
```

---

## Polling Strategy: Why Not WebSockets?

### The Question

Why poll every 30 seconds instead of WebSocket for real-time updates?

### The Answer

**WebSockets add infrastructure complexity (connection management, reconnect logic, heartbeats, graceful degradation) for a use case that doesn't need sub-second updates.**

Hiring workflows are measured in hours or days:
- Screening takes hours
- Interview scheduling takes hours
- Decision-making takes hours
- Candidate response takes hours or days

A 30-second poll is **indistinguishable from real-time** for these timescales. You're deliberately matching polling interval to domain cadence, not implementing premature "real-time" infrastructure.

### Chosen Intervals

| Endpoint | Interval | Reasoning |
|----------|----------|-----------|
| `/api/jobs/:jobId` | 30 seconds | Dashboard needs recent pipeline state |
| `/api/applicants/:id/status` | 60 seconds | Applicant doesn't need sub-minute updates |

---

## Docker Setup

The entire system runs in Docker Compose:

```bash
docker compose up --build
```

This:
1. Starts PostgreSQL 16 (Alpine) with the schema at `/docker-entrypoint-initdb.d/init.sql`
2. Builds and starts the Node.js API server
3. Sets up health checks
4. Creates a persistent `postgres_data` volume

**No setup required.** One command.

### Environment Variables

Copy `.env.example` to `.env` and customize:

```bash
NODE_ENV=development
PORT=3001
DATABASE_URL=postgres://queuegate:queuegate@localhost:5432/queuegate
CORS_ORIGIN=*
```

---

## Folder Structure

```
queuegate/
├── docker-compose.yml              # Full stack orchestration
├── docker-compose.override.yml     # Development overrides (hot-reload)
├── .env                            # Environment variables (local)
├── .env.example                    # Template
├── README.md                       # Backend architecture & API reference (this file)
├── FRONTEND.md                     # Frontend architecture & design system
│
├── server/                         # Node.js API Backend
│   ├── Dockerfile                  # Node.js 18-Alpine container
│   ├── package.json                # Dependencies
│   ├── db/
│   │   ├── pool.js                 # PostgreSQL connection pool
│   │   └── init.sql                # Schema + migrations
│   │
│   └── src/
│       ├── index.js                # Express setup, CascadeEngine start
│       ├── engines/
│       │   ├── pipelineEngine.js   # Core state machine
│       │   ├── cascadeEngine.js    # Autonomous decay
│       │   └── lockManager.js      # Advisory locks
│       │
│       ├── routes/
│       │   ├── jobs.js             # Job endpoints
│       │   └── applicants.js       # Applicant endpoints
│       │
│       └── middleware/
│           └── errorHandler.js     # Error + request ID handling
│
└── client/                         # React Frontend (PRODUCTION READY)
    ├── Dockerfile                  # React build + serve container
    ├── .dockerignore               # Docker build exclusions
    ├── .env.example                # Frontend config template
    ├── .gitignore                  # Git exclusions
    ├── package.json                # React dependencies
    ├── README.md                   # Frontend quick start
    ├── public/
    │   └── index.html              # HTML entry point
    │
    └── src/
        ├── App.jsx                 # React Router setup
        ├── index.js                # React entry point
        │
        ├── pages/
        │   ├── Home.jsx            # Landing page with CTAs
        │   ├── Dashboard.jsx       # Company dashboard (real-time pipeline)
        │   └── ApplicantStatus.jsx # Applicant status page (countdown timer, timeline)
        │
        ├── components/
        │   └── index.js            # 20+ reusable UI components (vanilla CSS)
        │
        ├── styles/
        │   ├── globals.css         # Design system (40+ CSS variables)
        │   ├── layout.css          # Header, modals, cards
        │   ├── home.css            # Home page specific
        │   ├── dashboard.css       # Dashboard page specific
        │   └── applicant.css       # Applicant page specific
        │
        └── utils/
            └── api.js              # API client + helpers
```

---

## Full Stack Architecture

### Three Tiers

1. **Frontend** (`client/`, http://localhost:3000)
   - React 18 with React Router
   - Vanilla CSS with comprehensive design system
   - 30-60 second polling intervals matched to domain cadence
   - Responsive mobile-first design

2. **Backend** (`server/`, http://localhost:3001/api)
   - Express.js REST API
   - 3 core engines: PipelineEngine, CascadeEngine, LockManager
   - PostgreSQL advisory locks for race condition safety
   - Event sourcing with immutable log

3. **Database** (http://localhost:5432)
   - PostgreSQL 16-Alpine
   - 3 tables: jobs, applicants, pipeline_events
   - Persistent volume (`postgres_data`)

### Communication Flow

```
User Browser → React Frontend (localhost:3000)
    ↓
    → HTTP Polling (30s dashboard, 60s applicant status)
    ↓
Express API Server (localhost:3001)
    ↓
    → PipelineEngine (state machine)
    → CascadeEngine (autonomous decay, 5-min ticks)
    → LockManager (advisory locks)
    ↓
PostgreSQL (localhost:5432)
    ↓
    → Event Log (pipeline_events table)
    → Applicant State (applicants table)
    → Job Definition (jobs table)
```

---

## Frontend Features

See [FRONTEND.md](FRONTEND.md) for complete frontend documentation.

### Pages

#### Home (`/`)
- Hero cards: "For Companies" & "For Applicants"
- "How It Works" 4-step guide
- Modals for creating jobs and applying
- Success/error alerts

#### Dashboard (`/dashboard/:jobId`)
- Pipeline snapshot (active, waitlisted, decayed, acknowledged, exited counts)
- Active applicants section
- Ordered waitlist with queue positions
- Full event log with audit trail
- Exit applicant modal with reason dropdown
- Auto-refresh every 30 seconds

#### Applicant Status (`/applicant/:applicantId`)
- Status hero section
- Real-time countdown timer (updates every 1s)
- Current status, queue position, decay deadline
- Next steps card (context-aware based on status)
- Application timeline showing event progression
- Acknowledge promotion modal
- Auto-refresh every 60 seconds

### Design System

- **Colors**: Indigo (primary) + Cyan (accent) + dark slate background
- **Typography**: Inter (body) + Poppins (headings)
- **Components**: 20+ reusable elements (buttons, cards, modals, inputs, tables)
- **Animations**: Smooth transitions, pulse effects, slide-ins
- **Responsive**: Mobile-first design (breakpoints at 768px, 480px)

### Key Technologies

- React 18 with hooks
- React Router 6 for SPA routing
- Vanilla CSS (no Tailwind, no CSS-in-JS)
- Google Fonts (Inter, Poppins)
- Emoji-based icons (no image assets)

---

### Decision 1: Event Sourcing

✓ **Chosen**: Event sourcing (immutable log, derived state)
✗ **Rejected**: Direct status updates

**Why**: Hiring pipelines need auditability (requirement 6) and the ability to reconstruct state. Event sourcing gives both for free.

---

### Decision 2: PostgreSQL Advisory Locks

✓ **Chosen**: `pg_advisory_xact_lock` (database-level)
✗ **Rejected**: App-level mutex / Node.js locks

**Why**: Advisory locks are transaction-scoped, work across any number of app instances, and survive crashes. They're exactly designed for this problem.

---

### Decision 3: No External Scheduler

✓ **Chosen**: `setInterval` inside Node process
✗ **Rejected**: Bull, Agenda, cron packages

**Why**: The cascade logic is simple enough (one database query + promotion loop) that external schedulers add complexity without benefit. `setInterval` is synchronous, testable, and has zero infrastructure.

---

### Decision 4: Polling Over WebSockets

✓ **Chosen**: HTTP polling (30s dashboard, 60s applicant view)
✗ **Rejected**: WebSocket connections

**Why**: Hiring workflows don't need sub-second updates. A 30-second poll is indistinguishable from real-time for timescales measured in hours/days. WebSockets add connection management, reconnect logic, and heartbeat complexity.

---

### Decision 5: Decay Window & Penalties

| What | Value | Why |
|------|-------|-----|
| Decay window | 48 hours | Candidates should respond within 2 days. Generous but firm. |
| Penalty | `queue_pos = tail + (n * 5)` | First decay: back of line. Second decay: 5 further. Incentivizes responsiveness without harsh punishment. |
| Cascade tick | 5 minutes | Responsive to new decays without hammering the database. |

---

## Tradeoffs: What I'd Change With More Time

### 1. WebSocket Support
Add Socket.io for sub-second updates if the frontend team requires it. Implement graceful fallback to polling.

### 2. Email Notifications
- When promoted: "Congratulations! You've moved to the active pool. Please acknowledge within 48 hours."
- When decayed: "Your slot expired. You've been moved back. Please reapply when ready."
- Requires async email queue (Bull + Redis).

### 3. Multi-Tenant Company Auth
- Add `company_id` scoping to all queries
- Implement company auth middleware
- Prevent cross-company data leaks

### 4. Configurable Decay Window Per Job
Already in schema (`jobs.decay_window`), but not exposed in the UI. Add admin endpoint to update.

### 5. Applicant Status History View
Expose `/api/applicants/:id/history` that replays events to show the full timeline of an applicant's journey through the pipeline.

### 6. Distributed Tracing
Add OpenTelemetry for request tracing across services. Helps debug cascade timing issues in production.

### 7. Metrics & Observability
- Prometheus metrics for queue depth, decay events per minute, promotion latency
- Grafana dashboards for hiring team visibility

---

## How to Test

### 1. Create a Job

```bash
curl -X POST http://localhost:3001/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": "test-company",
    "title": "Backend Engineer",
    "active_cap": 2,
    "decay_window": "1 hour"
  }'
```

Response includes `id` (job UUID). Copy it.

### 2. Apply 3 Applicants

```bash
# Applicant 1 (should be promoted to active)
curl -X POST http://localhost:3001/api/jobs/{JOB_ID}/apply \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "email": "alice@example.com"
  }'

# Applicant 2 (should also be promoted)
curl -X POST http://localhost:3001/api/jobs/{JOB_ID}/apply \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bob",
    "email": "bob@example.com"
  }'

# Applicant 3 (should go to waitlist, capacity is 2)
curl -X POST http://localhost:3001/api/jobs/{JOB_ID}/apply \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Charlie",
    "email": "charlie@example.com"
  }'
```

### 3. Check Waitlist

```bash
curl http://localhost:3001/api/jobs/{JOB_ID}/waitlist
```

Charlie should be at position 1.

### 4. Exit an Applicant

```bash
curl -X POST http://localhost:3001/api/applicants/{ALICE_ID}/exit \
  -H "Content-Type: application/json" \
  -d '{ "reason": "hired" }'
```

### 5. Check Job Snapshot

```bash
curl http://localhost:3001/api/jobs/{JOB_ID}
```

- Active should now be 2 (Bob + Charlie promoted)
- Waitlist should be empty

### 6. Check Event Log

```bash
curl http://localhost:3001/api/jobs/{JOB_ID}/events
```

You'll see: APPLIED → PROMOTED → PROMOTED → EXITED → PROMOTED (cascade).

---

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use secrets manager for `DATABASE_URL` (AWS Secrets, HashiCorp Vault)
- [ ] Enable SSL for database connections
- [ ] Add request rate limiting middleware
- [ ] Set up health checks for container orchestration (Kubernetes, ECS)
- [ ] Add request logging to centralized logging system (CloudWatch, DataDog)
- [ ] Monitor database pool exhaustion
- [ ] Set cascade tick interval based on traffic patterns (default 5 min is conservative)
- [ ] Add metrics/observability (Prometheus)
- [ ] Enable CORS only for known domains
- [ ] Add API key authentication for jobs endpoints

---

## License

MIT

---

**Built with event sourcing, PostgreSQL advisory locks, and deliberately-chosen tradeoffs.**
