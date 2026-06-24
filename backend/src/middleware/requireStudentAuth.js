const jwt = require("jsonwebtoken");

function requireStudentAuth(req, res, next) {
  const header = req.headers.authorization;
  // Fall back to ?token query param for sendBeacon, which cannot set headers.
  const queryToken = req.query.token;

  let token;
  if (header && header.startsWith("Bearer ")) {
    token = header.slice("Bearer ".length);
  } else if (queryToken) {
    token = queryToken;
  }

  if (!token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload.sub || !payload.quizId || !payload.submissionId) {
      return res.status(401).json({ error: "Invalid token" });
    }
    req.student = {
      enrollmentId: payload.sub,
      email: payload.email,
      quizId: payload.quizId,
      submissionId: payload.submissionId,
    };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireStudentAuth };
