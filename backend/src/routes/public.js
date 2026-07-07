const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db/pool");
const { requireStudentAuth } = require("../middleware/requireStudentAuth");
const { restoreDatabase, dropDatabase } = require("../db/sqlServerOps");
const { executeSql: executeSqlServer } = require("../db/sqlExecutor");
const {
  createPostgresSandbox,
  dropPostgresSandbox,
} = require("../db/postgresOps");
const { executeSql: executePostgres } = require("../db/postgresExecutor");
const { closeQuizAndEmit } = require("../db/quizLifecycle");

const router = express.Router();

// Whole-word, case-insensitive matches for operations that must never run,
// regardless of sandbox isolation (server-wide or filesystem impact).
const SQLSERVER_FORBIDDEN_SQL_PATTERNS = [
  /\bSHUTDOWN\b/i,
  /\bxp_cmdshell\b/i,
  /\bxp_reg\w*\b/i,
  /\bRESTORE\s+DATABASE\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bBACKUP\s+DATABASE\b/i,
];

// Postgres equivalent — blocks filesystem access (COPY, pg_read_file),
// server shutdown, dropping other databases, and installing extensions
// (which can themselves grant filesystem/network access).
const POSTGRES_FORBIDDEN_SQL_PATTERNS = [
  /\bSHUTDOWN\b/i,
  /\bpg_read_file\b/i,
  /\bpg_ls_dir\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bCREATE\s+EXTENSION\b/i,
  /\bCOPY\b[^;]*\b(FROM|TO)\b\s*(PROGRAM\s*)?'/i,
];

function findForbiddenSql(sqlText, engine) {
  const patterns =
    engine === "postgres" ? POSTGRES_FORBIDDEN_SQL_PATTERNS : SQLSERVER_FORBIDDEN_SQL_PATTERNS;
  return patterns.find((pattern) => pattern.test(sqlText));
}

// Belt-and-suspenders check — the frontend timer auto-submits before this
// triggers in normal circumstances, but this catches edge cases (student
// pauses JS, slow network, etc.) where a request slips in after time is up.
function isQuizTimerExpired(quiz) {
  if (!quiz.duration_seconds || !quiz.opened_at) return false;
  const now = Date.now();
  const openedAtMs = new Date(quiz.opened_at).getTime();
  const pausedAtMs = quiz.paused_at ? new Date(quiz.paused_at).getTime() : null;
  const effectiveElapsed =
    (now - openedAtMs) / 1000 -
    quiz.total_paused_seconds -
    (pausedAtMs ? (now - pausedAtMs) / 1000 : 0);
  return effectiveElapsed > quiz.duration_seconds;
}

// Used for timing-safe comparison when no enrollment row exists.
const DUMMY_HASH = "$2b$10$invalidsaltinvalidsaltinvalidsa.aaaaaaaaaaaaaaaaaaaaa";

// Grades every multiple_choice question in the quiz for this submission,
// including questions the student never answered (no answer = wrong = 0
// points). Runs synchronously as part of submit, since the lecturer results
// view and the sandbox-drop cleanup both need the grade recorded immediately
// — this can't be deferred to a background job the way sandbox cleanup is.
async function autoGradeMultipleChoice(submissionId, quizId, lecturerId) {
  const { rows } = await pool.query(
    `SELECT q.id AS question_id, q.max_points, correct.option_letter AS correct_letter,
            a.answer_text
     FROM questions q
     LEFT JOIN question_options correct
       ON correct.question_id = q.id AND correct.is_correct = true
     LEFT JOIN answers a
       ON a.question_id = q.id AND a.submission_id = $2
     WHERE q.quiz_id = $1 AND q.question_type = 'multiple_choice'`,
    [quizId, submissionId]
  );

  for (const row of rows) {
    const isCorrect = row.answer_text != null && row.answer_text === row.correct_letter;
    const points = isCorrect ? row.max_points : 0;
    const notes = isCorrect ? "Auto-graded: correct" : "Auto-graded: incorrect";

    await pool.query(
      `INSERT INTO answers (submission_id, question_id, answer_text, is_correct)
       VALUES ($1, $2, COALESCE($3, ''), $4)
       ON CONFLICT (submission_id, question_id)
       DO UPDATE SET is_correct = EXCLUDED.is_correct`,
      [submissionId, row.question_id, row.answer_text, isCorrect]
    );

    await pool.query(
      `INSERT INTO grades (submission_id, question_id, points, graded_by, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (submission_id, question_id)
       DO UPDATE SET points = EXCLUDED.points, notes = EXCLUDED.notes, graded_at = now()`,
      [submissionId, row.question_id, points, lecturerId, notes]
    );
  }
}

