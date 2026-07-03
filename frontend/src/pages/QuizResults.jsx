import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api.js';
import { ViolationPanel } from '../components/ViolationPanel.jsx';
import SqlResultsPanel from '../components/SqlResultsPanel.jsx';

function ExecutionBadge({ lastExecutionSuccess }) {
  if (lastExecutionSuccess === true) {
    return (
      <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
        ✅ Ran successfully
      </span>
    );
  }
  if (lastExecutionSuccess === false) {
    return (
      <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        ❌ Had errors
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
      Not executed
    </span>
  );
}

function MonitorStatus({ socket_connected, submitted_at }) {
  if (socket_connected) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <span className="text-green-600" aria-hidden="true">✓</span>
        Monitored
      </span>
    );
  }
  if (submitted_at) {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
        ⚠️ Bypassed exam interface
      </span>
    );
  }
  return <span className="text-gray-400">—</span>;
}

function SubmissionStatus({ submitted_at, auto_submitted }) {
  if (!submitted_at) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        In progress
      </span>
    );
  }
  if (auto_submitted) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Auto-submitted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
      Submitted
    </span>
  );
}

function GradeCard({ question, answer, quizId, submissionId, onSaved }) {
  const maxPts = parseFloat(question.max_points);
  const [pts, setPts] = useState(answer.points != null ? String(parseFloat(answer.points)) : '');
  const [notes, setNotes] = useState(answer.notes ?? '');
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

  async function handleSave() {
    const num = parseFloat(pts);
    if (isNaN(num) || num < 0 || num > maxPts) {
      setStatus('error');
      return;
    }
    setStatus('saving');
    try {
      await api.post(`/api/quizzes/${quizId}/grades`, {
        submissionId,
        questionId: question.id,
        points: num,
        notes: notes.trim() || null,
      });
      onSaved(question.id, num, notes.trim() || null);
      setStatus('saved');
      setTimeout(() => setStatus(null), 2500);
    } catch {
      setStatus('error');
    }
  }

  const saveLabel =
    status === 'saving' ? 'Saving…' :
    status === 'saved'  ? 'Saved ✓' :
    status === 'error'  ? 'Error — retry' :
    'Save Grade';

  const saveCls =
    status === 'saved'  ? 'bg-green-600 hover:bg-green-700 focus-visible:ring-green-500' :
    status === 'error'  ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500' :
    'bg-indigo-600 hover:bg-indigo-700 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-medium text-gray-900">
          Q{question.question_order + 1}
        </h3>
        <span className="text-xs text-gray-400">{question.max_points} pts</span>
        <ExecutionBadge lastExecutionSuccess={answer.last_execution_success} />
      </div>
      <p className="text-sm text-gray-700">{question.prompt}</p>
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">Answer</p>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-sm text-gray-900">
          {answer.answer_text
            ? answer.answer_text
            : <span className="font-sans italic text-gray-400">No answer</span>
          }
        </pre>
      </div>
      {answer.last_execution_result && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">Last execution result</p>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <SqlResultsPanel results={answer.last_execution_result} compact />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Points</label>
          <input
            type="number"
            min={0}
            max={maxPts}
            step={0.5}
            value={pts}
            onChange={(e) => { setPts(e.target.value); setStatus(null); }}
            className="w-20 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-500">/ {question.max_points}</span>
        </div>
        <input
          type="text"
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setStatus(null); }}
          placeholder="Notes (optional)"
          className="min-w-40 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={handleSave}
          disabled={status === 'saving'}
          className={`shrink-0 rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${saveCls}`}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

