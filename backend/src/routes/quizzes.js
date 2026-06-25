const express = require("express");
const bcrypt = require("bcrypt");
const { pool } = require("../db/pool");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

router.use(requireAuth);

// Create a quiz with its questions in one call.
// Body: { title: string, durationSeconds?: number, questions: [{ prompt: string }] }
router.post("/", async (req, res) => {
  const { title, durationSeconds, questions, monitoringMode } = req.body;

  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "title is required" });
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: "questions must be a non-empty array" });
  }
  for (const q of questions) {
    if (!q.prompt || typeof q.prompt !== "string") {
      return res.status(400).json({ error: "each question requires a non-empty prompt" });
    }
    if (q.max_points !== undefined) {
      const mp = Number(q.max_points);
      if (!isFinite(mp) || mp < 1 || mp > 100) {
        return res.status(400).json({ error: "max_points must be between 1 and 100" });
      }
    }
  }

  const resolvedMode =
    monitoringMode === "strict" || monitoringMode === "lenient" ? monitoringMode : "lenient";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const quizResult = await client.query(
      `INSERT INTO quizzes (lecturer_id, title, duration_seconds, monitoring_mode)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, status, duration_seconds, monitoring_mode, created_at`,
      [req.lecturer.id, title.trim(), durationSeconds || null, resolvedMode]
    );
    const quiz = quizResult.rows[0];

    const insertedQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      const { rows } = await client.query(
        `INSERT INTO questions (quiz_id, prompt, question_order, max_points)
         VALUES ($1, $2, $3, $4)
         RETURNING id, prompt, question_order, max_points`,
        [quiz.id, questions[i].prompt.trim(), i, Number(questions[i].max_points) || 10]
      );
      insertedQuestions.push(rows[0]);
    }

    await client.query("COMMIT");

    return res.status(201).json({ ...quiz, questions: insertedQuestions });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create quiz error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// List all quizzes belonging to the authenticated lecturer.
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, status, duration_seconds, opened_at, closed_at, created_at
       FROM quizzes
       WHERE lecturer_id = $1
       ORDER BY created_at DESC`,
      [req.lecturer.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error("List quizzes error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Full detail of one quiz, including its questions, scoped to the owning lecturer.
router.get("/:id", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }

  try {
    const quizResult = await pool.query(
      `SELECT id, title, status, duration_seconds, monitoring_mode, opened_at, closed_at, created_at
       FROM quizzes WHERE id = $1 AND lecturer_id = $2`,
      [quizId, req.lecturer.id]
    );
    const quiz = quizResult.rows[0];
    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const questionsResult = await pool.query(
      `SELECT id, prompt, question_order FROM questions
       WHERE quiz_id = $1 ORDER BY question_order ASC`,
      [quizId]
    );

    return res.json({ ...quiz, questions: questionsResult.rows });
  } catch (err) {
    console.error("Get quiz error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Full results for one quiz: questions + all submissions with answers and violations.
router.get("/:id/results", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }

  try {
    const ownerCheck = await pool.query(
      `SELECT id FROM quizzes WHERE id = $1 AND lecturer_id = $2`,
      [quizId, req.lecturer.id]
    );
    if (!ownerCheck.rows[0]) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const [questionsResult, submissionsResult, answersResult, violationsResult] =
      await Promise.all([
        pool.query(
          `SELECT id, prompt, question_order, max_points
           FROM questions
           WHERE quiz_id = $1
           ORDER BY question_order ASC`,
          [quizId]
        ),
        pool.query(
          `SELECT id, student_name, started_at, submitted_at, auto_submitted
           FROM submissions
           WHERE quiz_id = $1
           ORDER BY submitted_at ASC NULLS LAST`,
          [quizId]
        ),
        // CROSS JOIN ensures every submission gets a row for every question,
        // even if the student never typed an answer for it.
        pool.query(
          `SELECT s.id AS submission_id,
                  q.id AS question_id,
                  COALESCE(a.answer_text, '') AS answer_text,
                  g.points,
                  g.notes
           FROM submissions s
           CROSS JOIN questions q
           LEFT JOIN answers a ON a.submission_id = s.id AND a.question_id = q.id
           LEFT JOIN grades g ON g.submission_id = s.id AND g.question_id = q.id
           WHERE s.quiz_id = $1 AND q.quiz_id = $1
           ORDER BY s.id, q.question_order`,
          [quizId]
        ),
        pool.query(
          `SELECT v.submission_id, v.event_type AS type, v.occurred_at
           FROM violations v
           JOIN submissions s ON s.id = v.submission_id
           WHERE s.quiz_id = $1
           ORDER BY v.submission_id, v.occurred_at ASC`,
          [quizId]
        ),
      ]);

    const answersBySubmission = new Map();
    for (const row of answersResult.rows) {
      if (!answersBySubmission.has(row.submission_id)) {
        answersBySubmission.set(row.submission_id, []);
      }
      answersBySubmission.get(row.submission_id).push({
        question_id: row.question_id,
        answer_text: row.answer_text,
        points: row.points,
        notes: row.notes,
      });
    }

    const violationsBySubmission = new Map();
    for (const row of violationsResult.rows) {
      if (!violationsBySubmission.has(row.submission_id)) {
        violationsBySubmission.set(row.submission_id, []);
      }
      violationsBySubmission.get(row.submission_id).push({
        type: row.type,
        occurred_at: row.occurred_at,
      });
    }

    const totalPossible = questionsResult.rows.reduce(
      (sum, q) => sum + parseFloat(q.max_points),
      0
    );

    const submissions = submissionsResult.rows.map((s) => {
      const violations = violationsBySubmission.get(s.id) || [];
      const answers = answersBySubmission.get(s.id) || [];
      const gradedAnswers = answers.filter((a) => a.points !== null);
      const total_points_awarded =
        gradedAnswers.length > 0
          ? gradedAnswers.reduce((sum, a) => sum + parseFloat(a.points), 0)
          : null;
      return {
        id: s.id,
        student_name: s.student_name,
        started_at: s.started_at,
        submitted_at: s.submitted_at,
        auto_submitted: s.auto_submitted,
        answers,
        violations,
        violation_count: violations.length,
        total_points_awarded,
        total_points_possible: totalPossible,
      };
    });

    return res.json({ questions: questionsResult.rows, submissions });
  } catch (err) {
    console.error("Get quiz results error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/quizzes/:id/grades
// Body: { submissionId, questionId, points, notes? }
// Upserts a grade for one question on one submission.
router.post("/:id/grades", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }

  const { submissionId, questionId, points, notes } = req.body;

  if (!Number.isInteger(Number(submissionId)) || !Number.isInteger(Number(questionId))) {
    return res.status(400).json({ error: "submissionId and questionId must be integers" });
  }
  if (typeof points !== "number" || !isFinite(points)) {
    return res.status(400).json({ error: "points must be a finite number" });
  }

  const subId = Number(submissionId);
  const qId = Number(questionId);

  try {
    const ownerCheck = await pool.query(
      "SELECT id FROM quizzes WHERE id = $1 AND lecturer_id = $2",
      [quizId, req.lecturer.id]
    );
    if (!ownerCheck.rows[0]) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const submissionCheck = await pool.query(
      "SELECT id FROM submissions WHERE id = $1 AND quiz_id = $2",
      [subId, quizId]
    );
    if (!submissionCheck.rows[0]) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const questionCheck = await pool.query(
      "SELECT max_points FROM questions WHERE id = $1 AND quiz_id = $2",
      [qId, quizId]
    );
    if (!questionCheck.rows[0]) {
      return res.status(404).json({ error: "Question not found" });
    }

    const maxPoints = parseFloat(questionCheck.rows[0].max_points);
    if (points < 0 || points > maxPoints) {
      return res.status(400).json({ error: `points must be between 0 and ${maxPoints}` });
    }

    const { rows } = await pool.query(
      `INSERT INTO grades (submission_id, question_id, points, notes, graded_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (submission_id, question_id)
       DO UPDATE SET
         points     = EXCLUDED.points,
         notes      = EXCLUDED.notes,
         graded_by  = EXCLUDED.graded_by,
         graded_at  = now()
       RETURNING id, submission_id, question_id, points, notes, graded_at`,
      [subId, qId, points, notes || null, req.lecturer.id]
    );

    return res.json(rows[0]);
  } catch (err) {
    console.error("Grade submission error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a quiz and all cascading data (questions, submissions, answers, violations).
// ON DELETE CASCADE foreign keys in migrations 003 and 004 handle the cleanup.
router.delete("/:id", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }

  try {
    const { rowCount } = await pool.query(
      "DELETE FROM quizzes WHERE id = $1 AND lecturer_id = $2",
      [quizId, req.lecturer.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Quiz not found" });
    }
    return res.status(204).send();
  } catch (err) {
    console.error("Delete quiz error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Lock / open / close a quiz. This is the toggle the lecturer dashboard uses.
// Body: { status: "locked" | "open" | "closed" }
router.patch("/:id/status", async (req, res) => {
  const quizId = Number(req.params.id);
  const { status } = req.body;

  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }
  if (!["locked", "open", "closed"].includes(status)) {
    return res.status(400).json({ error: "status must be one of: locked, open, closed" });
  }

  try {
    const ownerCheck = await pool.query(
      "SELECT id FROM quizzes WHERE id = $1 AND lecturer_id = $2",
      [quizId, req.lecturer.id]
    );
    if (!ownerCheck.rows[0]) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    // opened_at is set the first time (and every time) a quiz transitions to
    // open, since a lecturer can reopen a quiz they previously closed.
    // closed_at is stamped whenever it moves to closed.
    let updateQuery;
    let params;
    if (status === "open") {
      updateQuery = `UPDATE quizzes SET status = $1, opened_at = now()
                      WHERE id = $2 RETURNING id, title, status, duration_seconds, opened_at, closed_at`;
      params = [status, quizId];
    } else if (status === "closed") {
      updateQuery = `UPDATE quizzes SET status = $1, closed_at = now()
                      WHERE id = $2 RETURNING id, title, status, duration_seconds, opened_at, closed_at`;
      params = [status, quizId];
    } else {
      updateQuery = `UPDATE quizzes SET status = $1
                      WHERE id = $2 RETURNING id, title, status, duration_seconds, opened_at, closed_at`;
      params = [status, quizId];
    }

    const { rows } = await pool.query(updateQuery, params);
    return res.json(rows[0]);
  } catch (err) {
    console.error("Update quiz status error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/quizzes/:id/enrollments
// Returns all enrolled students for a quiz (never includes password_hash).
// Includes submission_status derived from whether a linked submission exists.
router.get("/:id/enrollments", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }

  try {
    const ownerCheck = await pool.query(
      "SELECT id FROM quizzes WHERE id = $1 AND lecturer_id = $2",
      [quizId, req.lecturer.id]
    );
    if (!ownerCheck.rows[0]) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const { rows } = await pool.query(
      `SELECT
         e.id,
         e.student_email,
         e.full_name,
         e.created_at,
         CASE
           WHEN s.submitted_at IS NOT NULL THEN 'submitted'
           WHEN s.id IS NOT NULL          THEN 'in_progress'
           ELSE                                'not_started'
         END AS submission_status
       FROM quiz_enrollments e
       LEFT JOIN submissions s ON s.enrollment_id = e.id
       WHERE e.quiz_id = $1
       ORDER BY e.created_at ASC`,
      [quizId]
    );

    return res.json(rows);
  } catch (err) {
    console.error("Get enrollments error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/quizzes/:id/enrollments
// Body: { students: [{ email, password, fullName? }] }
// Bulk upsert — re-adding an existing email updates the password instead of erroring,
// so lecturers can correct a password by re-uploading the same row.
router.post("/:id/enrollments", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }

  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: "students must be a non-empty array" });
  }

  for (const s of students) {
    if (!s.email || !EMAIL_RE.test(s.email)) {
      return res.status(400).json({ error: `Invalid email: ${s.email}` });
    }
    if (!s.password || typeof s.password !== "string" || !s.password.trim()) {
      return res.status(400).json({ error: `password is required for ${s.email}` });
    }
  }

  try {
    const ownerCheck = await pool.query(
      "SELECT id FROM quizzes WHERE id = $1 AND lecturer_id = $2",
      [quizId, req.lecturer.id]
    );
    if (!ownerCheck.rows[0]) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const hashed = await Promise.all(
      students.map(async (s) => ({
        email: s.email.toLowerCase().trim(),
        passwordHash: await bcrypt.hash(s.password, 10),
        fullName: s.fullName?.trim() || null,
      }))
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = [];
      for (const s of hashed) {
        const { rows } = await client.query(
          `INSERT INTO quiz_enrollments (quiz_id, student_email, password_hash, full_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (quiz_id, student_email)
           DO UPDATE SET
             password_hash = EXCLUDED.password_hash,
             full_name     = EXCLUDED.full_name
           RETURNING id, student_email, full_name, created_at`,
          [quizId, s.email, s.passwordHash, s.fullName]
        );
        inserted.push(rows[0]);
      }
      await client.query("COMMIT");
      return res.status(201).json(inserted);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Add enrollments error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/quizzes/:id/enrollments/:enrollmentId
router.delete("/:id/enrollments/:enrollmentId", async (req, res) => {
  const quizId = Number(req.params.id);
  const enrollmentId = Number(req.params.enrollmentId);

  if (!Number.isInteger(quizId) || !Number.isInteger(enrollmentId)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  try {
    const ownerCheck = await pool.query(
      "SELECT id FROM quizzes WHERE id = $1 AND lecturer_id = $2",
      [quizId, req.lecturer.id]
    );
    if (!ownerCheck.rows[0]) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const { rowCount } = await pool.query(
      "DELETE FROM quiz_enrollments WHERE id = $1 AND quiz_id = $2",
      [enrollmentId, quizId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Enrollment not found" });
    }
    return res.status(204).send();
  } catch (err) {
    console.error("Delete enrollment error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;