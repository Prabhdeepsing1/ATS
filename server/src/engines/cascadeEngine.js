const { pool } = require('../db/pool');
const { withJobLock } = require('./lockManager');
const { promoteNext, logPipelineEvent } = require('./pipelineEngine');

/**
 * CascadeEngine: Autonomous decay and promotion cascade
 *
 * This runs entirely inside the Node process. On each tick (every 5 minutes):
 * 1. Find all active applicants who haven't acknowledged within their decay_window
 * 2. For each one: move to decayed_waitlisted, increment penalty, log event
 * 3. Call promoteNext() to cascade up the next person
 *
 * This creates an autonomous, self-contained promotion cascade without external dependencies.
 */

let intervalId = null;

/**
 * Start the cascade engine.
 * Runs a background task every TICK_INTERVAL milliseconds.
 */
function start(tickIntervalMs = 5 * 60 * 1000) {
  if (intervalId) {
    console.log('CascadeEngine already running');
    return;
  }

  console.log(`Starting CascadeEngine with tick interval: ${tickIntervalMs}ms`);

  intervalId = setInterval(async () => {
    try {
      await processTick();
    } catch (err) {
      console.error('Error in CascadeEngine tick:', err);
    }
  }, tickIntervalMs);

  // Run first tick immediately
  processTick().catch((err) => {
    console.error('Error in initial CascadeEngine tick:', err);
  });
}

/**
 * Stop the cascade engine.
 */
function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('CascadeEngine stopped');
  }
}

/**
 * One tick of the cascade engine.
 * 
 * Algorithm:
 * 1. Query for active applicants who:
 *    a) Were promoted (promoted_at is set)
 *    b) Promoted time is older than their job's decay_window
 *    c) Have not acknowledged (no ACKNOWLEDGED event after promotion)
 * 2. For each found:
 *    a) Move to decayed_waitlisted
 *    b) Recalculate queue_position = max(current_waitlist_pos) + penalty_offset + 1
 *    c) Increment penalty_offset
 *    d) Log DECAYED event
 *    e) Call promoteNext(jobId) to bring up the next person
 */
async function processTick() {
  // Find candidates for decay
  const candidates = await pool.query(
    `SELECT 
      a.id,
      a.job_id,
      a.promoted_at,
      a.penalty_offset,
      a.queue_position,
      j.decay_window
    FROM applicants a
    JOIN jobs j ON a.job_id = j.id
    WHERE a.current_status = 'active'
      AND a.promoted_at IS NOT NULL
      AND (now() - a.promoted_at) > j.decay_window
      AND NOT EXISTS (
        SELECT 1 FROM pipeline_events pe
        WHERE pe.applicant_id = a.id
          AND pe.event_type = 'ACKNOWLEDGED'
          AND pe.created_at > a.promoted_at
      )
    ORDER BY a.promoted_at ASC`
  );

  if (candidates.rows.length === 0) {
    // No decay candidates; cascade is idling
    return;
  }

  console.log(`CascadeEngine: Found ${candidates.rows.length} decay candidates`);

  // Process each candidate
  for (const candidate of candidates.rows) {
    await processDecay(candidate);
  }
}

/**
 * Process one applicant's decay and subsequent promotion cascade.
 */
async function processDecay(candidate) {
  const { id, job_id, promoted_at, penalty_offset, queue_position } = candidate;

  return withJobLock(job_id, async (client) => {
    // Re-fetch to ensure no concurrent change
    const checkResult = await client.query(
      'SELECT * FROM applicants WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return;
    }

    const current = checkResult.rows[0];

    // Double-check: still active and hasn't acknowledged?
    if (current.current_status !== 'active') {
      return;
    }

    const acknowledgedResult = await client.query(
      `SELECT 1 FROM pipeline_events pe
       WHERE pe.applicant_id = $1
         AND pe.event_type = 'ACKNOWLEDGED'
         AND pe.created_at > $2
       LIMIT 1`,
      [id, promoted_at]
    );

    if (acknowledgedResult.rows.length > 0) {
      // They acknowledged; don't decay
      return;
    }

    // Calculate new queue position: go to back of waitlist + extra penalty
    const maxWaitlistResult = await client.query(
      `SELECT COALESCE(MAX(queue_position), 0) as max_pos
       FROM applicants
       WHERE job_id = $1
         AND current_status IN ('waitlisted', 'decayed_waitlisted')`,
      [job_id]
    );

    const maxWaitlistPos = parseInt(maxWaitlistResult.rows[0].max_pos, 10);
    const newQueuePosition = maxWaitlistPos + (penalty_offset * 5) + 1;
    const newPenaltyOffset = penalty_offset + 1;

    // Update applicant: move to decayed_waitlisted
    const decayResult = await client.query(
      `UPDATE applicants
       SET current_status = $1,
           queue_position = $2,
           penalty_offset = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      ['decayed_waitlisted', newQueuePosition, newPenaltyOffset, id]
    );

    const decayed = decayResult.rows[0];

    // Log DECAYED event
    await logPipelineEvent(
      client,
      job_id,
      id,
      'DECAYED',
      {
        prior_position: 'active',
        new_position: newQueuePosition,
        prior_queue_pos: queue_position,
        penalty_offset_before: penalty_offset,
        penalty_offset_after: newPenaltyOffset,
        cascade_depth: 1,
      }
    );

    console.log(`CascadeEngine: Decayed applicant ${id} (job ${job_id}), penalty now ${newPenaltyOffset}`);

    // Promote next person to fill the now-empty active slot
    await promoteNext(job_id, client);
  });
}

module.exports = {
  start,
  stop,
  processTick,
};
