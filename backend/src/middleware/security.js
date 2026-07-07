const SAFE_METHODS = new Set(["GET", "HEAD"]);

// Since auth is JWT-in-header (not cookies), classic CSRF where the browser
// auto-attaches credentials doesn't apply here. This is a lightweight extra
// check: reject state-changing requests whose Origin/Referer is present and
// actively wrong. Absent headers (curl, Postman, native apps) are allowed
// through — "missing" isn't the same as "wrong", and blocking it would break
// legitimate non-browser clients for no real security gain.
function checkOrigin(allowedOrigins) {
  return function originCheckMiddleware(req, res, next) {
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    if (!origin && !referer) {
      return next();
    }

    let candidate;
    try {
      candidate = origin || new URL(referer).origin;
    } catch (err) {
      return res.status(403).json({ error: "Forbidden: invalid request origin" });
    }

    if (!allowedOrigins.includes(candidate)) {
      return res.status(403).json({ error: "Forbidden: invalid request origin" });
    }

    return next();
  };
}

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
}

module.exports = { checkOrigin, securityHeaders };
