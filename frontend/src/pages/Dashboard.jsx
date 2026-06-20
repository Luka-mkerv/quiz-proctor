import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api.js';

const STATUS_STYLES = {
  locked: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  open:   'bg-green-50 text-green-700 ring-green-600/20',
  closed: 'bg-blue-50 text-blue-700 ring-blue-600/20',
};

function formatDuration(seconds) {
  if (!seconds) return '—';
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

export default function Dashboard() {
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/quizzes')
      .then(({ data }) => setQuizzes(data))
      .catch(() => setError('Failed to load quizzes.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Your Quizzes</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create, monitor, and review your proctored quizzes.
          </p>
        </div>
        <Link
          to="/dashboard/quizzes/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 5a.75.75 0 0 1 .75.75v3.5h3.5a.75.75 0 0 1 0 1.5h-3.5v3.5a.75.75 0 0 1-1.5 0v-3.5h-3.5a.75.75 0 0 1 0-1.5h3.5v-3.5A.75.75 0 0 1 10 5Z" />
          </svg>
          Create Quiz
        </Link>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {!loading && !error && quizzes.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-20 text-center shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">No quizzes yet</h2>
          <p className="mx-auto mt-1 mb-6 max-w-xs text-sm text-gray-500">
            Get started by creating your first proctored quiz.
          </p>
          <Link
            to="/dashboard/quizzes/new"
            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98]"
          >
            Create Quiz
          </Link>
        </div>
      )}

      {!loading && !error && quizzes.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Title</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Duration</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {quizzes.map((quiz) => (
                <tr
                  key={quiz.id}
                  className="group transition-colors hover:bg-gray-50/70"
                >
                  <td className="px-5 py-3.5">
                    <Link
                      to={`/dashboard/quizzes/${quiz.id}`}
                      className="font-medium text-gray-900 transition-colors group-hover:text-indigo-600"
                    >
                      {quiz.title}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${STATUS_STYLES[quiz.status] ?? 'bg-gray-100 text-gray-600 ring-gray-500/20'}`}
                    >
                      {quiz.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-gray-600">{formatDuration(quiz.duration_seconds)}</td>
                  <td className="px-5 py-3.5 text-gray-500">{formatDate(quiz.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
