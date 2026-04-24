# QueueGate Development Guide

This guide explains how to develop, test, and debug QueueGate.

## Quick Start: Local Development

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- PostgreSQL client (optional, for manual queries)

### Start Everything

```bash
cd queuegate
docker compose up --build
```

This starts:
- PostgreSQL on `localhost:5432`
- Node.js API on `localhost:3001`
- Health check at `http://localhost:3001/health`

### With Hot Reload (Development Mode)

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up
```

This uses `nodemon` to auto-reload on file changes. Perfect for iterating on code.

---

## Architecture Walkthrough

### Request Flow: POST /api/jobs/:jobId/apply

1. **Route** (`routes/jobs.js`): Extract request body, validate
2. **Engine** (`engines/pipelineEngine.js`): `applyToJob(jobId, data)`
3. **Lock** (`engines/lockManager.js`): `withJobLock(jobId, fn)` → PostgreSQL advisory lock acquired
4. **Count**: SELECT COUNT(*) FROM applicants WHERE current_status='active'
5. **Decide**:
   - If count < cap: promote to active, log PROMOTED
   - Else: add to waitlist, log APPLIED
6. **Lock Release**: Transaction commits, lock released
7. **Response**: Return applicant + event

### Request Flow: CascadeEngine Tick

1. **Timer**: `setInterval` fires every 5 minutes
2. **Query**: Find active applicants where `now() - promoted_at > decay_window` AND no ACKNOWLEDGED event
3. **Decay**: For each candidate:
   - Lock the job
   - Verify status hasn't changed (concurrent safety)
   - Move to decayed_waitlisted
   - Increment penalty_offset
   - Log DECAYED event
   - Call promoteNext() → fills the now-empty active slot
   - Release lock
4. **Cascade**: Repeat for next tick (newly promoted person might also decay)

---

## Database Queries for Debugging

### Connect to PostgreSQL

```bash
# From host
psql postgres://queuegate:queuegate@localhost:5432/queuegate

# From inside container
docker exec -it queuegate-db psql -U queuegate -d queuegate
```

### Useful Queries

**Check job pipeline snapshot:**
```sql
SELECT current_status, COUNT(*) as count
FROM applicants
WHERE job_id = 'YOUR_JOB_ID'
GROUP BY current_status;
```

**See event log for a job:**
```sql
SELECT id, applicant_id, event_type, payload, created_at
FROM pipeline_events
WHERE job_id = 'YOUR_JOB_ID'
ORDER BY created_at DESC;
```

**Find applicants in decay (active, past decay_window, no acknowledgment):**
```sql
SELECT a.id, a.name, a.promoted_at, j.decay_window
FROM applicants a
JOIN jobs j ON a.job_id = j.id
WHERE a.current_status = 'active'
  AND a.promoted_at < now() - j.decay_window
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_events pe
    WHERE pe.applicant_id = a.id
      AND pe.event_type = 'ACKNOWLEDGED'
      AND pe.created_at > a.promoted_at
  );
```

**Check advisory locks held:**
```sql
SELECT database, mode, granted
FROM pg_locks
WHERE database = (SELECT datid FROM pg_database WHERE datname = 'queuegate');
```

---

## Testing Cascade Behavior

Want to test decay without waiting 48 hours?

### 1. Create a job with 1-hour decay window:

```bash
curl -X POST http://localhost:3001/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": "test",
    "title": "Test",
    "active_cap": 1,
    "decay_window": "1 hour"
  }'
```

### 2. Apply 2 applicants:

```bash
# Alice gets promoted
curl -X POST http://localhost:3001/api/jobs/{JOB_ID}/apply \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "email": "alice@test.com"}'

# Bob goes to waitlist
curl -X POST http://localhost:3001/api/jobs/{JOB_ID}/apply \
  -H "Content-Type: application/json" \
  -d '{"name": "Bob", "email": "bob@test.com"}'
