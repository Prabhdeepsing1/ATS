require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { testConnection, shutdown } = require('./db/pool');
const { requestIdMiddleware, errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { start: startCascadeEngine, stop: stopCascadeEngine } = require('./engines/cascadeEngine');

const jobsRoutes = require('./routes/jobs');
const applicantsRoutes = require('./routes/applicants');

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

const app = express();

// ============================================================================
// Middleware
// ============================================================================

// Trust proxy for accurate client IPs
app.set('trust proxy', 1);

// CORS
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  })
);

// Body parser
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ limit: '10kb', extended: true }));

// Request ID
app.use(requestIdMiddleware);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${req.id}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`
    );
  });
  next();
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

/**
 * API routes
 */
app.use('/api/jobs', jobsRoutes);
app.use('/api/applicants', applicantsRoutes);

// ============================================================================
// Error Handling
// ============================================================================

app.use(notFoundHandler);
app.use(errorHandler);

// ============================================================================
// Server Startup & Shutdown
// ============================================================================

let server = null;

async function start() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error('Failed to connect to database. Exiting.');
      process.exit(1);
    }

    // Start the cascade engine (runs background decay checks every 5 minutes)
    startCascadeEngine(5 * 60 * 1000);

    // Start Express server
    server = app.listen(PORT, () => {
      console.log(`✓ QueueGate server listening on port ${PORT}`);
      console.log(`✓ Environment: ${NODE_ENV}`);
      console.log(`✓ API endpoints:`);
      console.log(`  POST   /api/jobs`);
      console.log(`  GET    /api/jobs/:jobId`);
      console.log(`  POST   /api/jobs/:jobId/apply`);
      console.log(`  GET    /api/jobs/:jobId/waitlist`);
      console.log(`  GET    /api/jobs/:jobId/events`);
      console.log(`  POST   /api/applicants/:id/acknowledge`);
      console.log(`  POST   /api/applicants/:id/exit`);
      console.log(`  GET    /api/applicants/:id/status`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  if (server) {
    server.close(async () => {
      console.log('✓ HTTP server closed');

      // Stop cascade engine
      stopCascadeEngine();

      // Close database connections
      const { shutdown: shutdownDb } = require('./db/pool');
      await shutdownDb();

      console.log('✓ Graceful shutdown complete');
      process.exit(0);
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      console.error('Graceful shutdown timeout. Force exiting.');
      process.exit(1);
    }, 30 * 1000);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// ============================================================================
// Start
// ============================================================================

start().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

module.exports = app;
