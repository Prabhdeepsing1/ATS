const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/pool');
const { withJobLock } = require('./lockManager');

/**
 * PipelineEngine: The core state machine for the QueueGate system.
 * 
 * Every state change is an immutable event. Current state is derived from replaying history.
 * This is event sourcing, and it's architecturally correct for hiring pipelines because:
 * - Full auditability is free (requirement 6)
 * - State can be reconstructed at any point in time
 * - "What happened and why" is always clear
 */

/**
 * Log an event to the pipeline_events table.
 * All state changes go through this function to maintain the immutable event log.
 * 
 * @param {object} client - Database client (within a transaction)
 * @param {string} jobId - Job UUID
 * @param {string} applicantId - Applicant UUID
 * @param {string} eventType - Type of event (APPLIED, PROMOTED, ACKNOWLEDGED, EXITED, DECAYED)
 * @param {object} payload - Event metadata (reason, positions, etc.)
 * @returns {Promise<object>} The inserted event
 */
async function logPipelineEvent(client, jobId, applicantId, eventType, payload = {}) {
  const result = await client.query(
    `INSERT INTO pipeline_events (job_id, applicant_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING id, job_id, applicant_id, event_type, payload, created_at`,
    [jobId, applicantId, eventType, JSON.stringify(payload)]
  );
  return result.rows[0];
}

/**
 * Apply to a job: either get promoted immediately or enter the waitlist.
 * 
 * Algorithm:
 * 1. Acquire job lock (prevents double-promotion race condition)
 * 2. Count current active applicants for this job
 * 3. If count < active_cap: mark as active, promote immediately
 * 4. Else: mark as waitlisted, assign lowest available queue_position
 * 5. Log APPLIED event (or PROMOTED if direct)
 * 6. Release lock
 * 
 * @param {string} jobId - Job UUID
 * @param {object} applicantData - { name, email, phone? }
 * @returns {Promise<object>} { applicant, event, was_promoted }
 */
async function applyToJob(jobId, applicantData) {
  return withJobLock(jobId, async (client) => {
    const { name, email, phone } = applicantData;
    
    // Validate input
    if (!name || !email) {
      throw new Error('INVALID_APPLICATION: name and email are required');
    }

    // Check if applicant already applied to this job
    const existingCheck = await client.query(
      'SELECT id FROM applicants WHERE job_id = $1 AND email = $2',
      [jobId, email]
    );
    
    if (existingCheck.rows.length > 0) {
      throw new Error('ALREADY_APPLIED: applicant@email already applied to this job');
    }

    // Get job details (especially active_cap)
    const jobResult = await client.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (jobResult.rows.length === 0) {
      throw new Error('JOB_NOT_FOUND: job does not exist');
    }
    const job = jobResult.rows[0];

    // Count currently active applicants for this job
    const activeCountResult = await client.query(
      'SELECT COUNT(*) as count FROM applicants WHERE job_id = $1 AND current_status = $2',
      [jobId, 'active']
    );
    const activeCount = parseInt(activeCountResult.rows[0].count, 10);

    // Determine if applicant should be promoted immediately
    const shouldPromote = activeCount < job.active_cap;

    // Create applicant record
    const applicantId = uuidv4();
    const status = shouldPromote ? 'active' : 'waitlisted';
    let queuePosition = null;

    if (!shouldPromote) {
      // Get next available queue position
      const maxPosResult = await client.query(
        `SELECT COALESCE(MAX(queue_position), 0) as max_pos 
         FROM applicants 
         WHERE job_id = $1 AND current_status IN ('waitlisted', 'decayed_waitlisted')`,
        [jobId]
      );
      queuePosition = parseInt(maxPosResult.rows[0].max_pos, 10) + 1;
    }

    const applicantResult = await client.query(
      `INSERT INTO applicants (id, job_id, name, email, phone, current_status, queue_position, promoted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [applicantId, jobId, name, email, phone || null, status, queuePosition, shouldPromote ? new Date() : null]
    );
    const applicant = applicantResult.rows[0];

    // Log event
    const eventType = shouldPromote ? 'PROMOTED' : 'APPLIED';
    const event = await logPipelineEvent(
      client,
      jobId,
      applicantId,
      eventType,
      {
        initial_status: status,
        queue_position: queuePosition,
        active_count_at_time: activeCount,
        active_cap: job.active_cap,
      }
    );

    return {
      applicant,
      event,
      was_promoted: shouldPromote,
    };
  });
}

/**
 * Exit an applicant from the pipeline (hired, withdrew, rejected).
 * 
 * @param {string} applicantId - Applicant UUID
 * @param {string} reason - Exit reason (hired, withdrew, rejected)
 * @returns {Promise<object>} { applicant, event, promoted_next }
 */
async function exitApplicant(applicantId, reason) {
  // Validate reason
  if (!['hired', 'withdrew', 'rejected'].includes(reason)) {
    throw new Error('INVALID_REASON: reason must be hired, withdrew, or rejected');
  }

  // Get applicant to find job_id
  const applicantResult = await pool.query(
    'SELECT * FROM applicants WHERE id = $1',
    [applicantId]
  );

  if (applicantResult.rows.length === 0) {
    throw new Error('APPLICANT_NOT_FOUND');
  }

  const applicant = applicantResult.rows[0];
  const { job_id: jobId } = applicant;

  return withJobLock(jobId, async (client) => {
    // Update applicant status to exited
    const updateResult = await client.query(
      `UPDATE applicants SET current_status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      ['exited', applicantId]
    );

    const updatedApplicant = updateResult.rows[0];

    // Log exit event
    const event = await logPipelineEvent(
      client,
      jobId,
      applicantId,
      'EXITED',
      { reason }
    );

    // Try to promote the next person if this was an active person
    let promotedNext = null;
    if (updatedApplicant.current_status === 'active') {
      promotedNext = await promoteNext(jobId, client);
    }

    return {
      applicant: updatedApplicant,
      event,
      promoted_next: promotedNext,
    };
  });
}

