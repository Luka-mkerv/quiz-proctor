const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db/pool");
const { requireStudentAuth } = require("../middleware/requireStudentAuth");
const { restoreDatabase, dropDatabase } = require("../db/sqlServerOps");

const router = express.Router();

// Used for timing-safe comparison when no enrollment row exists.
const DUMMY_HASH = "$2b$10$invalidsaltinvalidsaltinvalidsa.aaaaaaaaaaaaaaaaaaaaa";

// GET /api/public/quizzes/:id
router.get("/quizzes/:id", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }

  try {
    const quizResult = await pool.query(
      `SELECT id, title, status, duration_seconds, monitoring_mode FROM quizzes WHERE id = $1`,
      [quizId]
    );
    const quiz = quizResult.rows[0];

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }
    if (quiz.status !== "open") {
      return res.status(403).json({ error: "This quiz is not currently open" });
    }

    const questionsResult = await pool.query(
      `SELECT id, prompt FROM questions WHERE quiz_id = $1 ORDER BY question_order ASC`,
      [quizId]
    );

    return res.json({
      id: quiz.id,
      title: quiz.title,
      durationSeconds: quiz.duration_seconds,
      monitoringMode: quiz.monitoring_mode,
      questions: questionsResult.rows,
    });
  } catch (err) {
    console.error("Get public quiz error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/public/quizzes/:id/login
// Body: { email, password }
// Authenticates a student against the quiz's enrollment list and returns
// a short-lived student JWT + the submission to use for this attempt.
router.post("/quizzes/:id/login", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const quizResult = await pool.query(
      `SELECT id, status, duration_seconds FROM quizzes WHERE id = $1`,
      [quizId]
    );
    const quiz = quizResult.rows[0];

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }
    if (quiz.status !== "open") {
      return res.status(403).json({ error: "This exam is not currently open" });
    }

    const enrollmentResult = await pool.query(
      `SELECT id, student_email, password_hash, full_name
       FROM quiz_enrollments
       WHERE quiz_id = $1 AND LOWER(student_email) = LOWER($2)`,
      [quizId, email.trim()]
    );
    const enrollment = enrollmentResult.rows[0];

    // Always run bcrypt even when no enrollment found, to prevent timing attacks.
    const hashToCheck = enrollment ? enrollment.password_hash : DUMMY_HASH;
    const passwordMatches = await bcrypt.compare(password, hashToCheck);

    if (!enrollment || !passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Check for an existing submission linked to this enrollment.
    const submissionResult = await pool.query(
      `SELECT id, started_at, submitted_at, sandbox_db_name FROM submissions WHERE enrollment_id = $1`,
      [enrollment.id]
    );
    const existing = submissionResult.rows[0];

    let submissionId;
    let startedAt;
    let sandboxDbName = null;

    if (existing) {
      if (existing.submitted_at !== null) {
        return res.status(401).json({ error: "You have already submitted this exam" });
      }
      // Resume in-progress attempt (e.g. student refreshed the page).
      submissionId = existing.id;
      startedAt = existing.started_at;
      sandboxDbName = existing.sandbox_db_name;
    } else {
      // First login — create the submission.
      // ON CONFLICT handles the edge case where a legacy test submission already
      // used this email as student_name; in that case we link the enrollment.
      const insertResult = await pool.query(
        `INSERT INTO submissions (quiz_id, student_name, enrollment_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (quiz_id, student_name)
         DO UPDATE SET enrollment_id = EXCLUDED.enrollment_id
         WHERE submissions.enrollment_id IS NULL
         RETURNING id, started_at`,
        [quizId, enrollment.student_email, enrollment.id]
      );
      submissionId = insertResult.rows[0].id;
      startedAt = insertResult.rows[0].started_at;
    }

    // Check if this quiz has a ready database extension.
    const extResult = await pool.query(
      `SELECT backup_file_path, template_db_name
       FROM quiz_db_extensions
       WHERE quiz_id = $1 AND status = 'ready'`,
      [quizId]
    );
    const ext = extResult.rows[0];

    const hasDatabaseExtension = Boolean(ext);

    if (ext && !sandboxDbName) {
      // Provision a fresh sandbox for this student. Synchronous — ~270ms for small
      // databases, a few seconds for large ones. Students wait for this before
      // getting their token, which is acceptable given the UX context.
      const newSandboxName = `sandbox_${submissionId}`;
      try {
        await restoreDatabase(ext.backup_file_path, newSandboxName);
        await pool.query(
          "UPDATE submissions SET sandbox_db_name = $1 WHERE id = $2",
          [newSandboxName, submissionId]
        );
        sandboxDbName = newSandboxName;
      } catch (err) {
        console.error(`Sandbox provision failed for submission ${submissionId}:`, err);
        // Non-fatal: student can still sit the exam without the SQL extension.
        // A retry on page refresh will attempt provisioning again.
      }
    }

    const token = jwt.sign(
      {
        sub: enrollment.id,
        email: enrollment.student_email,
        quizId,
        submissionId,
      },
      process.env.JWT_SECRET,
      { expiresIn: "6h" }
    );

    return res.json({
      token,
      studentEmail: enrollment.student_email,
      submissionId,
      quizId,
      durationSeconds: quiz.duration_seconds,
      startedAt,
      hasDatabaseExtension,
      sandboxDbName,
    });
  } catch (err) {
    console.error("Student login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/public/quizzes/:id/start
// Legacy name-based entry — kept for backwards compatibility with existing test flows.
// Body: { studentName: string }
router.post("/quizzes/:id/start", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }

  const { studentName } = req.body;
  if (!studentName || typeof studentName !== "string" || !studentName.trim()) {
    return res.status(400).json({ error: "studentName is required" });
  }

  const trimmedName = studentName.trim();

  try {
    const quizResult = await pool.query(
      `SELECT id, status, duration_seconds FROM quizzes WHERE id = $1`,
      [quizId]
    );
    const quiz = quizResult.rows[0];

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }
    if (quiz.status !== "open") {
      return res.status(403).json({ error: "This quiz is not currently open" });
    }

    // Insert and skip on conflict so we can inspect the existing row ourselves.
    const insertResult = await pool.query(
      `INSERT INTO submissions (quiz_id, student_name)
       VALUES ($1, $2)
       ON CONFLICT (quiz_id, student_name) DO NOTHING
       RETURNING id, started_at`,
      [quizId, trimmedName]
    );

    if (insertResult.rows.length > 0) {
      const row = insertResult.rows[0];
      return res.status(201).json({
        submissionId: row.id,
        startedAt: row.started_at,
        durationSeconds: quiz.duration_seconds,
      });
    }

    // Conflict: a row already exists for this quiz + student name.
    const existingResult = await pool.query(
      `SELECT id, started_at, submitted_at FROM submissions
       WHERE quiz_id = $1 AND student_name = $2`,
      [quizId, trimmedName]
    );
    const existing = existingResult.rows[0];

    if (existing.submitted_at !== null) {
      return res.status(409).json({ error: "You have already submitted this quiz." });
    }

    // In-progress attempt exists — return its id so the student can resume.
    return res.json({
      submissionId: existing.id,
      startedAt: existing.started_at,
      durationSeconds: quiz.duration_seconds,
    });
  } catch (err) {
    console.error("Start submission error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/public/submissions/:submissionId/answers
// Body: { questionId: number, answerText: string }
// Autosave per question — safe to call repeatedly; upserts on the unique constraint.
router.post("/submissions/:submissionId/answers", requireStudentAuth, async (req, res) => {
  const submissionId = Number(req.params.submissionId);
  if (!Number.isInteger(submissionId)) {
    return res.status(400).json({ error: "Invalid submission id" });
  }

  if (submissionId !== req.student.submissionId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { questionId, answerText } = req.body;
  const qId = Number(questionId);
  if (!Number.isInteger(qId) || qId <= 0) {
    return res.status(400).json({ error: "questionId must be a positive integer" });
  }
  if (typeof answerText !== "string") {
    return res.status(400).json({ error: "answerText must be a string" });
  }

  try {
    const submissionResult = await pool.query(
      `SELECT s.id, s.submitted_at, s.quiz_id FROM submissions s WHERE s.id = $1`,
      [submissionId]
    );
    const submission = submissionResult.rows[0];

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (submission.submitted_at !== null) {
      return res.status(400).json({ error: "This submission has already been submitted" });
    }

    // Verify the question belongs to this submission's quiz.
    const questionCheck = await pool.query(
      `SELECT id FROM questions WHERE id = $1 AND quiz_id = $2`,
      [qId, submission.quiz_id]
    );
    if (!questionCheck.rows[0]) {
      return res.status(400).json({ error: "Question does not belong to this quiz" });
    }

    await pool.query(
      `INSERT INTO answers (submission_id, question_id, answer_text)
       VALUES ($1, $2, $3)
       ON CONFLICT (submission_id, question_id) DO UPDATE SET answer_text = EXCLUDED.answer_text`,
      [submissionId, qId, answerText]
    );

    return res.json({ saved: true });
  } catch (err) {
    console.error("Save answer error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/public/submissions/:submissionId/submit
// Body: { autoSubmitted?: boolean }
router.post("/submissions/:submissionId/submit", requireStudentAuth, async (req, res) => {
  const submissionId = Number(req.params.submissionId);
  if (!Number.isInteger(submissionId)) {
    return res.status(400).json({ error: "Invalid submission id" });
  }

  if (submissionId !== req.student.submissionId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const result = await pool.query(
      `SELECT s.id, s.submitted_at, s.sandbox_db_name, q.duration_seconds, q.opened_at
       FROM submissions s
       JOIN quizzes q ON q.id = s.quiz_id
       WHERE s.id = $1`,
      [submissionId]
    );
    const submission = result.rows[0];

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (submission.submitted_at !== null) {
      return res.status(400).json({ error: "This submission has already been submitted" });
    }

    let isAutoSubmitted = Boolean(req.body.autoSubmitted);

    // Server-side enforcement: override to true if the student is past the deadline,
    // regardless of what the client reported.
    if (submission.duration_seconds !== null && submission.opened_at !== null) {
      const deadline = new Date(submission.opened_at).getTime() + submission.duration_seconds * 1000;
      if (Date.now() > deadline) {
        isAutoSubmitted = true;
      }
    }

    const updateResult = await pool.query(
      `UPDATE submissions
       SET submitted_at = now(), auto_submitted = $2
       WHERE id = $1
       RETURNING submitted_at, auto_submitted`,
      [submissionId, isAutoSubmitted]
    );

    const updated = updateResult.rows[0];
    res.json({
      submittedAt: updated.submitted_at,
      autoSubmitted: updated.auto_submitted,
    });

    // Drop the student's sandbox after the response is sent — instant for SQL Server
    // but we don't want any DROP latency in the student's "submitted" screen.
    if (submission.sandbox_db_name) {
      dropDatabase(submission.sandbox_db_name).catch((err) => {
        console.error(`Failed to drop sandbox ${submission.sandbox_db_name}:`, err);
      });
    }
  } catch (err) {
    console.error("Submit error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
