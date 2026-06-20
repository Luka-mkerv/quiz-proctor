import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api.js';
import { ViolationPanel } from '../components/ViolationPanel.jsx';

// All field names confirmed against backend GET /api/quizzes/:id/results:
// snake_case: student_name, submitted_at, auto_submitted, violation_count

function SubmissionStatus({ submitted_at, auto_submitted }) {
  if (!submitted_at) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/20">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        In progress
      </span>
    );
  }
  if (auto_submitted) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Auto-submitted (time expired)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
      Submitted on time
    </span>
  );
}

export default function QuizResults() {
  const { id } = useParams();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    api.get(`/api/quizzes/${id}/results`)
      .then(({ data }) => setResults(data))
      .catch(() => setError('Failed to load results.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm text-gray-500">Loading results…</p>
      </main>
    );
  }

  if (error || !results) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error || 'Failed to load results.'}
        </p>
        <Link to={`/dashboard/quizzes/${id}`} className="mt-4 inline-block text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
          ← Back to quiz
        </Link>
      </main>
    );
  }

  const { submissions } = results;
  const selectedSubmission = selectedId
    ? submissions.find((s) => s.id === selectedId) ?? null
    : null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <Link to={`/dashboard/quizzes/${id}`} className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
          ← Back to quiz
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-gray-900">Results</h1>
        <p className="mt-1 text-sm text-gray-500">
          {submissions.length} submission{submissions.length !== 1 ? 's' : ''}
        </p>
      </div>

      {submissions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-20 text-center shadow-sm">
          <p className="text-sm text-gray-500">No submissions yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Student</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Submitted at</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {submissions.map((s) => (
                <tr key={s.id} className="transition-colors hover:bg-gray-50/70">
                  <td className="px-5 py-3.5 font-medium text-gray-900">{s.student_name}</td>
                  <td className="px-5 py-3.5">
                    <SubmissionStatus
                      submitted_at={s.submitted_at}
                      auto_submitted={s.auto_submitted}
                    />
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">
                    {s.submitted_at
                      ? new Date(s.submitted_at).toLocaleString()
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => setSelectedId(s.id)}
                      className="group inline-flex cursor-pointer items-center gap-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                      title="View violation history"
                    >
                      {s.violation_count > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20 transition-colors group-hover:bg-red-100">
                          {s.violation_count} flag{s.violation_count !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                      <span className="text-xs font-medium text-indigo-600 transition-colors group-hover:text-indigo-700 group-hover:underline">
                        View history
                      </span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedSubmission && (
        <ViolationPanel
          title={selectedSubmission.student_name}
          statusNode={
            <SubmissionStatus
              submitted_at={selectedSubmission.submitted_at}
              auto_submitted={selectedSubmission.auto_submitted}
            />
          }
          violations={selectedSubmission.violations ?? []}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  );
}