// GET /api/public/quizzes/:id
router.get("/quizzes/:id", async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) {
    return res.status(400).json({ error: "Invalid quiz id" });
  }

  try {
    const quizResult = await pool.query(
      `SELECT id, title, status, duration_seconds, monitoring_mode,
              opened_at, total_paused_seconds, paused_at
       FROM quizzes WHERE id = $1`,
      [quizId]
    );
    const quiz = quizResult.rows[0];

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }
    // 'locked' still returns quiz data — a student mid-exam whose lecturer
    // paused the quiz needs to be able to refresh and land on the pause
    // overlay rather than an error screen. A brand-new student sees the same
    // login form either way; the login endpoint itself still rejects entry
    // while locked, so this doesn't let anyone new into a paused exam.
    if (quiz.status === "closed") {
      return res.status(403).json({ error: "This exam has been closed." });
    }
    if (quiz.status !== "open" && quiz.status !== "locked") {
      return res.status(403).json({ error: "This quiz is not currently open" });
    }

    const questionsResult = await pool.query(
      `SELECT id, prompt, question_type FROM questions WHERE quiz_id = $1 ORDER BY question_order ASC`,
      [quizId]
    );

    const optionsResult = await pool.query(
      `SELECT qo.question_id, qo.id, qo.option_letter, qo.option_text, qo.option_order
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
      // is_correct intentionally omitted — students must not see the answer key.
      optionsByQuestion.get(row.question_id).push({
        id: row.id,
        letter: row.option_letter,
        text: row.option_text,
        order: row.option_order,
      });
    }

    const questions = questionsResult.rows.map((q) => ({
      ...q,
      options: q.question_type === "multiple_choice" ? (optionsByQuestion.get(q.id) || []) : undefined,
    }));

    return res.json({
      id: quiz.id,
      title: quiz.title,
      durationSeconds: quiz.duration_seconds,
      monitoringMode: quiz.monitoring_mode,
      openedAt: quiz.opened_at,
      totalPausedSeconds: quiz.total_paused_seconds,
      pausedAt: quiz.status === "locked" ? quiz.paused_at : null,
      currentlyPaused: quiz.status === "locked",
      questions,
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
      `SELECT id, status, duration_seconds, opened_at, total_paused_seconds, paused_at, monitoring_mode
       FROM quizzes WHERE id = $1`,
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
      `SELECT id, started_at, submitted_at, sandbox_db_name, socket_connected FROM submissions WHERE enrollment_id = $1`,
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

      // Strict mode: a student who was genuinely active in the exam (their socket
      // connected) and is now trying to log back in must have left the tab —
      // whether via a successful beforeunload beacon or a lost connection. Either
      // way, auto-submit here so a failed beacon can't silently leave the exam
      // resumable and bypass strict mode. socket_connected === false means they
      // never got past the login screen, so let those resume normally.
      if (quiz.monitoring_mode === "strict" && existing.socket_connected === true) {
        const updateResult = await pool.query(
          `UPDATE submissions
           SET submitted_at = now(), auto_submitted = true
           WHERE id = $1
           RETURNING sandbox_db_name`,
          [existing.id]
        );
        const dropSandboxName = updateResult.rows[0].sandbox_db_name;
        if (dropSandboxName) {
          dropDatabase(dropSandboxName).catch((err) => {
            console.error(`Failed to drop sandbox ${dropSandboxName}:`, err);
          });
        }
        return res.status(409).json({
          error:
            "Your attempt was automatically submitted because you left the exam and tried to reconnect. This quiz is set to strict monitoring mode.",
        });
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
      `SELECT backup_file_path, template_db_name, engine
       FROM quiz_db_extensions
       WHERE quiz_id = $1 AND status = 'ready'`,
      [quizId]
    );
    const ext = extResult.rows[0];

    const hasDatabaseExtension = Boolean(ext);

    if (ext && !sandboxDbName) {
      // Provision a fresh sandbox for this student. Synchronous — ~270ms for small
      // SQL Server databases (Postgres TEMPLATE copies are effectively instant),
      // a few seconds for large ones. Students wait for this before getting
      // their token, which is acceptable given the UX context.
      try {
        if (ext.engine === "postgres") {
          sandboxDbName = await createPostgresSandbox(submissionId, quizId);
        } else {
          const newSandboxName = `sandbox_${submissionId}`;
          await restoreDatabase(ext.backup_file_path, newSandboxName);
          sandboxDbName = newSandboxName;
        }
        await pool.query(
          "UPDATE submissions SET sandbox_db_name = $1 WHERE id = $2",
          [sandboxDbName, submissionId]
        );
      } catch (err) {
        console.error(`Sandbox provision failed for submission ${submissionId}:`, err);
        // Non-fatal: student can still sit the exam without the database extension.
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
      openedAt: quiz.opened_at,
      totalPausedSeconds: quiz.total_paused_seconds,
      pausedAt: quiz.status === "locked" ? quiz.paused_at : null,
      currentlyPaused: quiz.status === "locked",
      hasDatabaseExtension,
      dbEngine: ext ? ext.engine : null,
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
      `SELECT s.id, s.submitted_at, s.quiz_id,
              q.duration_seconds, q.opened_at, q.total_paused_seconds, q.paused_at
       FROM submissions s
       JOIN quizzes q ON q.id = s.quiz_id
       WHERE s.id = $1`,
      [submissionId]
    );
    const submission = submissionResult.rows[0];

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (submission.submitted_at !== null) {
      return res.status(400).json({ error: "This submission has already been submitted" });
    }

    if (isQuizTimerExpired(submission)) {
      await closeQuizAndEmit(req.app.get("io"), submission.quiz_id);
      return res.status(403).json({ error: "The exam time has expired." });
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

// GET /api/public/submissions/:submissionId/answers
// Returns previously saved answers for this submission, so the frontend can
// pre-populate editors on a session restore (page refresh mid-exam) instead
// of showing blank fields for work that's already safely saved.
router.get("/submissions/:submissionId/answers", requireStudentAuth, async (req, res) => {
  const submissionId = Number(req.params.submissionId);
  if (!Number.isInteger(submissionId)) {
    return res.status(400).json({ error: "Invalid submission id" });
  }

  if (submissionId !== req.student.submissionId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT question_id, answer_text, last_execution_success, last_execution_result
       FROM answers
       WHERE submission_id = $1`,
      [submissionId]
    );

    return res.json({
      answers: rows.map((row) => ({
        questionId: row.question_id,
        answerText: row.answer_text,
        lastExecutionSuccess: row.last_execution_success,
        lastExecutionResult: row.last_execution_result,
      })),
    });
  } catch (err) {
    console.error("Get saved answers error:", err);
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
      `SELECT s.id, s.submitted_at, s.sandbox_db_name, s.quiz_id,
              q.duration_seconds, q.opened_at, q.total_paused_seconds, q.paused_at, q.lecturer_id
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

    // Server-side enforcement: override to true if the student is past the deadline,
    // regardless of what the client reported. Accounts for paused time so a
    // lecturer-paused exam doesn't get force-flagged as auto-submitted.
    let isAutoSubmitted = Boolean(req.body.autoSubmitted) || isQuizTimerExpired(submission);

    const updateResult = await pool.query(
      `UPDATE submissions
       SET submitted_at = now(), auto_submitted = $2
       WHERE id = $1
       RETURNING submitted_at, auto_submitted`,
      [submissionId, isAutoSubmitted]
    );

    const updated = updateResult.rows[0];

    // Auto-grade multiple choice questions before responding — grades must be
    // recorded before the sandbox drop below, and the lecturer results view
    // reads them immediately after submission, so this can't be deferred to
    // the background like the sandbox cleanup is.
    await autoGradeMultipleChoice(submissionId, submission.quiz_id, submission.lecturer_id);

    res.json({
      submittedAt: updated.submitted_at,
      autoSubmitted: updated.auto_submitted,
    });

    // Drop the student's sandbox after the response is sent — instant either
    // way, but we don't want any DROP latency in the student's "submitted"
    // screen. The "_pg" suffix (see sandbox naming in public.js login and
    // postgresOps.createPostgresSandbox) is enough to tell which engine's
    // drop function to call, without an extra join to quiz_db_extensions.
    if (submission.sandbox_db_name) {
      const drop = submission.sandbox_db_name.endsWith("_pg")
        ? dropPostgresSandbox
        : dropDatabase;
      drop(submission.sandbox_db_name).catch((err) => {
        console.error(`Failed to drop sandbox ${submission.sandbox_db_name}:`, err);
      });
    }
  } catch (err) {
    console.error("Submit error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/student/execute
// Body: { questionId: number, sql: string }
// Executes student-submitted T-SQL against their personal sandbox database
// and autosaves both the SQL text and the execution outcome.
router.post("/student/execute", requireStudentAuth, async (req, res) => {
  const { questionId, sql: sqlText } = req.body;
  const qId = Number(questionId);

  if (!Number.isInteger(qId) || qId <= 0) {
    return res.status(400).json({ error: "questionId must be a positive integer" });
  }
  if (typeof sqlText !== "string" || !sqlText.trim()) {
    return res.status(400).json({ error: "sql must be a non-empty string" });
  }

  try {
    const submissionResult = await pool.query(
      `SELECT s.id, s.sandbox_db_name, s.submitted_at, s.quiz_id,
              q.duration_seconds, q.opened_at, q.total_paused_seconds, q.paused_at
       FROM submissions s
       JOIN quizzes q ON q.id = s.quiz_id
       WHERE s.id = $1`,
      [req.student.submissionId]
    );
    const submission = submissionResult.rows[0];

    if (!submission || submission.id !== req.student.submissionId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (submission.submitted_at !== null) {
      return res.status(403).json({
        error: "This submission has already been submitted. Queries cannot be run after submission.",
      });
    }
    if (isQuizTimerExpired(submission)) {
      await closeQuizAndEmit(req.app.get("io"), submission.quiz_id);
      return res.status(403).json({ error: "The exam time has expired." });
    }
    if (!submission.sandbox_db_name) {
      return res.status(400).json({
        error: "No database sandbox found for this submission. This quiz may not have a database extension.",
      });
    }

    const isPostgres = submission.sandbox_db_name.endsWith("_pg");
    const expectedSandboxName = isPostgres
      ? `sandbox_${submission.id}_pg`
      : `sandbox_${submission.id}`;
    if (submission.sandbox_db_name !== expectedSandboxName) {
      return res.status(403).json({ error: "Sandbox mismatch for this submission" });
    }

    const forbidden = findForbiddenSql(sqlText, isPostgres ? "postgres" : "sqlserver");
    if (forbidden) {
      return res.status(400).json({
        error: `This query contains a disallowed operation (${forbidden.source.replace(/\\b|\\s\+/g, " ").trim()}).`,
      });
    }

    const questionCheck = await pool.query(
      `SELECT id FROM questions WHERE id = $1 AND quiz_id = $2`,
      [qId, submission.quiz_id]
    );
    if (!questionCheck.rows[0]) {
      return res.status(400).json({ error: "Question does not belong to this quiz" });
    }

    const results = isPostgres
      ? await executePostgres(submission.sandbox_db_name, sqlText)
      : await executeSqlServer(submission.sandbox_db_name, sqlText);
    const success = results.every((r) => r.type !== "error");
    const savedAt = new Date();

    await pool.query(
      `INSERT INTO answers (submission_id, question_id, answer_text, last_execution_success, last_execution_result)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (submission_id, question_id)
       DO UPDATE SET answer_text = EXCLUDED.answer_text,
                     last_execution_success = EXCLUDED.last_execution_success,
                     last_execution_result = EXCLUDED.last_execution_result`,
      [req.student.submissionId, qId, sqlText, success, JSON.stringify(results)]
    );

    return res.json({ results, savedAt });
  } catch (err) {
    console.error("Execute SQL error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
