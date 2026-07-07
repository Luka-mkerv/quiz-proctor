import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import axios from 'axios';
import CodeMirror from '@uiw/react-codemirror';
import { sql as sqlLang, MSSQL, PostgreSQL } from '@codemirror/lang-sql';
import { Play, Send, Maximize2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import SqlResultsPanel from '../components/SqlResultsPanel.jsx';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

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

// Shared between session-restore and a fresh login — a student who was
// reopened by a lecturer logs back in via the form (submit clears
// sessionStorage), not via session-restore, so both paths need to repopulate
// previously saved answers the same way.
function mergeAnswersIntoState(questions, answers) {
  const init = {};
  questions.forEach((q) => { init[q.id] = ''; });
  const resultsInit = {};
  const executedSet = new Set();
  for (const a of answers) {
    init[a.questionId] = a.answerText;
    if (a.lastExecutionResult) {
      resultsInit[a.questionId] = a.lastExecutionResult;
      executedSet.add(a.questionId);
    }
  }
  return { init, resultsInit, executedSet };
}

export default function QuizPage() {
  const { id: quizId } = useParams();

  // 'loading' | 'entry' | 'active' | 'submitted' | 'error'
  const [phase, setPhase] = useState('loading');
  const [quiz, setQuiz] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [loadingLabel, setLoadingLabel] = useState('Loading…');

  // Login form
  const [studentEmail, setStudentEmail] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Active quiz UI
  const [answers, setAnswers] = useState({});
  const [hasDbExtension, setHasDbExtension] = useState(false);
  const [dbEngine, setDbEngine] = useState('sqlserver');
  const [sqlResults, setSqlResults] = useState({});
  const [sqlRunning, setSqlRunning] = useState({});
  const [sqlRunError, setSqlRunError] = useState({});
  const [timeLeft, setTimeLeft] = useState(null);
  const [socketWarning, setSocketWarning] = useState('');
  const [inFullscreen, setInFullscreen] = useState(false);
  const [graceCountdown, setGraceCountdown] = useState(null);
  const [currentlyPaused, setCurrentlyPaused] = useState(false);

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
  const executedQuestionsRef = useRef(new Set());

  // Timer fields, mirrored into refs so the tick() closure (running inside a
  // setInterval set up once) always reads the latest values — pause/resume
  // socket events update these without needing to restart the interval.
  const openedAtRef = useRef(null);
  const totalPausedSecondsRef = useRef(0);
  const pausedAtRef = useRef(null);
  const durationSecondsRef = useRef(null);

  // --- Initial quiz fetch ---
  useEffect(() => {
    // Strict Mode in development double-invokes effects (run → cleanup → run).
    // The cleanup sets canceled = true so the first run's stale .then() is a
    // no-op, preventing it from creating duplicate side-effects alongside the
    // second run.
    let canceled = false;

    // Try to restore an in-progress session from this tab. Read synchronously
    // up front (not inside the quiz-fetch .then()) so the saved-answers fetch
    // can run in parallel with the quiz fetch rather than after it.
    let sess = null;
    const sessionStr = sessionStorage.getItem(`studentSession_${quizId}`);
    if (sessionStr) {
      try {
        const parsed = JSON.parse(sessionStr);
        const payload = decodeJwtPayload(parsed.token);
        if (
          payload &&
          String(payload.quizId) === String(quizId) &&
          payload.exp * 1000 > Date.now()
        ) {
          sess = parsed;
        } else {
          sessionStorage.removeItem(`studentSession_${quizId}`);
        }
      } catch {
        sessionStorage.removeItem(`studentSession_${quizId}`);
      }
    }

    if (sess) setLoadingLabel('Restoring your exam session…');

    const quizPromise = publicApi.get(`/api/public/quizzes/${quizId}`);
    // Pre-caught: a failed answers fetch shouldn't drop a restoring student
    // to the error screen — worst case they just see blank editors, same as
    // before this fix.
    const answersPromise = sess
      ? publicApi
          .get(`/api/public/submissions/${sess.submissionId}/answers`, {
            headers: { Authorization: `Bearer ${sess.token}` },
          })
          .catch(() => ({ data: { answers: [] } }))
      : Promise.resolve({ data: { answers: [] } });

    Promise.all([quizPromise, answersPromise])
      .then(([quizRes, answersRes]) => {
        if (canceled) return;
        const data = quizRes.data;
        setQuiz(data);

        if (sess) {
          studentTokenRef.current = sess.token;
          submissionIdRef.current = sess.submissionId;
          setHasDbExtension(Boolean(sess.hasDatabaseExtension));
          setDbEngine(sess.dbEngine || 'sqlserver');

          // Pre-populate editors from previously saved answers — a student
          // who refreshes mid-exam should see their saved work, not blank
          // fields, and last-run SQL results should reappear too.
          const { init, resultsInit, executedSet } = mergeAnswersIntoState(
            data.questions,
            answersRes.data.answers
          );
          setAnswers(init);
          setSqlResults(resultsInit);
          executedQuestionsRef.current = executedSet;

          // Use the freshly-fetched quiz data for timer fields, not the
          // session snapshot from login time — the lecturer may have
          // locked/unlocked the quiz since then, and this fetch reflects
          // the current state (including currentlyPaused) immediately,
          // so a refresh mid-pause lands on the pause overlay rather
          // than a stale unpaused timer.
          setTimerFields({
            openedAt: data.openedAt,
            totalPausedSeconds: data.totalPausedSeconds,
            pausedAt: data.pausedAt,
            currentlyPaused: data.currentlyPaused,
            durationSeconds: data.durationSeconds,
          });
          startTimer();
          monitorCleanupRef.current = setupMonitoring(data.monitoringMode === 'strict');

          // Socket is created by the socket useEffect below once phase
          // becomes 'active' — do NOT create it here.
          setPhase('active');
          return;
        }

        setPhase('entry');
      })
      .catch((err) => {
        if (canceled) return;
        const status = err.response?.status;
        const serverMsg = err.response?.data?.error;
        if (status === 404) {
          setErrorMsg('Quiz not found.');
        } else if (status === 403 && serverMsg === 'This exam has been closed.') {
          // Quiz is truly over (not just locked) — the backend already
          // distinguishes this from a mid-exam lock, which now returns 200.
          setErrorMsg(serverMsg);
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

    socket.on('quiz:paused', ({ pausedAt: serverPausedAt }) => {
      pausedAtRef.current = serverPausedAt;
      setCurrentlyPaused(true);
    });

    socket.on('quiz:resumed', ({ totalPausedSeconds: newTotal }) => {
      totalPausedSecondsRef.current = newTotal;
      pausedAtRef.current = null;
      setCurrentlyPaused(false);
    });

    socket.on('quiz:closed', () => {
      // Forced by the lecturer closing the quiz — no confirm dialog, same
      // auto-submit path as timer expiry.
      doSubmit(true);
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

  // Snapshots the server's timer fields into refs (read by the tick loop)
  // and mirrors currentlyPaused into state for rendering the overlay/icon.
  function setTimerFields({ openedAt, totalPausedSeconds, pausedAt, currentlyPaused: paused, durationSeconds }) {
    openedAtRef.current = openedAt;
    totalPausedSecondsRef.current = totalPausedSeconds || 0;
    pausedAtRef.current = paused ? pausedAt : null;
    durationSecondsRef.current = durationSeconds;
    setCurrentlyPaused(Boolean(paused));
  }

  // The exam timer runs from the quiz's single opened_at (set once, by the
  // lecturer opening the quiz) rather than from each student's own login —
  // total_paused_seconds and a live pausedAt freeze it during a lecturer lock.
  function computeRemaining() {
    const durationSeconds = durationSecondsRef.current;
    const openedAt = openedAtRef.current;
    if (!openedAt || !durationSeconds) return null;

    const now = Date.now();
    const elapsed = (now - new Date(openedAt).getTime()) / 1000
      - totalPausedSecondsRef.current
      - (pausedAtRef.current ? (now - new Date(pausedAtRef.current).getTime()) / 1000 : 0);

    return Math.max(0, durationSeconds - elapsed);
  }

  function startTimer() {
    if (!durationSecondsRef.current || timerRef.current) return;

    const tick = () => {
      const remaining = computeRemaining();
      if (remaining === null) return;
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        setTimeLeft(0);
        doSubmit(true);
        return;
      }
      setTimeLeft(Math.ceil(remaining));
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
        hasDatabaseExtension: data.hasDatabaseExtension,
        dbEngine: data.dbEngine,
        openedAt: data.openedAt,
        totalPausedSeconds: data.totalPausedSeconds,
        pausedAt: data.pausedAt,
        currentlyPaused: data.currentlyPaused,
      }));
      setHasDbExtension(Boolean(data.hasDatabaseExtension));
      setDbEngine(data.dbEngine || 'sqlserver');

      try {
        await document.documentElement.requestFullscreen();
        setInFullscreen(true);
      } catch {
        // Browser denied — banner appears, student can re-enter manually.
      }

      // Socket is created by the socket useEffect once phase becomes 'active'.
      monitorCleanupRef.current = setupMonitoring(quiz.monitoringMode === 'strict');

      // Fetch any previously saved answers — covers both a student resuming
      // after closing the tab (sessionStorage expired/cleared) and a student
      // logging back in after a lecturer reopened their submission, since
      // submit() clears sessionStorage and neither case goes through the
      // session-restore path above.
      let savedAnswers = [];
      try {
        const answersRes = await publicApi.get(
          `/api/public/submissions/${data.submissionId}/answers`,
          { headers: { Authorization: `Bearer ${data.token}` } }
        );
        savedAnswers = answersRes.data.answers;
      } catch {
        // Fresh submission, or the fetch failed — proceed with blank editors.
      }
      const { init, resultsInit, executedSet } = mergeAnswersIntoState(quiz.questions, savedAnswers);
      setAnswers(init);
      setSqlResults(resultsInit);
      executedQuestionsRef.current = executedSet;

      setTimerFields({
        openedAt: data.openedAt,
        totalPausedSeconds: data.totalPausedSeconds,
        pausedAt: data.pausedAt,
        currentlyPaused: data.currentlyPaused,
        durationSeconds: data.durationSeconds,
      });
      startTimer();

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

  function handleSqlChange(questionId, value) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function handleOptionSelect(questionId, letter) {
    setAnswers((prev) => ({ ...prev, [questionId]: letter }));
    clearTimeout(autosaveTimersRef.current[questionId]);
    delete autosaveTimersRef.current[questionId];
    saveAnswer(questionId, letter);
  }

  async function handleRunQuery(questionId) {
    if (!submissionIdRef.current || submittedRef.current) return;
    const sqlText = answers[questionId] || '';

    setSqlRunning((prev) => ({ ...prev, [questionId]: true }));
    setSqlRunError((prev) => ({ ...prev, [questionId]: '' }));

    try {
      const { data } = await publicApi.post(
        '/api/public/student/execute',
        { questionId, sql: sqlText },
        { headers: { Authorization: `Bearer ${studentTokenRef.current}` } }
      );
      setSqlResults((prev) => ({ ...prev, [questionId]: data.results }));
      executedQuestionsRef.current.add(questionId);
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not run query. Please try again.';
      setSqlRunError((prev) => ({ ...prev, [questionId]: msg }));
    } finally {
      setSqlRunning((prev) => ({ ...prev, [questionId]: false }));
    }
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

  function getUnrunSqlQuestions() {
    if (!hasDbExtension || !quiz) return [];
    return quiz.questions.filter((q) =>
      q.question_type === 'sql' &&
      !executedQuestionsRef.current.has(q.id) && (answers[q.id] || '').trim().length > 0
    );
  }

  function handleManualSubmitClick() {
    const unrun = getUnrunSqlQuestions();
    if (unrun.length > 0) {
      const labels = unrun
        .map((q) => `Q${quiz.questions.findIndex((x) => x.id === q.id) + 1}`)
        .join(', ');
      if (!window.confirm(`You have unrun queries in ${labels}. Submit anyway?`)) {
        return;
      }
    }
    doSubmit(false);
  }

  async function doSubmit(autoSubmitted) {
    if (submittedRef.current) return;
    submittedRef.current = true;

    if (graceIntervalRef.current) { clearInterval(graceIntervalRef.current); graceIntervalRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (monitorCleanupRef.current) { monitorCleanupRef.current(); monitorCleanupRef.current = null; }
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }

    // Safety net: save any unrun SQL editor content as plain answer text so
    // the lecturer can still read it, even though it was never executed.
    const unrun = getUnrunSqlQuestions();
    if (unrun.length > 0) {
      try {
        await Promise.all(unrun.map((q) =>
          publicApi.post(
            `/api/public/submissions/${submissionIdRef.current}/answers`,
            { questionId: q.id, answerText: answers[q.id] },
            { headers: { Authorization: `Bearer ${studentTokenRef.current}` } }
          ).catch((err) => {
            console.error(`Pre-submit save failed for question ${q.id}:`, err);
          })
        ));
      } catch (err) {
        console.error('Pre-submit SQL save failed:', err);
      }
    }

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

  // ── Loading ──────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">{loadingLabel}</p>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-8">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <AlertTriangle className="h-6 w-6 text-gray-500" />
            </div>
            <p className="text-sm text-gray-700">{errorMsg}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Submitted ─────────────────────────────────────────────────────────────
  if (phase === 'submitted') {
    const isViolationSubmit = submitReasonRef.current === 'violation';
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-8">
            {isViolationSubmit ? (
              <>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                </div>
                <Badge variant="outline" className="mb-3 border-red-200 bg-red-50 text-red-700">
                  Auto-submitted
                </Badge>
                <h1 className="text-lg font-semibold text-gray-900">Quiz submitted</h1>
                <p className="mt-2 text-sm text-gray-600">
                  Your quiz was automatically submitted because you did not return within the time limit.
                  Your answers up to this point have been recorded.
                </p>
              </>
            ) : (
              <>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                </div>
                <h1 className="text-lg font-semibold text-gray-900">Submitted</h1>
                <p className="mt-2 text-sm text-gray-600">
                  Your answers have been recorded. You may close this window.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Entry (login form) ────────────────────────────────────────────────────
  if (phase === 'entry') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md space-y-4">
          {/* Quiz info card */}
          <Card>
            <CardContent className="pt-5 pb-4">
              <h1 className="text-xl font-semibold text-gray-900">{quiz.title}</h1>
              <p className="mt-1 text-sm text-gray-500">
                {quiz.questions.length} question{quiz.questions.length !== 1 ? 's' : ''}
                {quiz.durationSeconds
                  ? ` · ${Math.round(quiz.durationSeconds / 60)} min`
                  : ' · No time limit'}
              </p>
            </CardContent>
          </Card>

          {/* Login form card */}
          <Card>
            <CardContent className="pt-6">
              <form
                onSubmit={(e) => { e.preventDefault(); handleLogin(); }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="studentEmail">Email</Label>
                  <Input
                    id="studentEmail"
                    type="email"
                    value={studentEmail}
                    onChange={(e) => setStudentEmail(e.target.value)}
                    placeholder="you@university.edu"
                    autoFocus
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="studentPassword">Password</Label>
                  <Input
                    id="studentPassword"
                    type="password"
                    value={studentPassword}
                    onChange={(e) => setStudentPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>

                {loginError && (
                  <Alert variant="destructive">
                    <AlertDescription>{loginError}</AlertDescription>
                  </Alert>
                )}

                <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <span>Proctored exam — fullscreen required, activity monitored</span>
                </div>

                <Button
                  type="submit"
                  disabled={loggingIn}
                  className="w-full bg-indigo-600 hover:bg-indigo-700"
                >
                  {loggingIn ? 'Verifying…' : 'Enter exam'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Active (exam in progress) ─────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Pause overlay — not dismissable by the student */}
      {currentlyPaused && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/80 px-4">
          <Card className="w-full max-w-md text-center shadow-xl">
            <CardContent className="pt-8 pb-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <span className="text-2xl" aria-hidden="true">⏸</span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Exam Paused</h2>
              <p className="mt-2 text-sm text-gray-600">
                Your lecturer has temporarily paused the exam. Please wait — your work is saved and
                the timer has stopped.
              </p>
              <p className="mt-3 text-sm font-medium text-gray-900">Do not close this window.</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Strict-mode grace countdown overlay */}
      {graceCountdown !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 px-4">
          <Card className="w-full max-w-md text-center shadow-xl">
            <CardContent className="pt-8 pb-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Return to exam</h2>
              <p className="mt-1 text-sm text-gray-600">
                Auto-submit in{' '}
                <span className="font-medium text-gray-900">6 seconds</span>{' '}
                if not returned
              </p>
              <div
                className={cn(
                  'my-6 text-6xl font-bold tabular-nums',
                  graceCountdown <= 2
                    ? 'text-red-600'
                    : graceCountdown <= 4
                      ? 'text-amber-600'
                      : 'text-gray-900',
                )}
              >
                {graceCountdown}
              </div>
              <Button
                onClick={handleReturnToExam}
                className="w-full bg-indigo-600 hover:bg-indigo-700"
              >
                Return now
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sticky top bar */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <span className="min-w-0 truncate text-sm font-medium text-gray-900">{quiz.title}</span>
          <div className="flex shrink-0 items-center gap-3">
            {timeLeft !== null && (
              <span
                className={cn(
                  'rounded-md px-2.5 py-1 font-mono text-sm font-medium tabular-nums',
                  currentlyPaused
                    ? 'bg-gray-100 text-gray-500'
                    : timeLeft <= 60
                      ? 'bg-red-50 text-red-600'
                      : timeLeft <= 300
                        ? 'bg-amber-50 text-amber-700'
                        : 'text-gray-700',
                )}
              >
                {currentlyPaused ? '⏸' : formatTime(timeLeft)}
              </span>
            )}
            <Badge
              variant="outline"
              className="border-green-200 bg-green-50 text-green-700 text-xs"
            >
              <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              Monitored
            </Badge>
          </div>
        </div>

        {/* Socket warning */}
        {socketWarning && (
          <div className="border-t border-amber-200 bg-amber-50 px-6 py-2 text-center text-xs text-amber-800">
            {socketWarning}
          </div>
        )}

        {/* Fullscreen warning */}
        {!inFullscreen && (
          <div className="flex items-center justify-between gap-4 border-t border-amber-200 bg-amber-50 px-6 py-2.5">
            <p className="text-sm font-medium text-amber-900">
              Fullscreen exited — this has been recorded
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReenterFullscreen}
              className="shrink-0 border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200"
            >
              <Maximize2 className="h-3.5 w-3.5 mr-1.5" />
              Return to fullscreen
            </Button>
          </div>
        )}
      </div>

      {/* Questions */}
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {quiz.questions.map((q, i) => (
          <Card key={q.id}>
            <CardContent className="pt-6">
              {/* Question prompt */}
              <div className="mb-5 flex gap-3">
                <span className="shrink-0 font-semibold tabular-nums text-indigo-600">{i + 1}</span>
                <p className="text-sm text-gray-900 leading-relaxed">{q.prompt}</p>
              </div>

              {/* Multiple choice */}
              {q.question_type === 'multiple_choice' && (
                <div className="space-y-2">
                  {q.options?.map((opt) => {
                    const selected = answers[q.id] === opt.letter;
                    return (
                      <button
                        key={opt.letter}
                        type="button"
                        onClick={() => handleOptionSelect(q.id, opt.letter)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors',
                          'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
                          selected
                            ? 'border-indigo-400 bg-indigo-50 text-indigo-900'
                            : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                            selected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500',
                          )}
                        >
                          {opt.letter}
                        </span>
                        <span>{opt.text}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* SQL editor */}
              {q.question_type === 'sql' && hasDbExtension && (
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-lg border border-gray-300">
                    <CodeMirror
                      value={answers[q.id] ?? ''}
                      height="200px"
                      extensions={[sqlLang({ dialect: dbEngine === 'postgres' ? PostgreSQL : MSSQL })]}
                      onChange={(value) => handleSqlChange(q.id, value)}
                      placeholder="Write your SQL query here..."
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={() => handleRunQuery(q.id)}
                      disabled={sqlRunning[q.id]}
                      className="bg-indigo-600 hover:bg-indigo-700"
                    >
                      <Play className="h-3.5 w-3.5 mr-1.5" />
                      {sqlRunning[q.id] ? 'Running…' : 'Run Query'}
                    </Button>
                    <p className="text-xs text-gray-500">
                      Your query is saved each time you run it.
                      {' '}
                      {dbEngine === 'postgres'
                        ? 'Use semicolons to separate statements.'
                        : 'Use GO to separate batches.'}
                    </p>
                  </div>
                  {sqlRunError[q.id] && (
                    <Alert variant="destructive">
                      <AlertDescription>{sqlRunError[q.id]}</AlertDescription>
                    </Alert>
                  )}
                  {sqlResults[q.id] && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <SqlResultsPanel results={sqlResults[q.id]} compact={false} />
                    </div>
                  )}
                </div>
              )}

              {/* Open text / SQL without DB extension */}
              {(q.question_type === 'open' || (q.question_type === 'sql' && !hasDbExtension)) && (
                <Textarea
                  rows={8}
                  value={answers[q.id] ?? ''}
                  onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                  onBlur={(e) => handleAnswerBlur(q.id, e.target.value)}
                  placeholder="Enter your answer…"
                  className="resize-y"
                />
              )}
            </CardContent>
          </Card>
        ))}

        {/* Submit section */}
        <div className="flex flex-col items-start gap-2 border-t border-gray-200 pt-6 pb-8">
          <Button
            onClick={handleManualSubmitClick}
            size="lg"
            className="bg-indigo-600 hover:bg-indigo-700 px-8"
          >
            <Send className="h-4 w-4 mr-2" />
            Submit quiz
          </Button>
          <p className="text-xs text-gray-500">
            Answers saved automatically — submit when finished
          </p>
        </div>
      </main>
    </div>
  );
}