```

### 3. Wait or manually trigger decay in database:

Update Alice's promotion timestamp to be old:

```sql
UPDATE applicants
SET promoted_at = now() - interval '2 hours'
WHERE email = 'alice@test.com';
```

### 4. Wait for next cascade tick (5 minutes):

Or manually trigger by restarting the server (cascade runs on startup).

### 5. Check results:

```sql
SELECT id, name, email, current_status, queue_position, penalty_offset
FROM applicants
WHERE job_id = 'YOUR_JOB_ID'
ORDER BY id;
```

- Alice: status = 'decayed_waitlisted', queue_position = 1, penalty_offset = 1
- Bob: status = 'active' (promoted from waitlist)

---

## Code Structure

### `engines/pipelineEngine.js`
- **Purpose**: Core state machine
- **Key Functions**: `applyToJob`, `exitApplicant`, `promoteNext`, `logPipelineEvent`
- **Lock Scope**: Called inside `withJobLock()` context

### `engines/cascadeEngine.js`
- **Purpose**: Autonomous decay
- **Key Functions**: `start()`, `stop()`, `processTick()`, `processDecay()`
- **Timer**: `setInterval` every 5 minutes
- **Lock Scope**: Each decay operation acquires `withJobLock()`

### `engines/lockManager.js`
- **Purpose**: PostgreSQL advisory locks
- **Key Functions**: `withJobLock()`, `withApplicantLock()`, `uuidToLockKey()`
- **Isolation**: SERIALIZABLE, transaction-scoped

### `routes/jobs.js`
- **Endpoints**: POST /jobs, GET /jobs/:jobId, POST /jobs/:jobId/apply, GET /jobs/:jobId/waitlist, GET /jobs/:jobId/events

### `routes/applicants.js`
- **Endpoints**: POST /applicants/:id/acknowledge, POST /applicants/:id/exit, GET /applicants/:id/status

---

## Common Issues & Solutions

### Issue: "Database connection refused"

**Cause**: PostgreSQL container not running or not healthy yet

**Solution**:
```bash
docker compose ps  # Check status
docker compose logs db  # See database logs
# Wait 10 seconds for PostgreSQL to initialize
```

### Issue: "Applicants getting double-promoted"

**Cause**: Advisory lock not being respected

**Solution**:
1. Check that all `applyToJob` calls go through `withJobLock()`
2. Verify isolation level is SERIALIZABLE
3. Check database logs: `docker compose logs db | grep lock`

### Issue: "Cascade not running"

**Cause**: CascadeEngine not started or interval set too high

**Solution**:
1. Check server logs: `docker compose logs server`
2. Verify `cascadeEngine.start()` is called in `index.js`
3. Lower tick interval for testing: edit in `index.js`

### Issue: "Events not showing in log"

**Cause**: `logPipelineEvent` called with wrong client or transaction rolled back

**Solution**:
1. Verify client is passed correctly
2. Check that `COMMIT` happens, not `ROLLBACK`
3. Verify no errors in the operation that precedes the log

---

## Performance Considerations

### Database Indexes

Queries are optimized with indexes on:
- `pipeline_events(job_id, created_at)` — for event log queries
- `applicants(job_id, current_status)` — for pipeline snapshot counts
- `applicants(job_id, queue_position)` where status in ('waitlisted', 'decayed_waitlisted')` — for waitlist ordering

### Connection Pooling

- Max pool size: 20 (configurable via `DB_POOL_SIZE`)
- Idle timeout: 30 seconds
- Connection timeout: 2 seconds

### Cascade Tick Load

With 1000 active applicants, one tick (5 min interval) takes ~100-500ms:
- Query for decay candidates: ~10ms
- Lock → decay → promote per applicant: ~1ms each
- Total: 1000ms across all candidates (not concurrent)

---

## Extending the System

### Adding a New Event Type

1. Add to `CHECK` constraint in `pipeline_events` table schema
2. Create handler in appropriate engine
3. Call `logPipelineEvent()` with new type
4. Update README API reference

### Adding Metrics

Use OpenTelemetry:
```javascript
const { MeterProvider } = require('@opentelemetry/api-metrics');
const meter = meterProvider.getMeter('queuegate');
const promotionCounter = meter.createCounter('promotions_total');
promotionCounter.add(1, { reason: 'waitlist' });
```

### Adding Email Notifications

1. Add email template for each event type
2. Create notification queue handler
3. Integrate with Bull + Redis
4. Handle delivery failures and retries

---

## Deployment

### Using Docker Compose

```bash
docker compose up -d
docker compose logs -f server
```

### Using Kubernetes

See `docs/kubernetes.yaml` (placeholder for now).

### Environment Variables

Copy `.env.example` to `.env.production`:

```bash
NODE_ENV=production
DATABASE_URL=postgres://user:pass@prod-db.rds.amazonaws.com:5432/queuegate
PORT=3001
CORS_ORIGIN=https://your-domain.com
```

---

## Contributing

1. Write tests in `__tests__/` folder
2. Run `npm test`
3. Follow ESLint rules: `npm run lint`
4. Commit to feature branch
5. Open PR with description of changes

---

## License

MIT
