#!/usr/bin/env node
'use strict';
// Smoke-test for real-time violation tracking over Socket.IO.
// Requires Node 18+ (native fetch) and socket.io-client (devDependency).
//
// Usage:
//   LECTURER_EMAIL=you@example.com LECTURER_PASSWORD=secret node backend/test/socket-test-client.js
//
// Optional:
//   BASE_URL=http://localhost:4000  (default)

const { io } = require('socket.io-client');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const LECTURER_EMAIL = process.env.LECTURER_EMAIL;
const LECTURER_PASSWORD = process.env.LECTURER_PASSWORD;

if (!LECTURER_EMAIL || !LECTURER_PASSWORD) {
  console.error('Error: set LECTURER_EMAIL and LECTURER_PASSWORD before running.');
  process.exit(1);
}

// --- REST helpers -----------------------------------------------------------

async function restPost(path, body, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function restPatch(path, body, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// --- Socket helpers ----------------------------------------------------------

function connectSocket(label) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { transports: ['websocket'] });
    const timeout = setTimeout(() => reject(new Error(`[${label}] connect timeout`)), 5000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      console.log(`[${label}] connected  (id: ${socket.id})`);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`[${label}] connect_error: ${err.message}`));
    });
    socket.on('error', (data) => {
      console.error(`[${label}] ← error`, JSON.stringify(data));
    });
  });
}

function send(socket, label, event, payload) {
  console.log(`[${label}] → ${event}`, JSON.stringify(payload));
  socket.emit(event, payload);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Main -------------------------------------------------------------------

async function run() {
  console.log(`\nBackend: ${BASE_URL}\n`);

  // Step 1: authenticate
  console.log('=== 1. REST setup ===');
  const { token } = await restPost('/api/auth/login', {
    email: LECTURER_EMAIL,
    password: LECTURER_PASSWORD,
  });
  console.log('  Login OK');

  // Step 2: create a temporary quiz
  const quiz = await restPost(
    '/api/quizzes',
    { title: '[SOCKET-TEST] Temp Quiz', questions: [{ prompt: 'What is 2+2?' }] },
    token
  );
  console.log(`  Quiz created  id=${quiz.id}`);

  // Step 3: open it so start-submission doesn't 403
  await restPatch(`/api/quizzes/${quiz.id}/status`, { status: 'open' }, token);
  console.log(`  Quiz ${quiz.id} opened`);

  // Step 4: create a submission
  const { submissionId } = await restPost(`/api/public/quizzes/${quiz.id}/start`, {
    studentName: 'Alice (socket-test)',
  });
  console.log(`  Submission created  id=${submissionId}`);

  // Step 5: socket tests
  console.log('\n=== 2. Socket events ===');

  const received = [];

  // Connect lecturer first
  const lecturer = await connectSocket('LECTURER');
  lecturer.on('violation:new', (data) => {
    received.push({ event: 'violation:new', data });
    console.log('[LECTURER] ← violation:new', JSON.stringify(data));
  });
  lecturer.on('student:disconnected', (data) => {
    received.push({ event: 'student:disconnected', data });
    console.log('[LECTURER] ← student:disconnected', JSON.stringify(data));
  });

  send(lecturer, 'LECTURER', 'lecturer:join', { quizId: quiz.id, token });

  // Give server time to process the join before student arrives
  await delay(250);

  const student = await connectSocket('STUDENT');
  send(student, 'STUDENT', 'student:join', {
    quizId: quiz.id,
    submissionId,
    studentName: 'Alice (socket-test)',
  });

  await delay(250);

  send(student, 'STUDENT', 'violation:report', { type: 'tab_switch' });
  await delay(100);
  send(student, 'STUDENT', 'violation:report', { type: 'window_blur' });

  await delay(250);

  console.log('[STUDENT] disconnecting...');
  student.disconnect();

  await delay(250);
  lecturer.disconnect();

  // Summary
  console.log('\n=== 3. Results ===');
  const violations = received.filter((e) => e.event === 'violation:new');
  const disconnects = received.filter((e) => e.event === 'student:disconnected');

  const checks = [
    { label: 'violation:new × 2', pass: violations.length === 2 },
    { label: 'student:disconnected × 1', pass: disconnects.length === 1 },
    {
      label: 'violation submissionId matches',
      pass: violations.every((e) => e.data.submissionId === submissionId),
    },
    {
      label: 'violation type values correct',
      pass:
        violations[0]?.data.type === 'tab_switch' &&
        violations[1]?.data.type === 'window_blur',
    },
  ];

  let allPass = true;
  for (const c of checks) {
    const mark = c.pass ? '✓' : '✗';
    console.log(`  ${mark} ${c.label}`);
    if (!c.pass) allPass = false;
  }

  console.log(allPass ? '\nAll checks passed.\n' : '\nSome checks FAILED.\n');
  process.exit(allPass ? 0 : 1);
}

run().catch((err) => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