/**
 * Promote the next applicant from the waitlist to active.
 * 
 * Algorithm:
 * 1. Check if we have room (active_count < active_cap)
 * 2. Find the top waitlisted applicant:
 *    - Lowest penalty_offset (repeats less often)
 *    - Then lowest queue_position (been waiting longest)
 * 3. Update status to active, set promoted_at = now()
 * 4. Reset queue_position to NULL
 * 5. Log PROMOTED event
 * 6. Return the promoted applicant
 * 
 * Note: This function should be called WITHIN a withJobLock() context.
 * It can take an optional client parameter; if not provided, it manages its own lock.
 * 
 * @param {string} jobId - Job UUID
 * @param {object} [clientOverride] - Optional client (for use within a lock context)
 * @returns {Promise<object>} The promoted applicant, or null if no promotion occurred
 */
async function promoteNext(jobId, clientOverride = null) {
  const executePromotion = async (client) => {
    // Get job to check active_cap
    const jobResult = await client.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (jobResult.rows.length === 0) {
      throw new Error('JOB_NOT_FOUND');
    }
    const job = jobResult.rows[0];

    // Count active applicants
    const activeCountResult = await client.query(
      'SELECT COUNT(*) as count FROM applicants WHERE job_id = $1 AND current_status = $2',
      [jobId, 'active']
    );
    const activeCount = parseInt(activeCountResult.rows[0].count, 10);

    // If at capacity, nothing to promote
    if (activeCount >= job.active_cap) {
      return null;
    }

    // Find top waitlisted applicant (prioritize by penalty_offset, then queue_position)
    const candidateResult = await client.query(
      `SELECT * FROM applicants
       WHERE job_id = $1 AND current_status IN ('waitlisted', 'decayed_waitlisted')
       ORDER BY penalty_offset ASC, queue_position ASC
       LIMIT 1`,
      [jobId]
    );

    if (candidateResult.rows.length === 0) {
      return null; // No one to promote
    }

    const candidate = candidateResult.rows[0];
    const prior_position = candidate.queue_position;

    // Promote to active
    const promoteResult = await client.query(
      `UPDATE applicants
       SET current_status = $1, promoted_at = NOW(), queue_position = NULL, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      ['active', candidate.id]
    );

    const promoted = promoteResult.rows[0];

    // Log promotion event
    await logPipelineEvent(
      client,
      jobId,
      candidate.id,
      'PROMOTED',
      {
        prior_position,
        reason: 'waitlist_promotion',
        active_count_before: activeCount,
      }
    );

    return promoted;
  };

  // If client is provided, we're already in a lock context
  if (clientOverride) {
    return executePromotion(clientOverride);
  }

  // Otherwise, acquire lock ourselves
  return withJobLock(jobId, executePromotion);
}

module.exports = {
  applyToJob,
  exitApplicant,
  promoteNext,
  logPipelineEvent,
};
