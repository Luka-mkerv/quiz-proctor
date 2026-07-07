import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  Activity, ChevronRight, BarChart2, Users, Wifi, WifiOff, Flag,
} from 'lucide-react';
import { ViolationPanel, fmtTime } from '../components/ViolationPanel.jsx';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

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

  // ── Core socket state ────────────────────────────────────────────────────
  const [socketOk, setSocketOk] = useState(false);
  const [joinError, setJoinError] = useState('');
  // { [submissionId]: { submissionId, studentName, violations[], disconnected, disconnectedAt, highlighted } }
  const [students, setStudents] = useState({});
  const [selectedId, setSelectedId] = useState(null);

  const socketRef = useRef(null);
  const flashTimersRef = useRef({});

  // ── UI-only state ────────────────────────────────────────────────────────
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'flagged' | 'clean'
  const [sortBy, setSortBy] = useState('flags');            // 'flags' | 'name' | 'joined'

  // ── Socket setup ─────────────────────────────────────────────────────────

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

  // ── Handlers ─────────────────────────────────────────────────────────────

  const selectedStudent = selectedId ? students[selectedId] ?? null : null;

  function toggleSelected(submissionId) {
    setSelectedId((prev) => (prev === submissionId ? null : submissionId));
  }

  // ── Derived display data ─────────────────────────────────────────────────

  const allStudents = Object.values(students).sort((a, b) => {
    if (sortBy === 'name') return a.studentName.localeCompare(b.studentName);
    if (sortBy === 'joined') return a.submissionId - b.submissionId;
    // 'flags' — most-flagged first, then alphabetical
    const diff = b.violations.length - a.violations.length;
    if (diff !== 0) return diff;
    return a.studentName.localeCompare(b.studentName);
  });

  const filteredStudents = allStudents.filter((s) => {
    if (activeFilter === 'flagged') return s.violations.length > 0;
    if (activeFilter === 'clean')   return s.violations.length === 0;
    return true;
  });

  const totalStudents  = allStudents.length;
  const onlineStudents = allStudents.filter((s) => !s.disconnected).length;
  const flaggedCount   = allStudents.filter((s) => s.violations.length > 0).length;
  const cleanCount     = totalStudents - flaggedCount;
  const totalFlags     = allStudents.reduce((sum, s) => sum + s.violations.length, 0);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">

      {/* ── Breadcrumb header ────────────────────────────────────────────── */}
      <header className="border-b border-gray-200 bg-white px-6 py-3">
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/dashboard"
            className="text-gray-500 transition-colors hover:text-gray-900"
          >
            Quizzes
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
          <Link
            to={`/dashboard/quizzes/${quizId}`}
            className="text-gray-500 transition-colors hover:text-gray-900"
          >
            Quiz
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
          <span className="font-medium text-gray-900">Live Monitor</span>
        </nav>
      </header>

      {/* ── Page body ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl space-y-5 px-6 py-6 pb-24">

          {/* ── Stats header card ───────────────────────────────────────── */}
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                {/* Title + connection badge */}
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                    <Activity className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-lg font-semibold text-gray-900">Live Monitor</h1>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs',
                          socketOk && !joinError
                            ? 'border-green-300 bg-green-50 text-green-700'
                            : 'border-gray-300 bg-gray-100 text-gray-500',
                        )}
                      >
                        <span
                          className={cn(
                            'mr-1.5 inline-block h-1.5 w-1.5 rounded-full',
                            socketOk && !joinError
                              ? 'animate-pulse bg-green-500'
                              : 'bg-gray-400',
                          )}
                        />
                        {socketOk && !joinError ? 'Connected' : 'Connecting…'}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Stats row */}
                {totalStudents > 0 && (
                  <div className="flex items-center divide-x divide-gray-200 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
                    <StatPill label="Students" value={totalStudents} icon={<Users className="h-3.5 w-3.5" />} />
                    <StatPill label="Online"   value={onlineStudents} icon={<Wifi className="h-3.5 w-3.5" />}  valueClass="text-green-600" />
                    <StatPill label="Flagged"  value={flaggedCount}  icon={<Flag className="h-3.5 w-3.5" />}   valueClass={flaggedCount > 0 ? 'text-red-600' : undefined} />
                    <StatPill label="Total Flags" value={totalFlags} icon={<Flag className="h-3.5 w-3.5" />}   valueClass={totalFlags > 0 ? 'text-red-600' : undefined} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Error state ─────────────────────────────────────────────── */}
          {joinError && (
            <Alert variant="destructive">
              <AlertDescription>
                <span className="font-medium">Failed to join monitoring session — </span>
                {joinError}
                <span className="block mt-1 text-xs opacity-80">
                  Verify the quiz exists and you are the owner.
                </span>
              </AlertDescription>
            </Alert>
          )}

          {/* ── Filter + sort bar ───────────────────────────────────────── */}
          {!joinError && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Filter tabs */}
              <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1">
                {[
                  { key: 'all',     label: 'All',     count: totalStudents },
                  { key: 'flagged', label: 'Flagged', count: flaggedCount },
                  { key: 'clean',   label: 'Clean',   count: cleanCount },
                ].map(({ key, label, count }) => (
                  <button
                    key={key}
                    onClick={() => setActiveFilter(key)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      activeFilter === key
                        ? 'bg-gray-900 text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-900',
                    )}
                  >
                    {label}
                    <span
                      className={cn(
                        'ml-1.5 rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                        activeFilter === key
                          ? 'bg-white/20 text-white'
                          : 'bg-gray-100 text-gray-600',
                      )}
                    >
                      {count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Sort tabs */}
              <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1">
                {[
                  { key: 'name',   label: 'Name' },
                  { key: 'flags',  label: 'Flags' },
                  { key: 'joined', label: 'Joined' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      sortBy === key
                        ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
                        : 'text-gray-500 hover:text-gray-900',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Empty state ─────────────────────────────────────────────── */}
          {!joinError && totalStudents === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-white">
                  <Users className="h-7 w-7 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-900">Waiting for students</p>
                <p className="mt-1 text-sm text-gray-500">
                  Students will appear here when they join the exam
                </p>
              </CardContent>
            </Card>
          )}

          {/* ── Filtered-empty state ────────────────────────────────────── */}
          {!joinError && totalStudents > 0 && filteredStudents.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-sm text-gray-400">No students match this filter</p>
              </CardContent>
            </Card>
          )}

          {/* ── Chip grid ───────────────────────────────────────────────── */}
          {!joinError && filteredStudents.length > 0 && (
            <div className="flex flex-wrap content-start gap-2">
              {filteredStudents.map((s) => (
                <StudentChip
                  key={s.submissionId}
                  student={s}
                  isSelected={selectedId === s.submissionId}
                  onClick={() => toggleSelected(s.submissionId)}
                />
              ))}
            </div>
          )}

        </div>
      </div>

      {/* ── Sticky bottom bar ───────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-56 right-0 z-10 flex items-center justify-between border-t border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              socketOk && !joinError ? 'animate-pulse bg-green-500' : 'bg-gray-400',
            )}
          />
          <span className="text-sm font-medium text-gray-700">Live Monitor</span>
          {totalStudents > 0 && (
            <span className="text-xs text-gray-400">
              · {onlineStudents} of {totalStudents} online
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/dashboard/quizzes/${quizId}/results`}>
            <BarChart2 className="h-3.5 w-3.5 mr-1.5" />
            Reports
          </Link>
        </Button>
      </div>

      {/* ── Detail side panel — slides in from the right ───────────────────── */}
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatPill({ label, value, icon, valueClass }) {
  return (
    <div className="flex flex-col items-center px-4 py-2.5 min-w-[72px]">
      <span className={cn('text-lg font-bold tabular-nums leading-none', valueClass ?? 'text-gray-900')}>
        {value}
      </span>
      <span className="mt-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-gray-400">
        {icon}
        {label}
      </span>
    </div>
  );
}

function StudentChip({ student, isSelected, onClick }) {
  const { studentName, violations, disconnected, reconnecting, highlighted } = student;
  const count = violations.length;
  const flagged = count > 0;

  const dotClass = flagged
    ? 'bg-white/70'
    : disconnected
    ? 'bg-gray-400'
    : reconnecting
    ? 'animate-pulse bg-amber-400'
    : 'animate-pulse bg-green-500';

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative inline-flex w-44 items-center gap-2 rounded-lg border px-3 py-2',
        'cursor-pointer select-none text-sm font-medium',
        'transition-all duration-150 focus:outline-none',
        flagged
          ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
          : disconnected
          ? 'border-gray-200 bg-white text-gray-400 opacity-60 hover:opacity-100'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300',
        highlighted && 'z-10 scale-105 shadow-lg ring-2 ring-red-400 ring-offset-2',
        isSelected && !highlighted && 'ring-2 ring-indigo-500 ring-offset-1',
      )}
    >
      {/* Status dot — always visible */}
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClass)} />

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
