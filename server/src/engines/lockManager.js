const { pool } = require('../db/pool');

/**
 * Convert UUID to a 32-bit signed integer for PostgreSQL advisory locks.
 * Takes the first 8 hex characters of the UUID (without dashes) and converts to int.
 * This ensures deterministic, collision-resistant lock keys for UUID-based resources.
 * 
 * @param {string} uuid - The UUID string (with or without dashes)
 * @returns {number} A 32-bit signed integer suitable for pg_advisory_xact_lock
 */
function uuidToLockKey(uuid) {
  if (!uuid || typeof uuid !== 'string') {
    throw new Error('Invalid UUID provided to uuidToLockKey');
  }
  const cleanUuid = uuid.replace(/-/g, '');
  const lockKey = parseInt(cleanUuid.substring(0, 8), 16);
  
  // Ensure it's within 32-bit signed integer range
  if (lockKey > 2147483647) {
    return lockKey - 4294967296; // Convert to signed
  }
  return lockKey;
}

/**
 * Execute a function within an advisory lock scope for a job.
 * 
 * This uses PostgreSQL's transaction-scoped advisory locks to serialize access
 * to job-specific resources. The lock is held for the duration of the transaction.
 * 
 * Race condition scenario solved:
 * - Two concurrent POST /apply requests arrive for the last active slot
 * - Both call withJobLock(jobId, ...)
 * - PostgreSQL's lock queue serializes them at the database level
 * - First request sees active_count = 4, cap = 5 → gets promoted to active
 * - First transaction commits and releases the lock
 * - Second request then sees active_count = 5, cap = 5 → goes to waitlist
 * - No double-promotion is possible
 * 
 * @param {string} jobId - The UUID of the job to lock
 * @param {Function} fn - Async function to execute within the lock
 * @returns {Promise} Result of the provided function
 * @throws {Error} If lock cannot be acquired or transaction fails
 */
async function withJobLock(jobId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    
    const lockKey = uuidToLockKey(jobId);
    
    // Acquire advisory lock - blocks if another transaction holds it
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
    
    // Execute the provided function within the locked transaction
    const result = await fn(client);
    
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Error during rollback:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute a function within an advisory lock scope for an applicant.
 * Useful for operations that need applicant-level consistency.
 * 
 * @param {string} applicantId - The UUID of the applicant to lock
 * @param {Function} fn - Async function to execute within the lock
 * @returns {Promise} Result of the provided function
 */
async function withApplicantLock(applicantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    
    const lockKey = uuidToLockKey(applicantId);
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
    
    const result = await fn(client);
    
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Error during rollback:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  withJobLock,
  withApplicantLock,
  uuidToLockKey,
};
