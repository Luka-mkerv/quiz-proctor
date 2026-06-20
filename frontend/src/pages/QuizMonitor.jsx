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
      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Page header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <Link
              to={`/dashboard/quizzes/${quizId}`}
              className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
            >
              ← Back to quiz
            </Link>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">Live Monitor</h1>
            {studentList.length > 0 && (
              <p className="mt-1 text-sm text-gray-500">
                {studentList.length} student{studentList.length !== 1 ? 's' : ''} active
              </p>
            )}
          </div>
          <div
            className={`mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
              socketOk && !joinError
                ? 'bg-green-50 text-green-700 ring-green-600/20'
                : 'bg-gray-100 text-gray-500 ring-gray-500/20'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                socketOk && !joinError ? 'animate-pulse bg-green-500' : 'bg-gray-400'
              }`}
            />
            {socketOk && !joinError ? 'Connected' : 'Connecting…'}
          </div>
        </div>

        {/* Join / auth error */}
        {joinError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-700">Failed to join monitoring session</p>
            <p className="mt-0.5 text-sm text-red-600">{joinError}</p>
            <p className="mt-2 text-xs text-red-500">
              Make sure the quiz exists and you are the quiz owner.
            </p>
          </div>
        )}

        {/* Empty state */}
        {!joinError && studentList.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white py-20 text-center shadow-sm">
            <p className="text-sm font-medium text-gray-600">Waiting for students to join…</p>
            <p className="mt-1 text-xs text-gray-400">
              Students appear here when their first activity is detected.
            </p>
          </div>
        )}

        {/* Chip grid */}
        {!joinError && studentList.length > 0 && (
          <div className="flex flex-wrap content-start gap-2.5">
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
  const { studentName, violations, disconnected, highlighted } = student;
  const count = violations.length;
  const flagged = count > 0;

  return (
    <button
      onClick={onClick}
      className={[
        // Layout & base
        'relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5',
        'cursor-pointer select-none border text-sm font-medium',
        'transition-all duration-200 focus:outline-none',
        // Permanent color: red once ever-flagged, neutral otherwise
        flagged
          ? 'border-red-700 bg-red-600 text-white hover:bg-red-700'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50',
        // Flash on new violation: pop in scale + a bright halo ring that is
        // distinct from both the steady red fill and the neutral chip.
        highlighted
          ? 'z-10 scale-110 shadow-lg shadow-red-500/30 ring-2 ring-red-400 ring-offset-2'
          : 'shadow-sm',
        // Selected state: indigo ring (only when not flashing, to avoid clash)
        isSelected && !highlighted ? 'ring-2 ring-indigo-500 ring-offset-1' : '',
        // Disconnected: fade the whole chip
        disconnected ? 'opacity-50' : '',
      ].join(' ')}
    >
      {/* Small dot for disconnected indicator */}
      {disconnected && (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${flagged ? 'bg-white/70' : 'bg-gray-400'}`} />
      )}

      <span className="max-w-[12rem] truncate">{studentName}</span>

      {/* Flag count badge — visible only when there are violations */}
      {count > 0 && (
        <span className="inline-flex h-[1.25rem] min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-white/25 px-1 text-xs font-bold leading-none text-white">
          {count}
        </span>
      )}
    </button>
  );
}

function StudentLiveStatus({ student }) {
  const { disconnected, disconnectedAt } = student;
  if (disconnected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block shrink-0" />
        Disconnected{disconnectedAt && ` · ${fmtTime(disconnectedAt)}`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block shrink-0" />
      Active
    </span>
  );
}
