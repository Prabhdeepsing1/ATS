const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://queuegate:queuegate@localhost:5432/queuegate',
  max: parseInt(process.env.DB_POOL_SIZE || '20'),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000'),
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Test connection on startup
async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('✓ Database connection successful at', result.rows[0].now);
    client.release();
    return true;
  } catch (err) {
    console.error('✗ Database connection failed:', err.message);
    return false;
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('Closing database connections...');
  await pool.end();
  console.log('✓ Database pool closed');
}

module.exports = {
  pool,
  testConnection,
  shutdown,
  // Helper for query with typed response
  query: (text, params) => pool.query(text, params),
};
