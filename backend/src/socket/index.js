'use strict';

const { pool } = require('../db/pool');
const jwt = require('jsonwebtoken');

const VALID_VIOLATION_TYPES = new Set([
  'tab_switch',
  'window_blur',
  'fullscreen_exit',
  'fullscreen_reenter',
  'devtools_attempt',
]);

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    socket.on('student:join', async (payload) => {
      const { quizId, submissionId, studentName } = payload || {};

      if (!quizId || !submissionId || !studentName) {
        socket.emit('error', { message: 'student:join requires quizId, submissionId, studentName' });
        return;
      }

      try {
        const { rows } = await pool.query(
          `SELECT id FROM submissions
           WHERE id = $1 AND quiz_id = $2 AND submitted_at IS NULL`,
          [Number(submissionId), Number(quizId)]
        );

        if (!rows[0]) {
          socket.emit('error', {
            message: 'Submission not found, does not belong to this quiz, or already submitted',
          });
          return;
        }

        const room = `quiz:${quizId}`;
        await socket.join(room);
        socket.data = {
          role: 'student',
          quizId: Number(quizId),
          submissionId: Number(submissionId),
          studentName,
        };
      } catch (err) {
        console.error('student:join error:', err);
        socket.emit('error', { message: 'Internal server error' });
      }
    });

    socket.on('lecturer:join', async (payload) => {
      const { quizId, token } = payload || {};

      if (!quizId || !token) {
        socket.emit('error', { message: 'lecturer:join requires quizId and token' });
        return;
      }

      let jwtPayload;
      try {
        jwtPayload = jwt.verify(token, process.env.JWT_SECRET);
      } catch {
        socket.emit('error', { message: 'Invalid or expired token' });
        return;
      }

      const lecturerId = jwtPayload.sub;

      try {
        const { rows } = await pool.query(
          `SELECT id FROM quizzes WHERE id = $1 AND lecturer_id = $2`,
          [Number(quizId), lecturerId]
        );

        if (!rows[0]) {
          socket.emit('error', { message: 'Quiz not found or not authorized' });
          return;
        }

        const room = `quiz:${quizId}`;
        await socket.join(room);
        socket.data = { role: 'lecturer', quizId: Number(quizId), lecturerId };

        // Backfill the monitor with violations that happened before this
        // lecturer opened (or reloaded) the page. Without this the panel only
        // shows events received live, so a student flagged earlier looks clean.
        // Scoped to in-progress submissions, since finished ones live in Results.
        const history = await pool.query(
          `SELECT s.id AS submission_id, s.student_name,
                  v.event_type AS type, v.occurred_at
           FROM violations v
           JOIN submissions s ON s.id = v.submission_id
           WHERE s.quiz_id = $1 AND s.submitted_at IS NULL
           ORDER BY s.id, v.occurred_at ASC`,
          [Number(quizId)]
        );

        const bySubmission = new Map();
        for (const r of history.rows) {
          if (!bySubmission.has(r.submission_id)) {
            bySubmission.set(r.submission_id, {
              submissionId: r.submission_id,
              studentName: r.student_name,
              violations: [],
            });
          }
          bySubmission.get(r.submission_id).violations.push({
            type: r.type,
            occurredAt: r.occurred_at,
          });
        }

        socket.emit('monitor:snapshot', { students: [...bySubmission.values()] });
      } catch (err) {
        console.error('lecturer:join error:', err);
        socket.emit('error', { message: 'Internal server error' });
      }
    });

    socket.on('violation:report', async (payload) => {
      if (socket.data?.role !== 'student') {
        socket.emit('error', { message: 'Only students can report violations' });
        return;
      }

      const { type } = payload || {};
      if (!VALID_VIOLATION_TYPES.has(type)) {
        socket.emit('error', {
          message: `type must be one of: ${[...VALID_VIOLATION_TYPES].join(', ')}`,
        });
        return;
      }

      const { quizId, submissionId, studentName } = socket.data;

      try {
        const { rows } = await pool.query(
          `INSERT INTO violations (submission_id, event_type)
           VALUES ($1, $2)
           RETURNING occurred_at`,
          [submissionId, type]
        );

        socket.to(`quiz:${quizId}`).emit('violation:new', {
          submissionId,
          studentName,
          type,
          occurredAt: rows[0].occurred_at,
        });
      } catch (err) {
        console.error('violation:report error:', err);
        socket.emit('error', { message: 'Internal server error' });
      }
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected:', socket.id);

      if (socket.data?.role === 'student') {
        const { quizId, submissionId, studentName } = socket.data;
        // Broadcast disconnect as a distinct event — intentionally not recorded
        // in violations, since a dropped connection isn't the same as a flag.
        socket.to(`quiz:${quizId}`).emit('student:disconnected', {
          submissionId,
          studentName,
          disconnectedAt: new Date().toISOString(),
        });
      }
    });
  });
}

module.exports = { registerSocketHandlers };
