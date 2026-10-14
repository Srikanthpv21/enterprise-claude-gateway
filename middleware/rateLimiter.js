const rateLimit = require('express-rate-limit');
const { getUserDailyUsage } = require('../services/dbService');

// Rate limit authentication attempts to prevent brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts from this IP. Please try again after 15 minutes.',
  },
});

// Rate limit conversation requests per user to prevent rapid spam or loops
const chatLimiter = rateLimit({
  windowMs: (parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES, 10) || 15) * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 60,
  standardHeaders: true,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    return req.user ? req.user.id : req.ip;
  },
  message: {
    error: 'Rate limit exceeded. You have sent too many requests recently. Please wait a few moments.',
  },
});

// Enforce daily token budget quota to prevent unexpected cost spikes
function checkDailyTokenQuota(req, res, next) {
  const dailyLimit = parseInt(process.env.DAILY_USER_TOKEN_LIMIT, 10) || 150000;
  if (!req.user) return next();

  // Admin users are exempt from the daily token limit
  if (req.user.role === 'admin') return next();

  const usage = getUserDailyUsage(req.user.id);
  if (usage.totalTokens >= dailyLimit) {
    return res.status(429).json({
      error: `Daily budget safety limit reached (${dailyLimit.toLocaleString()} tokens/day). Please try again tomorrow or contact your admin to raise your quota.`,
    });
  }

  next();
}

module.exports = {
  authLimiter,
  chatLimiter,
  checkDailyTokenQuota,
};
