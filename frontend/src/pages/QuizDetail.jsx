import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Lock, LockOpen, X, Eye, EyeOff, Copy, Check, Trash2,
  AlertTriangle, Database, ExternalLink, ChevronRight,
  Activity, BarChart2, Upload,
} from 'lucide-react';
import api from '../lib/api.js';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

// ─── Display constants ────────────────────────────────────────────────────────

const STATUS_BADGE = {
  locked: { label: 'Locked', className: 'border-gray-300 bg-gray-100 text-gray-700' },
  open:   { label: 'Open',   className: 'border-green-300 bg-green-50 text-green-700' },
  closed: { label: 'Closed', className: 'border-gray-300 bg-gray-100 text-gray-600' },
};

const STATUS_ACTIONS = [
  { label: 'Lock',  value: 'locked', Icon: Lock,     description: 'Lock — pauses the exam timer for all active students' },
  { label: 'Open',  value: 'open',   Icon: LockOpen,  description: 'Open — starts or resumes the exam; a paused timer resumes without losing the paused time' },
  { label: 'Close', value: 'closed', Icon: X,         description: 'Close — ends the exam and auto-submits all active students' },
];

const SUB_STATUS_STYLES = {
  not_started: 'border-blue-200 bg-blue-50 text-blue-700',
  in_progress: 'border-amber-200 bg-amber-50 text-amber-700',
  submitted:   'border-green-200 bg-green-50 text-green-700',
  flagged:     'border-red-200 bg-red-50 text-red-700',
};

const SUB_STATUS_LABELS = {
  not_started: 'Enrolled',
  in_progress: 'In Progress',
  submitted:   'Submitted',
  flagged:     'Flagged',
};

const ENGINE_LABELS = { sqlserver: 'SQL Server', postgres: 'PostgreSQL' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds) return 'No time limit';
  const mins = Math.round(seconds / 60);
  return `${mins} minute${mins !== 1 ? 's' : ''}`;
}

