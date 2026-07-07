const express = require("express");
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { pool } = require("../db/pool");
const { requireAuth } = require("../middleware/requireAuth");
const { restoreDatabase, dropDatabase, getTableCount } = require("../db/sqlServerOps");
const {
  createPostgresTemplate,
  dropPostgresTemplate,
  createPostgresSandbox,
  dropPostgresSandbox,
} = require("../db/postgresOps");
const { closeQuizAndEmit, QUIZ_FIELDS } = require("../db/quizLifecycle");

const UPLOAD_DIR = "/app/uploads/db";

const ENGINE_EXTENSIONS = { sqlserver: ".bak", postgres: ".sql" };

// Multer: save the uploaded backup/dump file to the shared volume. Filename
// is determined per-request (quiz_${id}.bak or quiz_${id}.sql) so we
// configure it in the route handler using a diskStorage factory. `engine` is
// read from a query param rather than a multipart body field — multer only
// parses body fields as it streams the multipart parts in order, so relying
// on a body field here would break if the frontend ever appends it after the
// file field in the FormData.
function buildUpload(quizId, engine) {
  const ext = ENGINE_EXTENSIONS[engine];
  return multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (_req, _file, cb) => cb(null, `quiz_${quizId}${ext}`),
    }),
    fileFilter: (_req, file, cb) => {
      if (!file.originalname.toLowerCase().endsWith(ext)) {
        return cb(new Error(`Only ${ext} files are accepted for the ${engine} engine`));
      }
      cb(null, true);
    },
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB
  });
}

const router = express.Router();

router.use(requireAuth);

const QUESTION_TYPES = ["open", "multiple_choice", "sql"];

// Validates one question's options array for question_type = 'multiple_choice'.
// Returns an error string, or null if valid.
function validateOptions(options) {
  if (!Array.isArray(options) || options.length < 2) {
    return "multiple_choice questions require an options array with at least 2 items";
  }

  const seenLetters = new Set();
  let correctCount = 0;

  for (const opt of options) {
    if (!opt.letter || typeof opt.letter !== "string" || !opt.letter.trim()) {
      return "each option requires a non-empty letter";
    }
    if (!opt.text || typeof opt.text !== "string" || !opt.text.trim()) {
      return "each option requires non-empty text";
    }
    const letter = opt.letter.trim();
    if (seenLetters.has(letter)) {
      return `duplicate option letter: ${letter}`;
    }
    seenLetters.add(letter);
    if (opt.is_correct === true) correctCount++;
  }

  if (correctCount !== 1) {
    return "exactly one option must be marked as correct";
  }

  return null;
}

