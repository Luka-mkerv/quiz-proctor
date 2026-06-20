import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api.js';

const STATUS_STYLES = {
  locked: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  open:   'bg-green-50 text-green-700 ring-green-600/20',
  closed: 'bg-blue-50 text-blue-700 ring-blue-600/20',
};

const STATUS_ACTIONS = [
  { label: 'Lock',  value: 'locked' },
  { label: 'Open',  value: 'open'   },
  { label: 'Close', value: 'closed' },
];

function formatDuration(seconds) {
  if (!seconds) return 'No time limit';
  const mins = Math.round(seconds / 60);
  return `${mins} minute${mins !== 1 ? 's' : ''}`;
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

  useEffect(() => {
    api.get(`/api/quizzes/${id}`)
      .then(({ data }) => setQuiz(data))
      .catch(() => setFetchError('Failed to load quiz.'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleStatusChange(newStatus) {
    if (statusLoading || quiz?.status === newStatus) return;
    setStatusError('');
    setStatusLoading(true);
    try {
      const { data } = await api.patch(`/api/quizzes/${id}/status`, { status: newStatus });
      // Merge returned fields; keep questions array from existing state.
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
      // Clipboard API unavailable — silently ignore.
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  if (fetchError || !quiz) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fetchError || 'Quiz not found.'}
        </p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
          ← Back to quizzes
        </Link>
      </main>
    );
  }

  const studentLink = `${window.location.origin}/quiz/${id}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6">
        <Link to="/dashboard" className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
          ← Back to quizzes
        </Link>
      </div>

      {/* Info + status card */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-4 p-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">{quiz.title}</h1>
            <p className="mt-1 text-sm text-gray-500">{formatDuration(quiz.duration_seconds)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1 ring-inset ${STATUS_STYLES[quiz.status] ?? 'bg-gray-100 text-gray-600 ring-gray-500/20'}`}
            >
              {quiz.status}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                quiz.monitoring_mode === 'strict'
                  ? 'bg-red-50 text-red-700 ring-red-600/20'
                  : 'bg-gray-100 text-gray-500 ring-gray-500/20'
              }`}
            >
              {quiz.monitoring_mode === 'strict' ? 'Strict' : 'Lenient'}
            </span>
          </div>
        </div>

        {/* Status controls */}
        <div className="border-t border-gray-100 px-6 py-5">
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Change status
          </p>
          <div className="inline-flex items-center gap-1 rounded-lg bg-gray-100 p-1">
            {STATUS_ACTIONS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => handleStatusChange(value)}
                disabled={statusLoading || quiz.status === value}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all
                  ${quiz.status === value
                    ? 'cursor-default bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
          {statusError && (
            <p className="mt-2 text-xs font-medium text-red-600">{statusError}</p>
          )}
        </div>

        {/* Student link — only visible when open */}
        {quiz.status === 'open' && (
          <div className="border-t border-gray-100 px-6 py-5">
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Student link
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={studentLink}
                className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
              <button
                onClick={() => handleCopy(studentLink)}
                className="shrink-0 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-indigo-400 hover:text-indigo-600"
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Questions card */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Questions ({quiz.questions?.length ?? 0})
        </h2>
        {quiz.questions?.length > 0 ? (
          <ol className="space-y-3">
            {quiz.questions.map((q, i) => (
              <li key={q.id} className="flex gap-3 text-sm text-gray-800">
                <span className="shrink-0 font-semibold tabular-nums text-gray-400">{i + 1}.</span>
                <span>{q.prompt}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-gray-400">No questions.</p>
        )}
      </div>

      {/* Bottom actions */}
      <div className="flex items-center justify-between">
        <Link
          to={`/dashboard/quizzes/${id}/monitor`}
          className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold shadow-sm transition-all active:scale-[0.98] ${
            quiz.status === 'open'
              ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700'
              : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900'
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              quiz.status === 'open' ? 'animate-pulse bg-white' : 'bg-gray-400'
            }`}
          />
          Live Monitor
        </Link>
        <Link
          to={`/dashboard/quizzes/${id}/results`}
          className="text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-700"
        >
          View results →
        </Link>
      </div>

      {/* Danger zone */}
      <div className="mt-10 flex items-center justify-between rounded-xl border border-red-200 bg-red-50/50 px-6 py-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">Delete this quiz</p>
          <p className="mt-0.5 text-xs text-gray-500">Permanently removes the quiz and all its data.</p>
        </div>
        <button
          onClick={() => { setDeleteError(''); setDeleteConfirming(true); }}
          className="shrink-0 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-sm font-semibold text-red-600 shadow-sm transition-colors hover:bg-red-600 hover:text-white"
        >
          Delete quiz
        </button>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-gray-900/5">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-red-100">
              <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-gray-900">
              Delete "{quiz.title}"?
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              This permanently deletes the quiz and all associated data:
            </p>
            <ul className="mt-3 mb-4 list-inside list-disc space-y-1 text-sm text-gray-600">
              <li>All questions</li>
              <li>All student submissions and answers</li>
              <li>All violation records</li>
            </ul>
            <p className="mb-5 text-sm font-medium text-red-600">This cannot be undone.</p>
            {deleteError && (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {deleteError}
              </p>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteConfirming(false)}
                disabled={deleteLoading}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleteLoading}
                className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-red-300"
              >
                {deleteLoading ? 'Deleting…' : 'Yes, delete this quiz'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