function parseRosterText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const students = [];
  const errors = [];

  for (const line of lines) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 2) {
      errors.push(`Invalid line (expected email, password): "${line}"`);
      continue;
    }
    const [email, password, ...nameParts] = parts;
    const fullName = nameParts.join(', ').trim() || undefined;
    students.push({ email, password, fullName });
  }

  return { students, errors };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function QuizDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  // ── Core quiz state ──────────────────────────────────────────────────────
  const [quiz, setQuiz] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [copied, setCopied] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // ── Database extension state ─────────────────────────────────────────────
  const [extension, setExtension] = useState(undefined);
  const [extEngine, setExtEngine] = useState('sqlserver');
  const [extFile, setExtFile] = useState(null);
  const [extUploading, setExtUploading] = useState(false);
  const [extError, setExtError] = useState('');
  const [extRemoving, setExtRemoving] = useState(false);
  const extPollRef = useRef(null);

  // ── Roster state ─────────────────────────────────────────────────────────
  const [enrollments, setEnrollments] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState('');
  const [rosterText, setRosterText] = useState('');
  const [rosterAddLoading, setRosterAddLoading] = useState(false);
  const [rosterAddError, setRosterAddError] = useState('');
  // Plaintext passwords stored in component state for current session only.
  // Keys are lowercased emails. Cleared on page reload — by design.
  const [pendingPasswords, setPendingPasswords] = useState({});
  const [copiedCredentials, setCopiedCredentials] = useState(false);

  // ── UI-only state (no API impact) ────────────────────────────────────────
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterStatusFilter, setRosterStatusFilter] = useState('all');
  const [visiblePasswords, setVisiblePasswords] = useState(new Set());

  // ── Data loaders ─────────────────────────────────────────────────────────

  const loadEnrollments = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/quizzes/${id}/enrollments`);
      setEnrollments(data);
      setRosterError('');
    } catch {
      setRosterError('Failed to load roster.');
    } finally {
      setRosterLoading(false);
    }
  }, [id]);

  const loadExtension = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/quizzes/${id}/extensions/database`);
      setExtension(data);
    } catch {
      setExtension(null);
    }
  }, [id]);

  // Poll extension status while restoring.
  const startExtPoll = useCallback(() => {
    if (extPollRef.current) return;
    extPollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/api/quizzes/${id}/extensions/database`);
        setExtension(data);
        if (data?.status === 'ready' || data?.status === 'error' || !data) {
          clearInterval(extPollRef.current);
          extPollRef.current = null;
        }
      } catch {
        // ignore transient errors — keep polling
      }
    }, 2000);
  }, [id]);

  useEffect(() => {
    return () => {
      if (extPollRef.current) clearInterval(extPollRef.current);
    };
  }, []);

  useEffect(() => {
    api.get(`/api/quizzes/${id}`)
      .then(({ data }) => setQuiz(data))
      .catch(() => setFetchError('Failed to load quiz.'))
      .finally(() => setLoading(false));

    loadEnrollments();
    loadExtension();
  }, [id, loadEnrollments, loadExtension]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleStatusChange(newStatus) {
    if (statusLoading || quiz?.status === newStatus) return;
    setStatusError('');
    setStatusLoading(true);
    try {
      const { data } = await api.patch(`/api/quizzes/${id}/status`, { status: newStatus });
      setQuiz((prev) => ({ ...prev, ...data }));
    } catch {
      setStatusError('Status update failed. Please try again.');
    } finally {
      setStatusLoading(false);
    }
  }

  async function handleDeleteConfirm() {
    setDeleteError('');
    setDeleteLoading(true);
    try {
      await api.delete(`/api/quizzes/${id}`);
      navigate('/dashboard');
    } catch {
      setDeleteError('Delete failed. Please try again.');
      setDeleteLoading(false);
    }
  }

  async function handleCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable.
    }
  }

  async function handleAddToRoster() {
    const { students, errors } = parseRosterText(rosterText);

    if (errors.length > 0) {
      setRosterAddError(errors.join('\n'));
      return;
    }
    if (students.length === 0) {
      setRosterAddError('Please enter at least one student.');
      return;
    }

    setRosterAddLoading(true);
    setRosterAddError('');

    try {
      await api.post(`/api/quizzes/${id}/enrollments`, { students });

      setPendingPasswords((prev) => {
        const next = { ...prev };
        for (const s of students) {
          next[s.email.toLowerCase().trim()] = s.password;
        }
        return next;
      });

      setRosterText('');
      await loadEnrollments();
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to add students.';
      setRosterAddError(msg);
    } finally {
      setRosterAddLoading(false);
    }
  }

  async function handleRemoveEnrollment(enrollment) {
    if (!window.confirm(`Remove ${enrollment.student_email} from this exam?`)) return;

    try {
      await api.delete(`/api/quizzes/${id}/enrollments/${enrollment.id}`);
      setEnrollments((prev) => prev.filter((e) => e.id !== enrollment.id));
      setPendingPasswords((prev) => {
        const next = { ...prev };
        delete next[enrollment.student_email.toLowerCase()];
        return next;
      });
    } catch {
      setRosterError('Failed to remove student.');
    }
  }

  async function handleExtensionUpload() {
    if (!extFile) return;
    setExtUploading(true);
    setExtError('');
    try {
      const formData = new FormData();
      formData.append('file', extFile);
      await api.post(`/api/quizzes/${id}/extensions/database?engine=${extEngine}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setExtFile(null);
      setExtension({ status: 'restoring', engine: extEngine });
      startExtPoll();
    } catch (err) {
      setExtError(err.response?.data?.error || 'Upload failed.');
    } finally {
      setExtUploading(false);
    }
  }

  async function handleExtensionRemove() {
    if (!window.confirm('Remove the database extension? This will drop the template database and delete the backup file.')) return;
    setExtRemoving(true);
    setExtError('');
    try {
      await api.delete(`/api/quizzes/${id}/extensions/database`);
      setExtension(null);
    } catch (err) {
      setExtError(err.response?.data?.error || 'Failed to remove extension.');
    } finally {
      setExtRemoving(false);
    }
  }

  async function handleCopyAllCredentials() {
    const lines = enrollments.map((e) => {
      const pw = pendingPasswords[e.student_email.toLowerCase()] || '••••••••';
      return `${e.student_email} | ${pw}`;
    });

    const text = [
      `${quiz?.title ?? 'Exam'} — Student Credentials`,
      '─'.repeat(40),
      ...lines,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopiedCredentials(true);
      setTimeout(() => setCopiedCredentials(false), 2000);
    } catch {
      // Clipboard API unavailable.
    }
  }

  function togglePasswordVisibility(enrollmentId) {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      if (next.has(enrollmentId)) next.delete(enrollmentId);
      else next.add(enrollmentId);
      return next;
    });
  }

  // ── Derived display data ─────────────────────────────────────────────────

  const filteredEnrollments = enrollments.filter((e) => {
    const matchSearch = !rosterSearch
      || e.student_email.toLowerCase().includes(rosterSearch.toLowerCase());
    const matchStatus = rosterStatusFilter === 'all'
      || e.submission_status === rosterStatusFilter;
    return matchSearch && matchStatus;
  });

  const rosterCounts = enrollments.reduce((acc, e) => {
    const s = e.submission_status || 'not_started';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  // ── Loading / error screens ───────────────────────────────────────────────

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  if (fetchError || !quiz) {
    return (
      <main className="p-8">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{fetchError || 'Quiz not found.'}</AlertDescription>
        </Alert>
        <Link
          to="/dashboard"
          className="mt-4 inline-block text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
        >
          ← Back
        </Link>
      </main>
    );
  }

  const studentLink = `${window.location.origin}/quiz/${id}`;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">

      {/* ── Breadcrumb header ────────────────────────────────────────────── */}
      <header className="border-b border-gray-200 bg-white px-6 py-3">
        <nav className="flex items-center gap-1 text-sm">
          <Link to="/dashboard" className="text-gray-500 hover:text-gray-900 transition-colors">
            Quizzes
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
          <span className="font-medium text-gray-900">{quiz.title}</span>
        </nav>
      </header>

      {/* ── Scrollable page body ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-6 pb-24">

          {/* ── Quiz header card ────────────────────────────────────────── */}
          <Card>
            <CardContent className="pt-6">
              {/* Title row */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                    <Lock className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-xl font-semibold text-gray-900">{quiz.title}</h1>
                      <Badge
                        variant="outline"
                        className={cn(
                          'shrink-0 capitalize',
                          STATUS_BADGE[quiz.status]?.className
                            ?? 'border-gray-300 bg-gray-100 text-gray-600',
                        )}
                      >
                        {STATUS_BADGE[quiz.status]?.label ?? quiz.status}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Status action buttons */}
                <div className="flex shrink-0 items-center gap-2">
                  {STATUS_ACTIONS.map(({ label, value, Icon, description }) => (
                    <Button
                      key={value}
                      variant={quiz.status === value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleStatusChange(value)}
                      disabled={statusLoading || quiz.status === value}
                      title={description}
                      className={cn(
                        quiz.status === value && 'bg-gray-900 hover:bg-gray-800 text-white',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              {statusError && (
                <Alert variant="destructive" className="mt-4">
                  <AlertDescription>{statusError}</AlertDescription>
                </Alert>
              )}

              <Separator className="my-4" />

              {/* Info bar */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-600">
                <span>
                  <span className="text-gray-400">Duration:</span>{' '}
                  <span className="font-medium">{formatDuration(quiz.duration_seconds)}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-gray-400">Mode:</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs',
                      quiz.monitoring_mode === 'strict'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-gray-200 bg-gray-50 text-gray-600',
                    )}
                  >
                    {quiz.monitoring_mode === 'strict' ? 'Strict' : 'Lenient'}
                  </Badge>
                </span>
                <span>
                  <span className="text-gray-400">Questions:</span>{' '}
                  <span className="font-medium">{quiz.questions?.length ?? 0} questions</span>
                </span>
                {quiz.created_at && (
                  <span>
                    <span className="text-gray-400">Created:</span>{' '}
                    <span className="font-medium">
                      {new Date(quiz.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </span>
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Student Link card ───────────────────────────────────────── */}
          {quiz.status !== 'closed' && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Student Link</CardTitle>
                  <CardDescription>Share this URL with enrolled students</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    readOnly
                    value={studentLink}
                    className={cn(
                      'font-mono text-xs',
                      quiz.status === 'locked' && 'text-gray-400',
                    )}
                  />
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleCopy(studentLink)}
                    className="shrink-0 bg-indigo-600 hover:bg-indigo-700"
                  >
                    {copied
                      ? <><Check className="h-3.5 w-3.5 mr-1.5" />Copied</>
                      : <><Copy className="h-3.5 w-3.5 mr-1.5" />Copy</>}
                  </Button>
                  <Button variant="outline" size="icon" className="shrink-0" asChild>
                    <a href={studentLink} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  This link is unique to this exam session. Students will be prompted to authenticate
                  before accessing the exam.
                </p>
                {quiz.status === 'locked' && (
                  <p className="text-xs text-gray-400">
                    Students who visit this link will see &quot;Quiz is not open yet&quot; — safe to share in advance
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Student Roster card ─────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">Student Roster</CardTitle>
                  <Badge variant="secondary" className="text-xs px-2 py-0.5">
                    {enrollments.length}
                  </Badge>
                  {rosterCounts.not_started > 0 && (
                    <Badge variant="outline" className="text-xs border-blue-200 bg-blue-50 text-blue-700">
                      {rosterCounts.not_started} Enrolled
                    </Badge>
                  )}
                  {rosterCounts.in_progress > 0 && (
                    <Badge variant="outline" className="text-xs border-amber-200 bg-amber-50 text-amber-700">
                      {rosterCounts.in_progress} In Progress
                    </Badge>
                  )}
                  {rosterCounts.submitted > 0 && (
                    <Badge variant="outline" className="text-xs border-green-200 bg-green-50 text-green-700">
                      {rosterCounts.submitted} Submitted
                    </Badge>
                  )}
                  {rosterCounts.flagged > 0 && (
                    <Badge variant="outline" className="text-xs border-red-200 bg-red-50 text-red-700">
                      {rosterCounts.flagged} Flagged
                    </Badge>
                  )}
                </div>
                {enrollments.length > 0 && (
                  <Button variant="outline" size="sm" onClick={handleCopyAllCredentials}>
                    {copiedCredentials
                      ? <><Check className="h-3.5 w-3.5 mr-1.5" />Copied</>
                      : <><Copy className="h-3.5 w-3.5 mr-1.5" />Copy all credentials</>}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Bulk Add Students */}
              <div className="space-y-2">
                <div>
                  <h3 className="text-sm font-medium text-gray-800">Bulk Add Students</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Paste one email address per line. Passwords will be auto-generated.
                  </p>
                </div>
                <Textarea
                  value={rosterText}
                  onChange={(e) => setRosterText(e.target.value)}
                  rows={4}
                  placeholder={`student1@uni.edu\nstudent2@uni.edu\nstudent3@uni.edu`}
                  className="font-mono text-sm resize-y"
                />
                {rosterAddError && (
                  <Alert variant="destructive">
                    <AlertDescription className="whitespace-pre-wrap text-xs">
                      {rosterAddError}
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleAddToRoster}
                    disabled={rosterAddLoading || !rosterText.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700"
                  >
                    {rosterAddLoading ? 'Adding…' : 'Add'}
                  </Button>
                  <p className="text-xs text-gray-400">
                    Format:{' '}
                    <code className="font-mono">email, password</code>
                    {' '}or{' '}
                    <code className="font-mono">email, password, name</code>
                  </p>
                </div>
              </div>

              {/* Search + filter */}
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Search by email…"
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  className="text-sm flex-1"
                />
                <select
                  value={rosterStatusFilter}
                  onChange={(e) => setRosterStatusFilter(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-gray-700 ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="all">All Status</option>
                  <option value="not_started">Enrolled</option>
                  <option value="in_progress">In Progress</option>
                  <option value="submitted">Submitted</option>
                  <option value="flagged">Flagged</option>
                </select>
              </div>

              {/* Roster table */}
              {rosterLoading ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : rosterError ? (
                <Alert variant="destructive">
                  <AlertDescription>{rosterError}</AlertDescription>
                </Alert>
              ) : enrollments.length === 0 ? (
                <p className="text-sm text-gray-400">No students enrolled yet</p>
              ) : (
                <>
                  <div className="rounded-md border border-gray-200 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50 hover:bg-gray-50">
                          <TableHead className="text-xs font-medium uppercase tracking-wide text-gray-500 h-10">
                            Email
                          </TableHead>
                          <TableHead className="text-xs font-medium uppercase tracking-wide text-gray-500 h-10">
                            Password
                          </TableHead>
                          <TableHead className="text-xs font-medium uppercase tracking-wide text-gray-500 h-10">
                            Status
                          </TableHead>
                          <TableHead className="text-xs font-medium uppercase tracking-wide text-gray-500 h-10 text-right">
                            Remove
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredEnrollments.map((e) => {
                          const pw = pendingPasswords[e.student_email.toLowerCase()];
                          const isVisible = visiblePasswords.has(e.id);
                          return (
                            <TableRow key={e.id}>
                              <TableCell className="py-3 font-mono text-xs text-gray-700">
                                {e.student_email}
                              </TableCell>
                              <TableCell className="py-3">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-xs">
                                    {pw && isVisible
                                      ? <span className="text-gray-700">{pw}</span>
                                      : <span className="tracking-widest text-gray-400">••••••••</span>}
                                  </span>
                                  {pw ? (
                                    <button
                                      onClick={() => togglePasswordVisibility(e.id)}
                                      className="text-gray-400 hover:text-gray-600 transition-colors"
                                      title={isVisible ? 'Hide password' : 'Show password'}
                                    >
                                      {isVisible
                                        ? <EyeOff className="h-3.5 w-3.5" />
                                        : <Eye className="h-3.5 w-3.5" />}
                                    </button>
                                  ) : (
                                    <Eye className="h-3.5 w-3.5 text-gray-300" />
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="py-3">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-xs',
                                    SUB_STATUS_STYLES[e.submission_status]
                                      ?? 'border-gray-200 bg-gray-50 text-gray-600',
                                  )}
                                >
                                  {SUB_STATUS_LABELS[e.submission_status] ?? e.submission_status}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-3 text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-gray-400 hover:text-red-600 hover:bg-red-50"
                                  onClick={() => handleRemoveEnrollment(e)}
                                  title={`Remove ${e.student_email}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Showing {filteredEnrollments.length} of {enrollments.length} students</span>
                    <span>Passwords only visible during this session — hashed immediately on server</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Database Extension card ─────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="h-4 w-4 text-gray-500" />
                  Database Extension
                </CardTitle>
                <CardDescription>Attach supplementary files to the exam database</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">

              {extension === undefined && (
                <p className="text-sm text-gray-400">Loading…</p>
              )}

              {extension === null && (
                <div className="space-y-4">
                  {/* Engine picker */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Engine</p>
                    <div className="flex flex-wrap items-center gap-5">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                        <input
                          type="radio"
                          name="extEngine"
                          value="sqlserver"
                          checked={extEngine === 'sqlserver'}
                          onChange={() => { setExtEngine('sqlserver'); setExtFile(null); }}
                        />
                        SQL Server (.bak file)
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                        <input
                          type="radio"
                          name="extEngine"
                          value="postgres"
                          checked={extEngine === 'postgres'}
                          onChange={() => { setExtEngine('postgres'); setExtFile(null); }}
                        />
                        PostgreSQL (.sql dump file)
                      </label>
                    </div>
                    <p className="text-xs text-gray-400">
                      {extEngine === 'postgres'
                        ? 'Upload a .sql dump file (output of pg_dump)'
                        : 'Upload a .bak backup file from SQL Server Management Studio'}
                    </p>
                  </div>

                  {/* Drop zone */}
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 py-10 transition-colors hover:border-indigo-400 hover:bg-indigo-50/20">
                    <Upload className="h-8 w-8 text-gray-400" />
                    <p className="text-sm text-gray-500">Drop files here or click to upload</p>
                    <input
                      type="file"
                      accept={extEngine === 'postgres' ? '.sql' : '.bak'}
                      onChange={(e) => setExtFile(e.target.files[0] ?? null)}
                      className="hidden"
                    />
                  </label>

                  {/* Selected file row */}
                  {extFile && (
                    <div className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3">
                      <span className="text-sm text-gray-700 truncate mr-4">{extFile.name}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          onClick={handleExtensionUpload}
                          disabled={extUploading}
                          className="bg-indigo-600 hover:bg-indigo-700"
                        >
                          {extUploading ? 'Uploading…' : 'Upload'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setExtFile(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {extError && (
                    <Alert variant="destructive">
                      <AlertDescription>{extError}</AlertDescription>
                    </Alert>
                  )}
                </div>
              )}

              {(extension?.status === 'uploading' || extension?.status === 'restoring') && (
                <div className="flex items-center gap-3 py-2 text-sm text-gray-500">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                  Restoring database… this may take a moment
                </div>
              )}

              {extension?.status === 'ready' && (
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Attached Files
                  </p>
                  <div className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Database className="h-4 w-4 shrink-0 text-gray-400" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-700 truncate">
                          {extension.original_filename}
                        </p>
                        <p className="text-xs text-gray-400">
                          {ENGINE_LABELS[extension.engine] ?? 'SQL Server'}
                          {extension.table_count !== null
                            ? ` · ${extension.table_count} tables`
                            : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 ml-4">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
                        <Check className="h-3 w-3 text-green-600" />
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-400 hover:text-red-600 hover:bg-red-50"
                        onClick={handleExtensionRemove}
                        disabled={extRemoving}
                        title="Remove database extension"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {extension?.status === 'error' && (
                <div className="space-y-3">
                  <Alert variant="destructive">
                    <AlertDescription>
                      Restore failed: {extension.error_message || 'Unknown error'}
                    </AlertDescription>
                  </Alert>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExtensionRemove}
                    disabled={extRemoving}
                  >
                    {extRemoving ? 'Removing…' : 'Clear and retry'}
                  </Button>
                  {extError && (
                    <Alert variant="destructive">
                      <AlertDescription>{extError}</AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Danger Zone card ────────────────────────────────────────── */}
          <Card className="border-red-200 bg-red-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-red-600">
                <AlertTriangle className="h-4 w-4" />
                Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="text-sm font-medium text-gray-900">Delete this quiz</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Permanently removes this quiz, all student submissions, proctoring logs,
                    and associated data. This action cannot be undone.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="shrink-0"
                  onClick={() => { setDeleteError(''); setDeleteConfirming(true); }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete Quiz
                </Button>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* ── Sticky bottom action bar ────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-56 right-0 z-10 flex items-center justify-between border-t border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-medium text-gray-700">{quiz.title}</span>
          {quiz.questions?.length != null && (
            <span className="shrink-0 text-xs text-gray-400">
              · {quiz.questions.length} questions
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/dashboard/quizzes/${id}/results`}>
              <BarChart2 className="h-3.5 w-3.5 mr-1.5" />
              View Results
            </Link>
          </Button>
          <Button
            size="sm"
            className={cn(
              quiz.status === 'open'
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
            )}
            asChild
          >
            <Link to={`/dashboard/quizzes/${id}/monitor`}>
              <span
                className={cn(
                  'mr-1.5 inline-block h-1.5 w-1.5 rounded-full',
                  quiz.status === 'open' ? 'animate-pulse bg-white' : 'bg-gray-400',
                )}
              />
              <Activity className="h-3.5 w-3.5 mr-1" />
              Live Monitor
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Delete confirmation dialog ──────────────────────────────────────── */}
      <Dialog
        open={deleteConfirming}
        onOpenChange={(open) => { if (!deleteLoading) setDeleteConfirming(open); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <DialogTitle>Delete &ldquo;{quiz.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently deletes:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-inside list-disc space-y-1 pl-1 text-sm text-gray-600">
            <li>All questions</li>
            <li>All student submissions</li>
            <li>All violation records</li>
          </ul>
          <p className="text-sm font-medium text-red-600">This cannot be undone</p>
          {deleteError && (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteConfirming(false)}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteLoading}
            >
              {deleteLoading ? 'Deleting…' : 'Delete quiz'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
