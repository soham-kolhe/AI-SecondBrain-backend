const rateLimitWindowMs = 15 * 60 * 1000; // 15 minutes

// Memory store for request logs: IP -> Array of timestamps
const askRequests = new Map();
const ingestRequests = new Map();

// Helper to check rate limit
const checkLimit = (store, limit, ip) => {
  const now = Date.now();
  if (!store.has(ip)) {
    store.set(ip, []);
  }

  const timestamps = store.get(ip);
  // Filter timestamps within the current 15 min window
  const validTimestamps = timestamps.filter(t => now - t < rateLimitWindowMs);
  
  if (validTimestamps.length >= limit) {
    return false;
  }

  validTimestamps.push(now);
  store.set(ip, validTimestamps);
  return true;
};

// Cleanup routine to avoid memory leak
const cleanupStore = (store) => {
  const now = Date.now();
  for (const [ip, timestamps] of store.entries()) {
    const valid = timestamps.filter(t => now - t < rateLimitWindowMs);
    if (valid.length === 0) {
      store.delete(ip);
    } else {
      store.set(ip, valid);
    }
  }
};

// Clean up memory every 15 minutes
setInterval(() => {
  cleanupStore(askRequests);
  cleanupStore(ingestRequests);
}, rateLimitWindowMs);

exports.askLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const isAllowed = checkLimit(askRequests, 100, ip); // 100 requests per 15 mins
  if (!isAllowed) {
    return res.status(429).json({
      error: "Too many questions asked. Please try again after 15 minutes.",
      code: "RATE_LIMIT_EXCEEDED"
    });
  }
  next();
};

exports.ingestLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const isAllowed = checkLimit(ingestRequests, 10, ip); // 10 file uploads/ingests per 15 mins
  if (!isAllowed) {
    return res.status(429).json({
      error: "Too many file ingest attempts. Please try again after 15 minutes.",
      code: "RATE_LIMIT_EXCEEDED"
    });
  }
  next();
};
