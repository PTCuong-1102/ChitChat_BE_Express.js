import rateLimit from 'express-rate-limit';

// SỬA LỖI: Create store for tracking rate limit data
const rateLimitStore = new Map();

// Helper function to create rate limiter with custom store
const createRateLimiter = (options) => {
  return rateLimit({
    ...options,
    // Add skip function for health checks and development
    skip: (req, res) => {
      // Skip rate limiting for health check endpoints
      if (req.path === '/health' || req.path === '/api/health') {
        return true;
      }
      
      // Skip rate limiting in development mode
      if (process.env.NODE_ENV === 'development') {
        return true;
      }
      
      // Call original skip function if provided
      return options.skip ? options.skip(req, res) : false;
    }
  });
};

// SỬA LỖI: More reasonable general API rate limit for production
export const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Increased to 500 requests per 15 minutes (better for active users)
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Custom key generator for better distribution in production
  keyGenerator: (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.connection.remoteAddress;
    return `${ip}-api`;
  }
});

// SỬA LỖI: More reasonable auth rate limit for production
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Allow 50 login attempts per IP per 15 minutes (more reasonable for shared IPs)
  message: {
    error: 'Too many login attempts, please try again later.'
  },
  skipSuccessfulRequests: true, // Don't count successful logins
  skipFailedRequests: false, // Count failed attempts to prevent brute force
  // Add custom key generator for better handling in production
  keyGenerator: (req) => {
    // Use combination of IP and user agent for better distribution
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.connection.remoteAddress;
    return `${ip}-auth`;
  }
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