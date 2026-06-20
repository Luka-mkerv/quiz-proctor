const express = require("express");
const { pool } = require("../db/pool");

const router = express.Router();

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

// POST /api/public/quizzes/:id/start
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
router.post("/submissions/:submissionId/answers", async (req, res) => {
  const submissionId = Number(req.params.submissionId);
  if (!Number.isInteger(submissionId)) {
    return res.status(400).json({ error: "Invalid submission id" });
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
router.post("/submissions/:submissionId/submit", async (req, res) => {
  const submissionId = Number(req.params.submissionId);
  if (!Number.isInteger(submissionId)) {
    return res.status(400).json({ error: "Invalid submission id" });
  }

  try {
    const result = await pool.query(
      `SELECT s.id, s.submitted_at, q.duration_seconds, q.opened_at
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
    return res.json({
      submittedAt: updated.submitted_at,
      autoSubmitted: updated.auto_submitted,
    });
  } catch (err) {
    console.error("Submit error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
