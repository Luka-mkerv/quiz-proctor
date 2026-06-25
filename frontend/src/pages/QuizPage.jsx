import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Separate instance — auth header is injected per-request for student routes.
const publicApi = axios.create({ baseURL: BASE_URL });

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

export default function QuizPage() {
  const { id: quizId } = useParams();

  // 'loading' | 'entry' | 'active' | 'submitted' | 'error'
  const [phase, setPhase] = useState('loading');
  const [quiz, setQuiz] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Login form
  const [studentEmail, setStudentEmail] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Active quiz UI
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(null);
  const [socketWarning, setSocketWarning] = useState('');
  const [inFullscreen, setInFullscreen] = useState(false);
  const [graceCountdown, setGraceCountdown] = useState(null);

  // Mutable state used inside closures.
  const studentTokenRef = useRef(null);
  const socketRef = useRef(null);
  const submissionIdRef = useRef(null);
  const submittedRef = useRef(false);
  const violationCooldownRef = useRef({});
  const blurTimerRef = useRef(null);
  const lastLeaveRef = useRef(0);
  const autosaveTimersRef = useRef({});
  const timerRef = useRef(null);
  const graceIntervalRef = useRef(null);
  const monitorCleanupRef = useRef(null);
  const submitReasonRef = useRef(null);
  const isJoinedRef = useRef(false);

  // --- Initial quiz fetch ---
  useEffect(() => {
    // Strict Mode in development double-invokes effects (run → cleanup → run).
    // The cleanup sets canceled = true so the first run's stale .then() is a
    // no-op, preventing it from creating duplicate side-effects alongside the
    // second run.
    let canceled = false;

    publicApi.get(`/api/public/quizzes/${quizId}`)
      .then(({ data }) => {
        if (canceled) return;
        setQuiz(data);

        // Try to restore an in-progress session from this tab.
        const sessionStr = sessionStorage.getItem(`studentSession_${quizId}`);
        if (sessionStr) {
          try {
            const sess = JSON.parse(sessionStr);
            const payload = decodeJwtPayload(sess.token);
            if (
              payload &&
              String(payload.quizId) === String(quizId) &&
              payload.exp * 1000 > Date.now()
            ) {
              studentTokenRef.current = sess.token;
              submissionIdRef.current = sess.submissionId;

              const init = {};
              data.questions.forEach((q) => { init[q.id] = ''; });
              setAnswers(init);

              startTimer(sess.startedAt, sess.durationSeconds);
              monitorCleanupRef.current = setupMonitoring(data.monitoringMode === 'strict');

              // Socket is created by the socket useEffect below once phase
              // becomes 'active' — do NOT create it here.
              setPhase('active');
              return;
            }
          } catch {
            sessionStorage.removeItem(`studentSession_${quizId}`);
          }
        }

        setPhase('entry');
      })
      .catch((err) => {
        if (canceled) return;
        const status = err.response?.status;
        if (status === 404) {
          setErrorMsg('Quiz not found.');
        } else if (status === 403) {
          setErrorMsg('This quiz is not currently open. Please check with your instructor.');
        } else {
          setErrorMsg('Something went wrong. Please try again later.');
        }
        setPhase('error');
      });

    return () => { canceled = true; };
  }, [quizId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Full teardown on unmount ---
  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Socket connection ---
  // Created here — after the component has committed the 'active' phase —
  // rather than inside handleLogin or the quiz fetch callback. Creating a
  // socket inside an event handler races with React 18 concurrent-mode render
  // aborts: when React discards an in-progress render it runs committed-effect
  // cleanups (including teardown), which disconnects a socket that was created
  // before the state updates were committed, causing the immediate disconnect.
  useEffect(() => {
    if (phase !== 'active') return;

    const token = studentTokenRef.current;
    const subId = submissionIdRef.current;
    if (!token || !subId) return;

    const socket = io(BASE_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      isJoinedRef.current = false;
      socket.emit('student:join', {
        quizId: Number(quizId),
        submissionId: Number(subId),
      });
    });

    socket.on('student:joined', () => {
      isJoinedRef.current = true;
      setSocketWarning('');
    });

    socket.on('error', (err) => {
      console.error('[socket error event]', err);
      setSocketWarning('Monitoring connection issue — your answers are still being saved.');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      isJoinedRef.current = false;
    };
  }, [phase, quizId]); // eslint-disable-line react-hooks/exhaustive-deps

  function teardown() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (graceIntervalRef.current) {
      clearInterval(graceIntervalRef.current);
      graceIntervalRef.current = null;
    }
    if (monitorCleanupRef.current) {
      monitorCleanupRef.current();
      monitorCleanupRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    clearTimeout(blurTimerRef.current);
    blurTimerRef.current = null;
    Object.values(autosaveTimersRef.current).forEach(clearTimeout);
    autosaveTimersRef.current = {};
    try {
      if (document.fullscreenElement) document.exitFullscreen();
    } catch {}
  }

  function emitViolation(type) {
    if (!isJoinedRef.current) {
      console.log('[violation gated — not yet joined]', type);
      return;
    }
    const now = Date.now();
    if (now - (violationCooldownRef.current[type] ?? 0) < 500) return;
    violationCooldownRef.current[type] = now;
    console.log('[violation:report emit]', type);
    socketRef.current?.emit('violation:report', { type });
  }

  function setupMonitoring(isStrict) {
    const noteLeave = () => {
      lastLeaveRef.current = Date.now();
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    };

    const onLeaveViolation = (type) => {
      emitViolation(type);
      if (isStrict) startGraceCountdown();
    };

    const onVisibility = () => {
      if (document.hidden) {
        noteLeave();
        onLeaveViolation('tab_switch');
      }
    };

    const onBlur = () => {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = setTimeout(() => {
        blurTimerRef.current = null;
        if (document.hidden) return;
        if (Date.now() - lastLeaveRef.current < 1200) return;
        onLeaveViolation('window_blur');
      }, 500);
    };

    const onFullscreen = () => {
      if (document.fullscreenElement) {
        setInFullscreen(true);
        emitViolation('fullscreen_reenter');
      } else {
        setInFullscreen(false);
        noteLeave();
        onLeaveViolation('fullscreen_exit');
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreen);

    // Strict mode: beacon-submit if the student closes the tab entirely mid-quiz.
    // sendBeacon cannot set headers, so the token is appended as a query param.
    let onBeforeUnload = null;
    if (isStrict) {
      onBeforeUnload = () => {
        if (submittedRef.current || !submissionIdRef.current) return;
        const token = studentTokenRef.current;
        const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
        const url = `${BASE_URL}/api/public/submissions/${submissionIdRef.current}/submit${tokenParam}`;
        const blob = new Blob([JSON.stringify({ autoSubmitted: true })], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      };
      window.addEventListener('beforeunload', onBeforeUnload);
    }

    return () => {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (onBeforeUnload) window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }

  function startGraceCountdown() {
    if (graceIntervalRef.current) return;
    let count = 6;
    setGraceCountdown(count);
    graceIntervalRef.current = setInterval(() => {
      count--;
      setGraceCountdown(count);
      if (count <= 0) {
        clearInterval(graceIntervalRef.current);
        graceIntervalRef.current = null;
        submitReasonRef.current = 'violation';
        doSubmit(true);
      }
    }, 1000);
  }

  async function handleReturnToExam() {
    clearInterval(graceIntervalRef.current);
    graceIntervalRef.current = null;
    setGraceCountdown(null);
    try {
      await document.documentElement.requestFullscreen();
      setInFullscreen(true);
    } catch {}
  }

  async function handleReenterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
    } catch {}
  }

  function startTimer(startedAt, durationSeconds) {
    if (!durationSeconds) return;
    const deadline = new Date(startedAt).getTime() + durationSeconds * 1000;

    const tick = () => {
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        setTimeLeft(0);
        doSubmit(true);
        return;
      }
      setTimeLeft(remaining);
    };

    tick();
    timerRef.current = setInterval(tick, 1000);
  }

  async function handleLogin() {
    const email = studentEmail.trim();
    const password = studentPassword;

    if (!email) {
      setLoginError('Please enter your email address.');
      return;
    }
    if (!password) {
      setLoginError('Please enter your password.');
      return;
    }

    setLoginError('');
    setLoggingIn(true);

    try {
      const { data } = await publicApi.post(`/api/public/quizzes/${quizId}/login`, {
        email,
        password,
      });

      studentTokenRef.current = data.token;
      submissionIdRef.current = data.submissionId;

      // Store session in sessionStorage so this tab can auto-resume after a refresh.
      // sessionStorage clears when the tab closes — correct for an exam session.
      sessionStorage.setItem(`studentSession_${quizId}`, JSON.stringify({
        token: data.token,
        submissionId: data.submissionId,
        startedAt: data.startedAt,
        durationSeconds: data.durationSeconds,
      }));

      try {
        await document.documentElement.requestFullscreen();
        setInFullscreen(true);
      } catch {
        // Browser denied — banner appears, student can re-enter manually.
      }

      // Socket is created by the socket useEffect once phase becomes 'active'.
      monitorCleanupRef.current = setupMonitoring(quiz.monitoringMode === 'strict');

      const init = {};
      quiz.questions.forEach((q) => { init[q.id] = ''; });
      setAnswers(init);

      startTimer(data.startedAt, data.durationSeconds);

      setPhase('active');
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error;
      if (status === 401 || status === 403) {
        setLoginError(msg || 'Login failed.');
      } else if (status === 404) {
        setLoginError('Quiz not found.');
      } else {
        setLoginError('Could not connect. Please try again.');
      }
    } finally {
      setLoggingIn(false);
    }
  }

  function handleAnswerChange(questionId, value) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    clearTimeout(autosaveTimersRef.current[questionId]);
    autosaveTimersRef.current[questionId] = setTimeout(() => {
      saveAnswer(questionId, value);
      delete autosaveTimersRef.current[questionId];
    }, 1000);
  }

  function handleAnswerBlur(questionId, value) {
    clearTimeout(autosaveTimersRef.current[questionId]);
    delete autosaveTimersRef.current[questionId];
    saveAnswer(questionId, value);
  }

  async function saveAnswer(questionId, answerText) {
    if (!submissionIdRef.current || submittedRef.current) return;
    try {
      await publicApi.post(
        `/api/public/submissions/${submissionIdRef.current}/answers`,
        { questionId, answerText },
        { headers: { Authorization: `Bearer ${studentTokenRef.current}` } }
      );
    } catch {
      // Silent — autosave failures shouldn't distract students mid-exam.
    }
  }

  async function doSubmit(autoSubmitted) {
    if (submittedRef.current) return;
    submittedRef.current = true;

    if (graceIntervalRef.current) { clearInterval(graceIntervalRef.current); graceIntervalRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (monitorCleanupRef.current) { monitorCleanupRef.current(); monitorCleanupRef.current = null; }
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }

    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {}

    try {
      await publicApi.post(
        `/api/public/submissions/${submissionIdRef.current}/submit`,
        { autoSubmitted },
        { headers: { Authorization: `Bearer ${studentTokenRef.current}` } }
      );
    } catch {
      // Backend enforces submission independently; show success regardless.
    }

    // Clear the session token now that the exam is over.
    sessionStorage.removeItem(`studentSession_${quizId}`);

    setPhase('submitted');
  }

  // ═══════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════

  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm text-gray-700">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (phase === 'submitted') {
    const isViolationSubmit = submitReasonRef.current === 'violation';
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center">
          {isViolationSubmit ? (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <div className="mb-3 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
                Auto-submitted
              </div>
              <h1 className="text-lg font-semibold text-gray-900">Quiz submitted</h1>
              <p className="mt-2 text-sm text-gray-600">
                Your quiz was automatically submitted because you did not return within the time limit. Your answers up to this point have been recorded.
              </p>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-gray-900">Submitted</h1>
              <p className="mt-2 text-sm text-gray-600">
                Your answers have been recorded. You may close this window.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'entry') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6">
          <h1 className="text-xl font-semibold text-gray-900">{quiz.title}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {quiz.questions.length} question{quiz.questions.length !== 1 ? 's' : ''}
            {quiz.durationSeconds
              ? ` · ${Math.round(quiz.durationSeconds / 60)} min`
              : ' · No time limit'}
          </p>

          <form
            onSubmit={(e) => { e.preventDefault(); handleLogin(); }}
            className="mt-6 space-y-4"
          >
            <div>
              <label htmlFor="studentEmail" className="mb-1.5 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="studentEmail"
                type="email"
                value={studentEmail}
                onChange={(e) => setStudentEmail(e.target.value)}
                placeholder="you@university.edu"
                autoFocus
                autoComplete="email"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="studentPassword" className="mb-1.5 block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="studentPassword"
                type="password"
                value={studentPassword}
                onChange={(e) => setStudentPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {loginError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {loginError}
              </div>
            )}

            <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-600">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <span>
                Proctored exam — fullscreen required, activity monitored
              </span>
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loggingIn ? 'Verifying…' : 'Enter exam'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // phase === 'active'
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Strict-mode grace countdown overlay */}
      {graceCountdown !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-8 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Return to exam</h2>
            <p className="mt-1 text-sm text-gray-600">
              Auto-submit in <span className="font-medium text-gray-900">6 seconds</span> if not returned
            </p>
            <div
              className={`my-6 text-6xl font-bold tabular-nums ${
                graceCountdown <= 2
                  ? 'text-red-600'
                  : graceCountdown <= 4
                    ? 'text-amber-600'
                    : 'text-gray-900'
              }`}
            >
              {graceCountdown}
            </div>
            <button
              onClick={handleReturnToExam}
              className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Return now
            </button>
          </div>
        </div>
      )}

      {/* Sticky top bar */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <span className="min-w-0 truncate text-sm font-medium text-gray-900">{quiz.title}</span>
          <div className="flex shrink-0 items-center gap-3">
            {timeLeft !== null && (
              <span
                className={`rounded-md px-2 py-1 font-mono text-sm font-medium tabular-nums ${
                  timeLeft <= 60
                    ? 'bg-red-50 text-red-600'
                    : timeLeft <= 300
                      ? 'bg-amber-50 text-amber-700'
                      : 'text-gray-700'
                }`}
              >
                {formatTime(timeLeft)}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              Monitored
            </span>
          </div>
        </div>
      </div>

      {socketWarning && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-center text-xs text-amber-800">
          {socketWarning}
        </div>
      )}

      {!inFullscreen && (
        <div className="flex items-center justify-between gap-4 border-b border-amber-200 bg-amber-50 px-6 py-2.5">
          <p className="text-sm font-medium text-amber-900">
            Fullscreen exited — this has been recorded
          </p>
          <button
            onClick={handleReenterFullscreen}
            className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700"
          >
            Return to fullscreen
          </button>
        </div>
      )}

      {/* Questions */}
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {quiz.questions.map((q, i) => (
          <div key={q.id} className="rounded-lg border border-gray-200 bg-white p-6">
            <div className="mb-4 flex gap-3">
              <span className="shrink-0 font-medium tabular-nums text-indigo-600">{i + 1}</span>
              <p className="text-sm text-gray-900">{q.prompt}</p>
            </div>
            <textarea
              rows={8}
              value={answers[q.id] ?? ''}
              onChange={(e) => handleAnswerChange(q.id, e.target.value)}
              onBlur={(e) => handleAnswerBlur(q.id, e.target.value)}
              placeholder="Enter your answer…"
              className="w-full resize-y rounded-md border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        ))}

        <div className="flex flex-col items-start gap-2 border-t border-gray-200 pt-6">
          <button
            onClick={() => doSubmit(false)}
            className="rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Submit quiz
          </button>
          <p className="text-xs text-gray-500">
            Answers saved automatically — submit when finished
          </p>
        </div>
      </main>
    </div>
  );
}
