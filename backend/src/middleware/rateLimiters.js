const rateLimit = require("express-rate-limit");

const isProduction = process.env.NODE_ENV === "production";

// Applied globally to every route. In development this would otherwise make
// routine local testing (repeated curl calls, frontend hot-reload polling,
// etc.) annoying, so it logs instead of blocking unless NODE_ENV=production.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    if (!isProduction) {
      console.warn(`[rate-limit] (dev, not enforced) ${req.method} ${req.originalUrl} from ${req.ip}`);
      return true;
    }
    return false;
  },
  message: { error: "Too many requests, please try again later." },
});

// Lecturer + student login. Protects a real security boundary (credential
// brute-forcing), so this stays fully active in development too.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts. Please wait 15 minutes before trying again." },
});

// SQL execution during an exam. Always active — this is what stops a student
// from scripting queries against their sandbox.
const executeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Query rate limit exceeded. Please wait before running another query." },
});

// Quiz creation. Always active.
const createQuizLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many quizzes created. Please wait before creating another." },
});

module.exports = { globalLimiter, loginLimiter, executeLimiter, createQuizLimiter };
