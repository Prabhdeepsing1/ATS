const { v4: uuidv4 } = require('uuid');

/**
 * Middleware: Attach a unique request ID to each request
 */
function requestIdMiddleware(req, res, next) {
  req.id = uuidv4();
  res.set('X-Request-ID', req.id);
  next();
}

/**
 * Middleware: Global error handler
 * Must be registered last in Express middleware chain
 */
function errorHandler(err, req, res, next) {
  console.error('[Error Handler]', {
    request_id: req.id,
    error: err.message,
    stack: err.stack,
  });

  const requestId = req.id || uuidv4();
  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    ok: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
    },
    meta: {
      request_id: requestId,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Middleware: 404 handler for undefined routes
 */
function notFoundHandler(req, res) {
  const requestId = req.id || uuidv4();

  res.status(404).json({
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
    meta: {
      request_id: requestId,
      timestamp: new Date().toISOString(),
    },
  });
}

module.exports = {
  requestIdMiddleware,
  errorHandler,
  notFoundHandler,
};
