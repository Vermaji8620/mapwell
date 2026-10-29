export function errorHandler(err, req, res, next) {
  console.error(`[API Error] ${req.method} ${req.url}:`, err);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      error: 'Validation Error',
      details: errors
    });
  }

  // CastError (e.g. invalid ID format)
  if (err.name === 'CastError') {
    return res.status(400).json({
      error: 'Invalid ID Format',
      message: `Invalid value for ${err.path}: ${err.value}`
    });
  }

  // Duplicate key error (E11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];
    return res.status(409).json({
      error: 'Conflict',
      message: `A record with this ${field} already exists.`
    });
  }

  // Default server error
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
}
