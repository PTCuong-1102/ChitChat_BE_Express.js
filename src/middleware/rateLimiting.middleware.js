import rateLimit from 'express-rate-limit';

// General API rate limit
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Strict rate limit cho auth endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 login requests per windowMs
  message: {
    error: 'Too many login attempts, please try again later.'
  },
  skipSuccessfulRequests: true
});

// Message sending rate limit
export const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 messages per minute per user
  message: {
    error: 'Too many messages sent, please slow down.'
  },
  keyGenerator: (req) => {
    // Use user ID if available, otherwise fall back to default IP handling
    return req.user?._id?.toString() || 'anonymous';
  },
  // Skip IP-based limiting when user is authenticated
  skip: (req) => !!req.user?._id
});