function GradingPanel({ submission, questions, quizId, onGradeUpdated, onClose, onPrev, onNext, hasPrev, hasNext }) {
  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-indigo-200 bg-indigo-50/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-indigo-200 bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onPrev}
            disabled={!hasPrev}
            className="rounded-md px-2.5 py-1 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            ← Prev
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900">{submission.student_name}</p>
            <div className="mt-1">
              <SubmissionStatus
                submitted_at={submission.submitted_at}
                auto_submitted={submission.auto_submitted}
              />
            </div>
          </div>
          <button
            onClick={onNext}
            disabled={!hasNext}
            className="rounded-md px-2.5 py-1 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Next →
          </button>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          ✕
        </button>
      </div>

      {/* Grade cards */}
      <div key={submission.id} className="space-y-3 p-5">
        {questions.map((q) => {
          const answer = submission.answers.find((a) => a.question_id === q.id) || {
            question_id: q.id,
            answer_text: '',
            last_execution_success: null,
            last_execution_result: null,
            points: null,
            notes: null,
          };
          return (
            <GradeCard
              key={`${submission.id}-${q.id}`}
              question={q}
              answer={answer}
              quizId={quizId}
              submissionId={submission.id}
              onSaved={(questionId, pts, notes) => onGradeUpdated(submission.id, questionId, pts, notes)}
            />
          );
        })}
      </div>
    </div>
  );
}

function scoreLabel(submission) {
  const possible = submission.total_points_possible;
  if (submission.total_points_awarded == null) return `— / ${possible} pts`;
  const awarded = parseFloat(submission.total_points_awarded);
  const rounded = Number.isInteger(awarded) ? awarded : awarded.toFixed(2).replace(/\.?0+$/, '');
  return `${rounded} / ${possible} pts`;
}

