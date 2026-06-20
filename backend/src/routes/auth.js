const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db/pool");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT id, email, password_hash, full_name FROM lecturers WHERE email = $1",
      [email.toLowerCase().trim()]
    );

    const lecturer = rows[0];

    // Always run bcrypt.compare even on a missing user, with a dummy hash,
    // so response timing doesn't reveal whether the email exists.
    const hashToCheck = lecturer ? lecturer.password_hash : "$2b$10$invalidsaltinvalidsaltinvalidsa.aaaaaaaaaaaaaaaaaaaaa";
    const passwordMatches = await bcrypt.compare(password, hashToCheck);

    if (!lecturer || !passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { sub: lecturer.id, email: lecturer.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    return res.json({
      token,
      lecturer: { id: lecturer.id, email: lecturer.email, fullName: lecturer.full_name },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Returns the currently authenticated lecturer, useful for the frontend to
// validate a stored token on page load without re-submitting credentials.
const { requireAuth } = require("../middleware/requireAuth");

router.get("/me", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, email, full_name FROM lecturers WHERE id = $1",
    [req.lecturer.id]
  );

  if (!rows[0]) {
    return res.status(404).json({ error: "Lecturer not found" });
  }

  return res.json({
    id: rows[0].id,
    email: rows[0].email,
    fullName: rows[0].full_name,
  });
});

module.exports = router;
