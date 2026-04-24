const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/pool');
const { applyToJob, promoteNext } = require('../engines/pipelineEngine');

const router = express.Router();

/**
 * POST /api/jobs
 * Create a new job opening
 */
router.post('/', async (req, res) => {
  try {
    const { company_id, title, description, active_cap, decay_window } = req.body;
    const requestId = req.id;

    // Validate required fields
    if (!company_id || !title || !active_cap) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'company_id, title, and active_cap are required',
        },
        meta: { request_id: requestId, timestamp: new Date().toISOString() },
      });
    }

    if (active_cap < 1) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_CAPACITY',
          message: 'active_cap must be at least 1',
        },
        meta: { request_id: requestId, timestamp: new Date().toISOString() },
      });
    }

    const jobId = uuidv4();
    const decayWindowStr = decay_window || '48 hours';

    const result = await pool.query(
      `INSERT INTO jobs (id, company_id, title, description, active_cap, decay_window)
       VALUES ($1, $2, $3, $4, $5, $6::interval)
       RETURNING *`,
      [jobId, company_id, title, description || null, active_cap, decayWindowStr]
    );

    const job = result.rows[0];

    return res.status(201).json({
      ok: true,
      data: job,
      meta: { request_id: requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error creating job:', err);
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
      meta: { request_id: req.id, timestamp: new Date().toISOString() },
    });
  }
});

/**
 * GET /api/jobs/:jobId
 * Get job details + current pipeline snapshot
 */
router.get('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const requestId = req.id;

    // Get job
    const jobResult = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);

    if (jobResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: { code: 'JOB_NOT_FOUND', message: 'Job does not exist' },
        meta: { request_id: requestId, timestamp: new Date().toISOString() },
      });
    }

    const job = jobResult.rows[0];

    // Get counts
    const countsResult = await pool.query(
      `SELECT
        current_status,
        COUNT(*) as count
       FROM applicants
       WHERE job_id = $1
       GROUP BY current_status`,
      [jobId]
    );

    const counts = {};
    countsResult.rows.forEach((row) => {
      counts[row.current_status] = row.count;
    });

    return res.json({
      ok: true,
      data: {
        job,
        pipeline_snapshot: {
          active: counts.active || 0,
          waitlisted: counts.waitlisted || 0,
          decayed_waitlisted: counts.decayed_waitlisted || 0,
          acknowledged: counts.acknowledged || 0,
          exited: counts.exited || 0,
        },
      },
      meta: { request_id: requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error getting job:', err);
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
      meta: { request_id: req.id, timestamp: new Date().toISOString() },
    });
  }
});

/**
 * POST /api/jobs/:jobId/apply
 * Submit an application to a job
 */
router.post('/:jobId/apply', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { name, email, phone } = req.body;
    const requestId = req.id;

    if (!name || !email) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'name and email are required',
        },
        meta: { request_id: requestId, timestamp: new Date().toISOString() },
      });
    }

    const result = await applyToJob(jobId, { name, email, phone });

    const statusCode = result.was_promoted ? 201 : 202;

    return res.status(statusCode).json({
      ok: true,
      data: {
        applicant: result.applicant,
        event: result.event,
        promoted: result.was_promoted,
      },
      meta: { request_id: requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error applying to job:', err);

    if (err.message.includes('JOB_NOT_FOUND')) {
      return res.status(404).json({
        ok: false,
        error: { code: 'JOB_NOT_FOUND', message: err.message },
        meta: { request_id: req.id, timestamp: new Date().toISOString() },
      });
    }

    if (err.message.includes('ALREADY_APPLIED')) {
      return res.status(409).json({
        ok: false,
        error: { code: 'ALREADY_APPLIED', message: err.message },
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
 * GET /api/jobs/:jobId/waitlist
 * Get ordered waitlist with positions
 */
router.get('/:jobId/waitlist', async (req, res) => {
  try {
    const { jobId } = req.params;
    const requestId = req.id;

    const result = await pool.query(
      `SELECT id, name, email, queue_position, penalty_offset, current_status
       FROM applicants
       WHERE job_id = $1 AND current_status IN ('waitlisted', 'decayed_waitlisted')
       ORDER BY penalty_offset ASC, queue_position ASC`,
      [jobId]
    );

    const waitlist = result.rows.map((row, index) => ({
      position: index + 1,
      applicant_id: row.id,
      name: row.name,
      email: row.email,
      queue_position: row.queue_position,
      penalty_offset: row.penalty_offset,
      status: row.current_status,
    }));

    return res.json({
      ok: true,
      data: { waitlist, total: waitlist.length },
      meta: { request_id: requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error getting waitlist:', err);
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
      meta: { request_id: req.id, timestamp: new Date().toISOString() },
    });
  }
});

/**
 * GET /api/jobs/:jobId/events
 * Full event log for a job (audit trail)
 */
router.get('/:jobId/events', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { limit = 100, offset = 0 } = req.query;
    const requestId = req.id;

    const limitNum = Math.min(parseInt(limit, 10) || 100, 1000);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    const result = await pool.query(
      `SELECT pe.*, a.name, a.email, a.current_status
       FROM pipeline_events pe
       JOIN applicants a ON pe.applicant_id = a.id
       WHERE pe.job_id = $1
       ORDER BY pe.created_at DESC
       LIMIT $2 OFFSET $3`,
      [jobId, limitNum, offsetNum]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM pipeline_events WHERE job_id = $1',
      [jobId]
    );

    const events = result.rows.map((row) => ({
      id: row.id,
      applicant_id: row.applicant_id,
      applicant_name: row.name,
      applicant_email: row.email,
      applicant_status: row.current_status,
      event_type: row.event_type,
      payload: row.payload,
      created_at: row.created_at,
    }));

    return res.json({
      ok: true,
      data: {
        events,
        pagination: {
          limit: limitNum,
          offset: offsetNum,
          total: parseInt(countResult.rows[0].total, 10),
        },
      },
      meta: { request_id: requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error getting events:', err);
    res.status(500).json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
      meta: { request_id: req.id, timestamp: new Date().toISOString() },
    });
  }
});

module.exports = router;