export default function QuizResults() {
  const { id } = useParams();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [gradingIdx, setGradingIdx] = useState(null);
  const [violationId, setViolationId] = useState(null);
  const [reopeningId, setReopeningId] = useState(null);
  const [reopenError, setReopenError] = useState({});
  const [reopenSuccessId, setReopenSuccessId] = useState(null);

  useEffect(() => {
    api.get(`/api/quizzes/${id}/results`)
      .then(({ data }) => setResults(data))
      .catch(() => setError('Failed to load results.'))
      .finally(() => setLoading(false));
  }, [id]);

  function handleGradeUpdated(submissionId, questionId, pts, notes) {
    setResults((prev) => ({
      ...prev,
      submissions: prev.submissions.map((s) => {
        if (s.id !== submissionId) return s;
        const answers = s.answers.map((a) =>
          a.question_id === questionId ? { ...a, points: pts, notes } : a
        );
        const graded = answers.filter((a) => a.points !== null);
        const total_points_awarded =
          graded.length > 0
            ? graded.reduce((sum, a) => sum + parseFloat(a.points), 0)
            : null;
        return { ...s, answers, total_points_awarded };
      }),
    }));
  }

  async function handleReopen(submission) {
    if (!window.confirm(
      `Reopen ${submission.student_name}'s attempt? Their saved answers will be preserved but their database sandbox will be reset. They will need to log back in to continue.`
    )) {
      return;
    }

    setReopeningId(submission.id);
    setReopenError((prev) => ({ ...prev, [submission.id]: '' }));

    try {
      await api.post(`/api/quizzes/${id}/submissions/${submission.id}/reopen`);
      setResults((prev) => ({
        ...prev,
        submissions: prev.submissions.map((s) =>
          s.id === submission.id ? { ...s, submitted_at: null, auto_submitted: false } : s
        ),
      }));
      setReopenSuccessId(submission.id);
      setTimeout(() => {
        setReopenSuccessId((cur) => (cur === submission.id ? null : cur));
      }, 3000);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to reopen submission.';
      setReopenError((prev) => ({ ...prev, [submission.id]: msg }));
    } finally {
      setReopeningId(null);
    }
  }

  if (loading) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  if (error || !results) {
    return (
      <main className="p-8">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error || 'Failed to load results'}
        </div>
        <Link to={`/dashboard/quizzes/${id}`} className="mt-4 inline-block text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
          ← Back
        </Link>
      </main>
    );
  }

  const { questions, submissions, quizStatus } = results;
  const canReopen = (s) => s.submitted_at !== null && (quizStatus === 'open' || quizStatus === 'locked');

  const gradedCount = submissions.filter((s) =>
    questions.length > 0 && s.answers.every((a) => a.points !== null)
  ).length;

  const gradingSubmission = gradingIdx !== null ? submissions[gradingIdx] ?? null : null;
  const violationSubmission = violationId !== null
    ? submissions.find((s) => s.id === violationId) ?? null
    : null;

  return (
    <main className="p-8">
      <div className="mb-6">
        <Link to={`/dashboard/quizzes/${id}`} className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Results & Grading</h1>
        <p className="mt-1 text-sm text-gray-500">
          {submissions.length} submission{submissions.length !== 1 ? 's' : ''}
        </p>
      </div>

      {submissions.length > 0 && (
        <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm">
          <span className="font-medium text-gray-900">Graded:</span>
          <span className="text-gray-700">
            {gradedCount} / {submissions.length}
          </span>
          {gradedCount === submissions.length && submissions.length > 0 && (
            <span className="font-medium text-green-600">✓ Complete</span>
          )}
        </div>
      )}

      {submissions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-500">No submissions yet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Student</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Submitted</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Monitor</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Score</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Flags</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {submissions.map((s, idx) => (
                <tr
                  key={s.id}
                  className={`transition-colors ${gradingIdx === idx ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{s.student_name}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {s.submitted_at
                      ? new Date(s.submitted_at).toLocaleString()
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <SubmissionStatus submitted_at={s.submitted_at} auto_submitted={s.auto_submitted} />
                    {canReopen(s) && (
                      <div className="mt-1.5">
                        <button
                          onClick={() => handleReopen(s)}
                          disabled={reopeningId === s.id}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {reopeningId === s.id ? 'Reopening…' : '↩ Reopen'}
                        </button>
                        {reopenError[s.id] && (
                          <p className="mt-1 max-w-[10rem] text-xs text-red-600">{reopenError[s.id]}</p>
                        )}
                      </div>
                    )}
                    {reopenSuccessId === s.id && (
                      <p className="mt-1 max-w-[10rem] text-xs text-green-600">Reopened — student can now log back in</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <MonitorStatus socket_connected={s.socket_connected} submitted_at={s.submitted_at} />
                  </td>
                  <td className="px-4 py-3 text-gray-700 tabular-nums">
                    <span className={s.total_points_awarded == null ? 'text-gray-400' : 'font-medium text-gray-900'}>
                      {scoreLabel(s)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setViolationId(s.id)}
                      className="group inline-flex cursor-pointer items-center gap-2 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    >
                      {s.violation_count > 0 ? (
                        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 transition-colors group-hover:bg-red-100">
                          {s.violation_count}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setGradingIdx(gradingIdx === idx ? null : idx)}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${
                        gradingIdx === idx
                          ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {gradingIdx === idx ? 'Close' : 'Grade'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gradingSubmission && (
        <GradingPanel
          submission={gradingSubmission}
          questions={questions}
          quizId={id}
          onGradeUpdated={handleGradeUpdated}
          onClose={() => setGradingIdx(null)}
          onPrev={() => setGradingIdx((i) => Math.max(0, i - 1))}
          onNext={() => setGradingIdx((i) => Math.min(submissions.length - 1, i + 1))}
          hasPrev={gradingIdx > 0}
          hasNext={gradingIdx < submissions.length - 1}
        />
      )}

      {violationSubmission && (
        <ViolationPanel
          title={violationSubmission.student_name}
          statusNode={
            <SubmissionStatus
              submitted_at={violationSubmission.submitted_at}
              auto_submitted={violationSubmission.auto_submitted}
            />
          }
          violations={violationSubmission.violations ?? []}
          onClose={() => setViolationId(null)}
        />
      )}
    </main>
  );
}
