const { pool } = require("./pool");
const { dropDatabase } = require("./sqlServerOps");
const { dropPostgresSandbox } = require("./postgresOps");

const QUIZ_FIELDS =
  "id, title, status, duration_seconds, opened_at, closed_at, paused_at, total_paused_seconds";

// Auto-submits every still-active submission for a quiz and drops their SQL
// Server sandboxes. Not awaited by callers — a class of 50 students shouldn't
// make a lecturer's close request (or a student's own expired request) wait
// for 50 sandbox drops.
async function autoSubmitAllActiveSubmissions(quizId) {
  try {
    const { rows: submissions } = await pool.query(
      `SELECT id, sandbox_db_name FROM submissions WHERE quiz_id = $1 AND submitted_at IS NULL`,
      [quizId]
    );

    await Promise.all(
      submissions.map(async (s) => {
        try {
          await pool.query(
            `UPDATE submissions SET submitted_at = now(), auto_submitted = true WHERE id = $1`,
            [s.id]
          );
        } catch (err) {
          console.error(`Auto-submit failed for submission ${s.id}:`, err);
        }
        if (s.sandbox_db_name) {
          try {
            const drop = s.sandbox_db_name.endsWith("_pg") ? dropPostgresSandbox : dropDatabase;
            await drop(s.sandbox_db_name);
          } catch (err) {
            console.error(`Failed to drop sandbox ${s.sandbox_db_name}:`, err);
          }
        }
      })
    );
  } catch (err) {
    console.error(`Auto-submit sweep failed for quiz ${quizId}:`, err);
  }
}

// Closes a quiz (idempotent — a no-op if already closed, so a manual lecturer
// close racing with an auto-expire check from a student's request can't emit
// 'quiz:closed' twice or double-run the sandbox-drop sweep), emits
// 'quiz:closed' to the quiz's socket room, and kicks off the auto-submit
// sweep in the background. Returns the current quiz row either way.
async function closeQuizAndEmit(io, quizId) {
  const { rows } = await pool.query(
    `UPDATE quizzes SET status = 'closed', closed_at = now()
     WHERE id = $1 AND status != 'closed'
     RETURNING ${QUIZ_FIELDS}`,
    [quizId]
  );

  if (rows.length === 0) {
    const { rows: existing } = await pool.query(
      `SELECT ${QUIZ_FIELDS} FROM quizzes WHERE id = $1`,
      [quizId]
    );
    return existing[0];
  }

  const quiz = rows[0];
  io?.to(`quiz:${quizId}`).emit("quiz:closed", { quizId });
  autoSubmitAllActiveSubmissions(quizId);
  return quiz;
}

module.exports = { closeQuizAndEmit, autoSubmitAllActiveSubmissions, QUIZ_FIELDS };
