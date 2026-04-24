const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/pool');
const { applyToJob, exitApplicant, promoteNext, logPipelineEvent } = require('../engines/pipelineEngine');
const { withJobLock, withApplicantLock } = require('../engines/lockManager');

const router = express.Router();

/**
 * POST /api/applicants/:id/acknowledge
 * Applicant acknowledges their promotion to active status
 */
router.post('/:id/acknowledge', async (req, res) => {
  try {
    const { id } = req.params;
    const requestId = req.id;

    // Get applicant
    const applicantResult = await pool.query(
      'SELECT * FROM applicants WHERE id = $1',
      [id]
    );

    if (applicantResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'APPLICANT_NOT_FOUND',
          message: 'Applicant does not exist',
        },
        meta: { request_id: requestId, timestamp: new Date().toISOString() },
      });
    }

    const applicant = applicantResult.rows[0];

    if (applicant.current_status !== 'active') {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'APPLICANT_NOT_ACTIVE',
          message: 'Only active applicants can acknowledge their promotion',
        },
        meta: { request_id: requestId, timestamp: new Date().toISOString() },
      });
    }

    // Log ACKNOWLEDGED event
    await logPipelineEvent(
      pool,
      applicant.job_id,
      id,
      'ACKNOWLEDGED',
      { acknowledged_at: new Date().toISOString() }
    );

    // No state change needed; event log shows acknowledgment

    return res.json({
      ok: true,
      data: {
        applicant_id: id,
        status: applicant.current_status,
        acknowledged: true,
      },
      meta: { request_id: requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error acknowledging applicant:', err);
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
      meta: { request_id: req.id, timestamp: new Date().toISOString() },
    });
  }
});

/**
 * POST /api/applicants/:id/exit
 * Exit an applicant (hired, withdrew, rejected)
 */
router.post('/:id/exit', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const requestId = req.id;

    if (!reason) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'MISSING_REASON',
          message: 'Exit reason is required',
        },
        meta: { request_id: requestId, timestamp: new Date().toISOString() },
      });
    }

    const result = await exitApplicant(id, reason);

    return res.json({
      ok: true,
      data: {
        applicant: result.applicant,
        event: result.event,
        promoted_next: result.promoted_next,
      },
      meta: { request_id: requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error exiting applicant:', err);

    if (err.message.includes('APPLICANT_NOT_FOUND')) {
      return res.status(404).json({
        ok: false,
        error: { code: 'APPLICANT_NOT_FOUND', message: err.message },
        meta: { request_id: req.id, timestamp: new Date().toISOString() },
      });
    }

    if (err.message.includes('INVALID_REASON')) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_REASON', message: err.message },
        meta: { request_id: req.id, timestamp: new Date().toISOString() },
      });
    }

    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
      meta: { request_id: req.id, timestamp: new Date().toISOString() },
    });
  }
});

/**
 * GET /api/applicants/:id/status
 * Get applicant's current status and queue position
 */
router.get('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const requestId = req.id;

    const result = await pool.query(
      `SELECT a.*, j.active_cap, j.decay_window
       FROM applicants a
       JOIN jobs j ON a.job_id = j.id
       WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'APPLICANT_NOT_FOUND',
          message: 'Applicant does not exist',
        },
        meta: { request_id: requestId, timestamp: new Date().toISOString() },
      });
    }

    const applicant = result.rows[0];

    // Get promotion event to calculate time in active status
    const promotionResult = await pool.query(
      `SELECT created_at FROM pipeline_events
       WHERE applicant_id = $1 AND event_type = 'PROMOTED'
       ORDER BY created_at DESC
       LIMIT 1`,
      [id]
    );

    const statusData = {
      applicant_id: id,
      name: applicant.name,
      email: applicant.email,
      status: applicant.current_status,
      queue_position: applicant.queue_position,
      penalty_offset: applicant.penalty_offset,
      promoted_at: applicant.promoted_at,
    };

    // Add decay info if active
    if (applicant.current_status === 'active' && applicant.promoted_at) {
      const decayDeadline = new Date(
        new Date(applicant.promoted_at).getTime() +
          parseDecayWindow(applicant.decay_window)
      );
      statusData.decay_deadline = decayDeadline.toISOString();
      statusData.time_until_decay_ms = Math.max(0, decayDeadline.getTime() - Date.now());
    }

    return res.json({
      ok: true,
      data: statusData,
      meta: { request_id: requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error getting applicant status:', err);
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
      meta: { request_id: req.id, timestamp: new Date().toISOString() },
    });
  }
});

/**
 * Helper: Convert PostgreSQL interval string to milliseconds
 * Examples: "48 hours", "2 days", "1 hour"
 */
function parseDecayWindow(intervalStr) {
  if (!intervalStr) return 48 * 60 * 60 * 1000; // Default 48h

  const match = intervalStr.match(/(\d+)\s+(\w+)/);
  if (!match) return 48 * 60 * 60 * 1000;

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  const msPerUnit = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  };

  return num * (msPerUnit[unit] || 48 * 60 * 60 * 1000);
}

module.exports = router;