// Create a quiz with its questions in one call.
// Body: { title: string, durationSeconds?: number, questions: [{ prompt, question_type?, max_points?, options? }] }
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
    const questionType = q.question_type || "open";
    if (!QUESTION_TYPES.includes(questionType)) {
      return res.status(400).json({ error: `question_type must be one of: ${QUESTION_TYPES.join(", ")}` });
    }
    if (questionType === "multiple_choice") {
      const optionsError = validateOptions(q.options);
      if (optionsError) {
        return res.status(400).json({ error: optionsError });
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
      const questionType = questions[i].question_type || "open";
      const { rows } = await client.query(
        `INSERT INTO questions (quiz_id, prompt, question_order, max_points, question_type)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, prompt, question_order, max_points, question_type`,
        [quiz.id, questions[i].prompt.trim(), i, Number(questions[i].max_points) || 10, questionType]
      );
      const insertedQuestion = rows[0];

      if (questionType === "multiple_choice") {
        const options = [];
        for (let j = 0; j < questions[i].options.length; j++) {
          const opt = questions[i].options[j];
          const { rows: optRows } = await client.query(
            `INSERT INTO question_options (question_id, option_letter, option_text, option_order, is_correct)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, option_letter, option_text, option_order, is_correct`,
            [insertedQuestion.id, opt.letter.trim(), opt.text.trim(), j, opt.is_correct === true]
          );
          options.push(optRows[0]);
        }
        insertedQuestion.options = options;
      }

      insertedQuestions.push(insertedQuestion);
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
      `SELECT id, prompt, question_order, max_points, question_type FROM questions
       WHERE quiz_id = $1 ORDER BY question_order ASC`,
      [quizId]
    );

    const optionsResult = await pool.query(
      `SELECT qo.question_id, qo.id, qo.option_letter, qo.option_text, qo.option_order, qo.is_correct
       FROM question_options qo
       JOIN questions q ON q.id = qo.question_id
       WHERE q.quiz_id = $1
       ORDER BY qo.question_id, qo.option_order ASC`,
      [quizId]
    );
    const optionsByQuestion = new Map();
    for (const row of optionsResult.rows) {
      if (!optionsByQuestion.has(row.question_id)) {
        optionsByQuestion.set(row.question_id, []);
      }
      optionsByQuestion.get(row.question_id).push({
        id: row.id,
        letter: row.option_letter,
        text: row.option_text,
        order: row.option_order,
        is_correct: row.is_correct,
      });
    }

    const questions = questionsResult.rows.map((q) => ({
      ...q,
      options: q.question_type === "multiple_choice" ? (optionsByQuestion.get(q.id) || []) : undefined,
    }));

    return res.json({ ...quiz, questions });
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
      `SELECT id, status FROM quizzes WHERE id = $1 AND lecturer_id = $2`,
      [quizId, req.lecturer.id]
    );
    if (!ownerCheck.rows[0]) {
      return res.status(404).json({ error: "Quiz not found" });
    }
    const quizStatus = ownerCheck.rows[0].status;

    const [questionsResult, optionsResult, submissionsResult, answersResult, violationsResult] =
      await Promise.all([
        pool.query(
          `SELECT q.id, q.prompt, q.question_order, q.max_points, q.question_type,
                  correct.option_letter AS correct_option
           FROM questions q
           LEFT JOIN question_options correct
             ON correct.question_id = q.id AND correct.is_correct = true
           WHERE q.quiz_id = $1
           ORDER BY q.question_order ASC`,
          [quizId]
        ),
        pool.query(
          `SELECT qo.question_id, qo.option_letter, qo.option_text, qo.option_order
           FROM question_options qo
           JOIN questions q ON q.id = qo.question_id
           WHERE q.quiz_id = $1
           ORDER BY qo.question_id, qo.option_order ASC`,
          [quizId]
        ),
        pool.query(
          `SELECT id, student_name, started_at, submitted_at, auto_submitted, socket_connected
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
                  a.last_execution_success,
                  a.last_execution_result,
                  a.is_correct,
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
        last_execution_success: row.last_execution_success,
        last_execution_result: row.last_execution_result,
        is_correct: row.is_correct,
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

    const optionsByQuestion = new Map();
    for (const row of optionsResult.rows) {
      if (!optionsByQuestion.has(row.question_id)) {
        optionsByQuestion.set(row.question_id, []);
      }
      optionsByQuestion.get(row.question_id).push({
        letter: row.option_letter,
        text: row.option_text,
        order: row.option_order,
      });
    }

    const questions = questionsResult.rows.map((q) => ({
      ...q,
      options: q.question_type === "multiple_choice" ? (optionsByQuestion.get(q.id) || []) : undefined,
    }));

    const totalPossible = questions.reduce(
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
        socket_connected: s.socket_connected,
        answers,
        violations,
        violation_count: violations.length,
        total_points_awarded,
        total_points_possible: totalPossible,
      };
    });

    return res.json({ quizStatus, questions, submissions });
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

// POST /api/quizzes/:id/submissions/:submissionId/reopen
// Resets an accidentally-submitted attempt back to in-progress: preserves
// answer_text and execution results, drops+recreates the sandbox if the quiz
// has a database extension, and leaves violations untouched so the lecturer
// can still see what happened before the submit.
router.post("/:id/submissions/:submissionId/reopen", async (req, res) => {
  const quizId = Number(req.params.id);
  const submissionId = Number(req.params.submissionId);
  if (!Number.isInteger(quizId) || !Number.isInteger(submissionId)) {
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

    const subResult = await pool.query(
      "SELECT id, quiz_id, submitted_at, sandbox_db_name, student_name FROM submissions WHERE id = $1",
      [submissionId]
    );
    const submission = subResult.rows[0];
    if (!submission || submission.quiz_id !== quizId) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (submission.submitted_at === null) {
      return res.status(400).json({ error: "This submission is already in progress." });
    }

    const extResult = await pool.query(
      "SELECT backup_file_path, engine FROM quiz_db_extensions WHERE quiz_id = $1 AND status = 'ready'",
      [quizId]
    );
    const ext = extResult.rows[0];

    if (ext && ext.engine === "postgres") {
      const sandboxName = `sandbox_${submissionId}_pg`;
      // Defensive — drop-on-submit should already have removed this, but a
      // stale sandbox would make CREATE DATABASE ... TEMPLATE below fail
      // anyway, so this is just belt-and-suspenders cleanup.
      try {
        await dropPostgresSandbox(sandboxName);
      } catch (err) {
        console.error(`Defensive pre-reopen drop failed for ${sandboxName}:`, err);
      }
      await createPostgresSandbox(submissionId, quizId);
      await pool.query(
        `UPDATE submissions
         SET submitted_at = NULL, auto_submitted = false, socket_connected = false, sandbox_db_name = $2
         WHERE id = $1`,
        [submissionId, sandboxName]
      );
    } else if (ext) {
      const sandboxName = `sandbox_${submissionId}`;
      // Defensive — drop-on-submit should already have removed this, but a
      // stale sandbox would make the RESTORE below fail with REPLACE anyway,
      // so this is just belt-and-suspenders cleanup.
      try {
        await dropDatabase(sandboxName);
      } catch (err) {
        console.error(`Defensive pre-reopen drop failed for ${sandboxName}:`, err);
      }
      await restoreDatabase(ext.backup_file_path, sandboxName);
      await pool.query(
        `UPDATE submissions
         SET submitted_at = NULL, auto_submitted = false, socket_connected = false, sandbox_db_name = $2
         WHERE id = $1`,
        [submissionId, sandboxName]
      );
    } else {
      await pool.query(
        `UPDATE submissions
         SET submitted_at = NULL, auto_submitted = false, socket_connected = false
         WHERE id = $1`,
        [submissionId]
      );
    }

    res.json({
      success: true,
      message: "Submission reopened. Student can now log back in to continue their exam.",
    });

    req.app.get("io")?.to(`quiz:${quizId}`).emit("submission:reopened", {
      submissionId,
      studentEmail: submission.student_name,
    });
  } catch (err) {
    console.error("Reopen submission error:", err);
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

    const io = req.app.get("io");

    // opened_at is set only the first time a quiz opens — the exam timer
    // runs from that single moment (not from each student's own login, and
    // not reset on reopen), so any prior pause is folded into
    // total_paused_seconds here rather than losing it on reopen.
    if (status === "open") {
      const { rows } = await pool.query(
        `UPDATE quizzes
         SET status = 'open',
             opened_at = COALESCE(opened_at, now()),
             total_paused_seconds = total_paused_seconds +
               CASE WHEN paused_at IS NOT NULL
                    THEN ROUND(EXTRACT(EPOCH FROM (now() - paused_at)))::integer
                    ELSE 0 END,
             paused_at = NULL
         WHERE id = $1
         RETURNING ${QUIZ_FIELDS}`,
        [quizId]
      );
      const quiz = rows[0];
      io?.to(`quiz:${quizId}`).emit("quiz:resumed", {
        quizId,
        totalPausedSeconds: quiz.total_paused_seconds,
        resumedAt: new Date().toISOString(),
      });
      return res.json(quiz);
    }

    if (status === "locked") {
      const { rows } = await pool.query(
        `UPDATE quizzes SET status = 'locked', paused_at = now()
         WHERE id = $1 RETURNING ${QUIZ_FIELDS}`,
        [quizId]
      );
      const quiz = rows[0];
      io?.to(`quiz:${quizId}`).emit("quiz:paused", {
        quizId,
        pausedAt: quiz.paused_at,
      });
      return res.json(quiz);
    }

    // status === "closed" — auto-submits active submissions and drops their
    // sandboxes in the background (see closeQuizAndEmit); the lecturer's
    // request doesn't wait for that sweep.
    const quiz = await closeQuizAndEmit(io, quizId);
    return res.json(quiz);
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

// GET /api/quizzes/:id/extensions/database
// Returns the current database extension status for this quiz, or null.
router.get("/:id/extensions/database", async (req, res) => {
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
      `SELECT id, status, engine, original_filename, table_count, error_message, created_at
       FROM quiz_db_extensions WHERE quiz_id = $1`,
      [quizId]
    );

    return res.json(rows[0] ?? null);
  } catch (err) {
    console.error("Get extension error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/quizzes/:id/extensions/database?engine=sqlserver|postgres
// Accepts a multipart upload (.bak for sqlserver, .sql for postgres), writes it
// to the shared volume, then kicks off template creation in the background.
// Responds immediately with { status: 'restoring' }.
router.post("/:id/extensions/database", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }

  const engine = req.query.engine === "postgres" ? "postgres" : "sqlserver";

  // Verify ownership before accepting the file.
  const ownerCheck = await pool.query(
    "SELECT id FROM quizzes WHERE id = $1 AND lecturer_id = $2",
    [quizId, req.lecturer.id]
  ).catch(() => ({ rows: [] }));
  if (!ownerCheck.rows[0]) {
    return res.status(404).json({ error: "Quiz not found" });
  }

  // Reject if an extension already exists (require DELETE first to replace).
  const existing = await pool.query(
    "SELECT id, status FROM quiz_db_extensions WHERE quiz_id = $1",
    [quizId]
  ).catch(() => ({ rows: [] }));
  if (existing.rows[0]) {
    return res.status(409).json({
      error: "A database extension already exists for this quiz. Remove it before uploading a new one.",
    });
  }

  // Now accept the file via multer.
  const upload = buildUpload(quizId, engine);
  upload.single("file")(req, res, async (multerErr) => {
    if (multerErr) {
      return res.status(400).json({ error: multerErr.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    if (engine === "postgres") {
      const templateDbName = `quiz_${quizId}_pg_template`;
      // req.file.path is the backend-container path (UPLOAD_DIR); postgresOps
      // reads the dump directly off disk via the shared volume, so no
      // container-path translation is needed (unlike the SQL Server .bak,
      // which SQL Server itself reads from its own container's mount).
      try {
        await pool.query(
          `INSERT INTO quiz_db_extensions
             (quiz_id, template_db_name, backup_file_path, original_filename, status, engine)
           VALUES ($1, $2, $3, $4, 'restoring', 'postgres')`,
          [quizId, templateDbName, req.file.path, req.file.originalname]
        );
      } catch (err) {
        fs.unlink(req.file.path, () => {});
        console.error("Insert extension row error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }

      res.json({ status: "restoring" });

      (async () => {
        try {
          const { tableCount } = await createPostgresTemplate(quizId, req.file.path);
          await pool.query(
            "UPDATE quiz_db_extensions SET status = 'ready', table_count = $1 WHERE quiz_id = $2",
            [tableCount, quizId]
          );
        } catch (err) {
          console.error(`Postgres template creation failed for quiz ${quizId}:`, err);
          await pool.query(
            "UPDATE quiz_db_extensions SET status = 'error', error_message = $1 WHERE quiz_id = $2",
            [err.message ?? String(err), quizId]
          ).catch(() => {});
        }
      })();
      return;
    }

    // Path inside the sqlserver container (shared volume mounted at different paths).
    const sqlServerBackupPath = `/var/opt/mssql/backup/quiz_${quizId}.bak`;
    const templateDbName = `quiz_${quizId}_template`;

    try {
      await pool.query(
        `INSERT INTO quiz_db_extensions
           (quiz_id, template_db_name, backup_file_path, original_filename, status, engine)
         VALUES ($1, $2, $3, $4, 'restoring', 'sqlserver')`,
        [quizId, templateDbName, sqlServerBackupPath, req.file.originalname]
      );
    } catch (err) {
      fs.unlink(req.file.path, () => {});
      console.error("Insert extension row error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }

    // Respond immediately — don't make the lecturer wait for the full restore.
    res.json({ status: "restoring" });

    // Background: restore the template DB then update status.
    (async () => {
      try {
        await restoreDatabase(sqlServerBackupPath, templateDbName);
        const tableCount = await getTableCount(templateDbName);
        await pool.query(
          "UPDATE quiz_db_extensions SET status = 'ready', table_count = $1 WHERE quiz_id = $2",
          [tableCount, quizId]
        );
      } catch (err) {
        console.error(`Template restore failed for quiz ${quizId}:`, err);
        await pool.query(
          "UPDATE quiz_db_extensions SET status = 'error', error_message = $1 WHERE quiz_id = $2",
          [err.message ?? String(err), quizId]
        ).catch(() => {});
      }
    })();
  });
});

// DELETE /api/quizzes/:id/extensions/database
// Drops the template DB (either engine), removes the backup/dump file, deletes the pg row.
router.delete("/:id/extensions/database", async (req, res) => {
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

    const extResult = await pool.query(
      "SELECT template_db_name, backup_file_path, engine FROM quiz_db_extensions WHERE quiz_id = $1",
      [quizId]
    );
    if (!extResult.rows[0]) {
      return res.status(404).json({ error: "No database extension found for this quiz" });
    }

    const { engine } = extResult.rows[0];

    if (engine === "postgres") {
      await dropPostgresTemplate(quizId);
      const localPath = path.join(UPLOAD_DIR, `quiz_${quizId}.sql`);
      fs.unlink(localPath, () => {});
    } else {
      const { template_db_name } = extResult.rows[0];
      // Drop the SQL Server template DB (IF EXISTS handles partial-failure states).
      await dropDatabase(template_db_name);
      const localPath = path.join(UPLOAD_DIR, `quiz_${quizId}.bak`);
      fs.unlink(localPath, () => {});
    }

    // Remove the pg row.
    await pool.query("DELETE FROM quiz_db_extensions WHERE quiz_id = $1", [quizId]);

    return res.status(204).send();
  } catch (err) {
    console.error("Delete extension error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;