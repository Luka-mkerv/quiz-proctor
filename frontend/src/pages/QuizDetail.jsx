import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api.js';

const STATUS_STYLES = {
  locked: 'bg-gray-100 text-gray-700 border-gray-200',
  open:   'bg-green-50 text-green-700 border-green-200',
  closed: 'bg-gray-100 text-gray-600 border-gray-200',
};

const STATUS_ACTIONS = [
  { label: 'Lock',  value: 'locked', description: 'Lock — pauses the exam timer for all active students' },
  { label: 'Open',  value: 'open',   description: 'Open — starts or resumes the exam; a paused timer resumes without losing the paused time' },
  { label: 'Close', value: 'closed', description: 'Close — ends the exam and auto-submits all active students' },
];

const SUB_STATUS_STYLES = {
  not_started: 'bg-gray-100 text-gray-600 border-gray-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  submitted:   'bg-green-50 text-green-700 border-green-200',
};

const SUB_STATUS_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted:   'Submitted',
};

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

export default function QuizDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [copied, setCopied] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Database extension state
  const [extension, setExtension] = useState(undefined); // undefined = loading, null = none
  const [extFile, setExtFile] = useState(null);
  const [extUploading, setExtUploading] = useState(false);
  const [extError, setExtError] = useState('');
  const [extRemoving, setExtRemoving] = useState(false);
  const extPollRef = useRef(null);

  // Roster state
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
      setExtension(data); // null if none
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

      // Store plaintext passwords in component state for this session.
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
      await api.post(`/api/quizzes/${id}/extensions/database`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setExtFile(null);
      setExtension({ status: 'restoring' });
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

  if (loading) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  if (fetchError || !quiz) {
    return (
      <main className="p-8">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {fetchError || 'Quiz not found.'}
        </div>
        <Link to="/dashboard" className="mt-4 inline-block text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
          ← Back
        </Link>
      </main>
    );
  }

  const studentLink = `${window.location.origin}/quiz/${id}`;

  return (
    <main className="p-8">
      <div className="mb-6">
        <Link to="/dashboard" className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
          ← Back
        </Link>
      </div>

      {/* Header card */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-gray-900">{quiz.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
              <span>{formatDuration(quiz.duration_seconds)}</span>
              <span className="text-gray-300">•</span>
              <span>{quiz.questions?.length ?? 0} questions</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[quiz.status] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}
            >
              {quiz.status}
            </span>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                quiz.monitoring_mode === 'strict'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-gray-100 text-gray-600 border-gray-200'
              }`}
            >
              {quiz.monitoring_mode === 'strict' ? 'Strict' : 'Lenient'}
            </span>
          </div>
        </div>

        {/* Status controls */}
        <div className="mt-5 border-t border-gray-200 pt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Quiz status
          </p>
          <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 p-1">
            {STATUS_ACTIONS.map(({ label, value, description }) => (
              <button
                key={value}
                onClick={() => handleStatusChange(value)}
                disabled={statusLoading || quiz.status === value}
                title={description}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors
                  ${quiz.status === value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
          {statusError && (
            <p className="mt-2 text-xs text-red-600">{statusError}</p>
          )}
        </div>

        {/* Student link — locked: muted + preview note; open: active; closed: hidden */}
        {quiz.status !== 'closed' && (
          <div className="mt-5 border-t border-gray-200 pt-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Student link
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={studentLink}
                className={`min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  quiz.status === 'open'
                    ? 'border-gray-200 bg-gray-50 text-gray-700'
                    : 'border-gray-200 bg-gray-50 text-gray-400'
                }`}
              />
              <button
                onClick={() => handleCopy(studentLink)}
                className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {quiz.status === 'locked' && (
              <p className="mt-2 text-xs text-gray-400">
                Students who visit this link will see "Quiz is not open yet" — safe to share in advance
              </p>
            )}
          </div>
        )}
      </div>

      {/* Questions card */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
          Questions ({quiz.questions?.length ?? 0})
        </h2>
        {quiz.questions?.length > 0 ? (
          <ol className="space-y-2">
            {quiz.questions.map((q, i) => (
              <li key={q.id} className="flex gap-3 text-sm text-gray-700">
                <span className="shrink-0 font-medium tabular-nums text-gray-400">{i + 1}</span>
                <span>{q.prompt}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-gray-400">No questions</p>
        )}
      </div>

      {/* Roster card */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Roster ({enrollments.length})
          </h2>
          {enrollments.length > 0 && (
            <button
              onClick={handleCopyAllCredentials}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              {copiedCredentials ? 'Copied' : 'Copy all credentials'}
            </button>
          )}
        </div>

        {/* Bulk-add textarea */}
        <div className="mb-4">
          <textarea
            value={rosterText}
            onChange={(e) => setRosterText(e.target.value)}
            rows={4}
            placeholder={`Add students — one per line:\nstudent@uni.edu, Password123\nanother@uni.edu, Password456, Full Name`}
            className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {rosterAddError && (
            <p className="mt-1.5 whitespace-pre-wrap text-xs text-red-600">{rosterAddError}</p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={handleAddToRoster}
              disabled={rosterAddLoading || !rosterText.trim()}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rosterAddLoading ? 'Adding…' : 'Add to roster'}
            </button>
            <p className="text-xs text-gray-400">
              <span className="font-mono">email, password</span> or <span className="font-mono">email, password, name</span>
            </p>
          </div>
        </div>

        {/* Roster table */}
        {rosterLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : rosterError ? (
          <p className="text-sm text-red-600">{rosterError}</p>
        ) : enrollments.length === 0 ? (
          <p className="text-sm text-gray-400">No students enrolled</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2.5 text-left">Email</th>
                    <th className="px-4 py-2.5 text-left">Name</th>
                    <th className="px-4 py-2.5 text-left">Password</th>
                    <th className="px-4 py-2.5 text-left">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {enrollments.map((e) => {
                    const pw = pendingPasswords[e.student_email.toLowerCase()];
                    return (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{e.student_email}</td>
                        <td className="px-4 py-2.5 text-gray-700">{e.full_name || <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {pw
                            ? <span className="text-gray-700">{pw}</span>
                            : <span className="tracking-widest text-gray-400">••••••••</span>
                          }
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${SUB_STATUS_STYLES[e.submission_status]}`}>
                            {SUB_STATUS_LABELS[e.submission_status]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => handleRemoveEnrollment(e)}
                            className="text-xs font-medium text-gray-400 transition-colors hover:text-red-600"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Passwords only visible during this session — hashed immediately on server
            </p>
          </>
        )}
      </div>

      {/* Database Extension card */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">
          Database Extension
        </h2>

        {extension === undefined && (
          <p className="text-sm text-gray-400">Loading…</p>
        )}

        {extension === null && (
          <div>
            <p className="mb-3 text-sm text-gray-500">
              Attach a SQL Server backup (.bak) so each student gets a fresh, writable copy of the database to query during the exam.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept=".bak"
                onChange={(e) => setExtFile(e.target.files[0] ?? null)}
                className="block text-sm text-gray-600 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 file:transition-colors hover:file:bg-gray-50"
              />
              <button
                onClick={handleExtensionUpload}
                disabled={!extFile || extUploading}
                className="shrink-0 rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {extUploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
            {extError && (
              <p className="mt-2 text-xs text-red-600">{extError}</p>
            )}
          </div>
        )}

        {(extension?.status === 'uploading' || extension?.status === 'restoring') && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
            Restoring database… this may take a moment
          </div>
        )}

        {extension?.status === 'ready' && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-600 text-xs font-bold">✓</span>
              <span>
                <span className="font-medium">{extension.original_filename}</span>
                {extension.table_count !== null && (
                  <span className="ml-1 text-gray-400">({extension.table_count} tables)</span>
                )}
              </span>
            </div>
            <button
              onClick={handleExtensionRemove}
              disabled={extRemoving}
              className="shrink-0 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              {extRemoving ? 'Removing…' : 'Remove'}
            </button>
          </div>
        )}

        {extension?.status === 'error' && (
          <div>
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              Restore failed: {extension.error_message || 'Unknown error'}
            </div>
            <button
              onClick={handleExtensionRemove}
              disabled={extRemoving}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {extRemoving ? 'Removing…' : 'Clear and retry'}
            </button>
            {extError && (
              <p className="mt-2 text-xs text-red-600">{extError}</p>
            )}
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="flex items-center justify-between gap-4">
        <Link
          to={`/dashboard/quizzes/${id}/monitor`}
          className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            quiz.status === 'open'
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              quiz.status === 'open' ? 'animate-pulse bg-white' : 'bg-gray-400'
            }`}
          />
          Live monitor
        </Link>
        <Link
          to={`/dashboard/quizzes/${id}/results`}
          className="text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700"
        >
          View results →
        </Link>
      </div>

      {/* Danger zone */}
      <div className="mt-8 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-6 py-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Delete quiz</p>
          <p className="mt-0.5 text-xs text-gray-500">Permanently removes all data</p>
        </div>
        <button
          onClick={() => { setDeleteError(''); setDeleteConfirming(true); }}
          className="shrink-0 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
        >
          Delete
        </button>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-gray-900">
              Delete "{quiz.title}"?
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              This permanently deletes:
            </p>
            <ul className="mt-2 mb-4 list-inside list-disc space-y-1 text-sm text-gray-600">
              <li>All questions</li>
              <li>All student submissions</li>
              <li>All violation records</li>
            </ul>
            <p className="mb-5 text-sm font-medium text-red-600">This cannot be undone</p>
            {deleteError && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {deleteError}
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteConfirming(false)}
                disabled={deleteLoading}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleteLoading}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteLoading ? 'Deleting…' : 'Delete quiz'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
