import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { ViolationPanel, fmtTime } from '../components/ViolationPanel.jsx';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Combine two violation lists, dropping duplicates. Live events and the join
// snapshot can overlap; both carry the DB occurred_at, so type+occurredAt is a
// stable identity. Result is sorted oldest-first to match the panel's ordering.
function mergeViolations(a, b) {
  const seen = new Set();
  const merged = [];
  for (const v of [...a, ...b]) {
    const key = `${v.type}|${v.occurredAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(v);
  }
  merged.sort((x, y) => new Date(x.occurredAt) - new Date(y.occurredAt));
  return merged;
}

export default function QuizMonitor() {
  const { id: quizId } = useParams();
  const [socketOk, setSocketOk] = useState(false);
  const [joinError, setJoinError] = useState('');
  // { [submissionId]: { submissionId, studentName, violations[], disconnected, disconnectedAt, highlighted } }
  const [students, setStudents] = useState({});
  const [selectedId, setSelectedId] = useState(null);

  const socketRef = useRef(null);
  const flashTimersRef = useRef({});

  useEffect(() => {
    const token = localStorage.getItem('token');
    const socket = io(BASE_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketOk(true);
      socket.emit('lecturer:join', { quizId: Number(quizId), token });
    });

    socket.on('disconnect', () => setSocketOk(false));

    socket.on('error', (payload) => {
      setJoinError(payload?.message ?? 'Could not join monitoring session.');
    });

    // Initial history backfill sent right after lecturer:join succeeds.
    socket.on('monitor:snapshot', ({ students: snapshot }) => {
      setStudents((prev) => {
        const next = { ...prev };
        for (const s of snapshot ?? []) {
          const existing = next[s.submissionId];
          next[s.submissionId] = {
            submissionId: s.submissionId,
            studentName: s.studentName,
            disconnected: existing?.disconnected ?? false,
            disconnectedAt: existing?.disconnectedAt ?? null,
            highlighted: existing?.highlighted ?? false,
            violations: mergeViolations(s.violations ?? [], existing?.violations ?? []),
          };
        }
        return next;
      });
    });

    socket.on('violation:new', ({ submissionId, studentName, type, occurredAt }) => {
      setStudents((prev) => ({
        ...prev,
        [submissionId]: {
          submissionId,
          studentName,
          disconnected: false,
          disconnectedAt: null,
          ...(prev[submissionId] ?? {}),
          violations: [...(prev[submissionId]?.violations ?? []), { type, occurredAt }],
          highlighted: true,
        },
      }));

      clearTimeout(flashTimersRef.current[submissionId]);
      flashTimersRef.current[submissionId] = setTimeout(() => {
        setStudents((prev) =>
          prev[submissionId]
            ? { ...prev, [submissionId]: { ...prev[submissionId], highlighted: false } }
            : prev
        );
      }, 2000);
    });

    socket.on('submission:reopened', ({ submissionId, studentEmail }) => {
      // The student hasn't reconnected yet — they still need to log back in
      // — so this is a neutral "pending" state, distinct from both the
      // green "Active" state and the gray "Disconnected" state.
      setStudents((prev) => ({
        ...prev,
        [submissionId]: {
          submissionId,
          studentName: studentEmail,
          violations: [],
          highlighted: false,
          ...(prev[submissionId] ?? {}),
          disconnected: false,
          reconnecting: true,
        },
      }));
    });

    socket.on('student:disconnected', ({ submissionId, studentName, disconnectedAt }) => {
      setStudents((prev) => ({
        ...prev,
        [submissionId]: {
          submissionId,
          studentName,
          violations: [],
          highlighted: false,
          ...(prev[submissionId] ?? {}),
          disconnected: true,
          disconnectedAt,
        },
      }));
    });

    return () => {
      Object.values(flashTimersRef.current).forEach(clearTimeout);
      socket.disconnect();
    };
  }, [quizId]);

  // Sort: most-flagged first (by count desc), then clean students alphabetically
  const studentList = Object.values(students).sort((a, b) => {
    const aCount = a.violations.length;
    const bCount = b.violations.length;
    if (bCount !== aCount) return bCount - aCount;
    return a.studentName.localeCompare(b.studentName);
  });

  const selectedStudent = selectedId ? students[selectedId] ?? null : null;

  function toggleSelected(submissionId) {
    setSelectedId((prev) => (prev === submissionId ? null : submissionId));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="p-8">
        {/* Page header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <Link
              to={`/dashboard/quizzes/${quizId}`}
              className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
            >
              ← Back
            </Link>
            <h1 className="mt-2 text-xl font-semibold text-gray-900">Live Monitor</h1>
            {studentList.length > 0 && (
              <p className="mt-1 text-sm text-gray-500">
                {studentList.length} student{studentList.length !== 1 ? 's' : ''} connected
              </p>
            )}
          </div>
          <div
            className={`mt-1 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              socketOk && !joinError
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-gray-200 bg-gray-100 text-gray-500'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                socketOk && !joinError ? 'animate-pulse bg-green-500' : 'bg-gray-400'
              }`}
            />
            {socketOk && !joinError ? 'Connected' : 'Connecting…'}
          </div>
        </div>

        {/* Join / auth error */}
        {joinError && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-700">Failed to join monitoring session</p>
            <p className="mt-1 text-sm text-red-600">{joinError}</p>
            <p className="mt-2 text-xs text-red-500">
              Verify the quiz exists and you are the owner
            </p>
          </div>
        )}

        {/* Empty state */}
        {!joinError && studentList.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white py-16 text-center">
            <svg className="mb-3 h-12 w-12 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
            </svg>
            <p className="text-sm font-medium text-gray-900">Waiting for students</p>
            <p className="mt-1 text-sm text-gray-500">
              Students will appear when they join the exam
            </p>
          </div>
        )}

        {/* Chip grid */}
        {!joinError && studentList.length > 0 && (
          <div className="flex flex-wrap content-start gap-2">
            {studentList.map((s) => (
              <StudentChip
                key={s.submissionId}
                student={s}
                isSelected={selectedId === s.submissionId}
                onClick={() => toggleSelected(s.submissionId)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Detail side panel — slides in from the right, backdrop closes it */}
      {selectedStudent && (
        <ViolationPanel
          title={selectedStudent.studentName}
          statusNode={<StudentLiveStatus student={selectedStudent} />}
          violations={selectedStudent.violations}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function StudentChip({ student, isSelected, onClick }) {
  const { studentName, violations, disconnected, reconnecting, highlighted } = student;
  const count = violations.length;
  const flagged = count > 0;

  return (
    <button
      onClick={onClick}
      className={[
        'relative inline-flex w-44 items-center gap-2 rounded-md border px-3 py-2',
        'cursor-pointer select-none text-sm font-medium',
        'transition-all duration-150 focus:outline-none',
        flagged
          ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
        highlighted
          ? 'z-10 scale-105 shadow-lg ring-2 ring-red-400 ring-offset-2'
          : '',
        isSelected && !highlighted ? 'ring-2 ring-indigo-500 ring-offset-1' : '',
        disconnected ? 'opacity-50' : '',
      ].join(' ')}
    >
      {disconnected && (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${flagged ? 'bg-white/70' : 'bg-gray-400'}`} />
      )}
      {!disconnected && reconnecting && (
        <span className={`h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${flagged ? 'bg-white/70' : 'bg-amber-400'}`} />
      )}

      <span className="min-w-0 flex-1 truncate text-left">{studentName}</span>

      {count > 0 && (
        <span className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-white/25 px-1.5 text-xs font-bold tabular-nums text-white">
          {count}
        </span>
      )}
    </button>
  );
}

function StudentLiveStatus({ student }) {
  const { disconnected, disconnectedAt, reconnecting } = student;
  if (disconnected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
        Disconnected{disconnectedAt && ` · ${fmtTime(disconnectedAt)}`}
      </span>
    );
  }
  if (reconnecting) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
        <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
        Reopened — waiting for student to log back in
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
      <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-green-500" />
      Active
    </span>
  );
}
