import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../lib/api.js';

export default function QuizNew() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [monitoringMode, setMonitoringMode] = useState('lenient');
  const [questions, setQuestions] = useState([{ prompt: '' }]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  function addQuestion() {
    setQuestions((prev) => [...prev, { prompt: '' }]);
  }

  function removeQuestion(index) {
    if (questions.length === 1) return;
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateQuestion(index, value) {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = { prompt: value };
      return next;
    });
  }

  function validate() {
    const errs = {};
    if (!title.trim()) errs.title = 'Title is required.';
    if (questions.some((q) => !q.prompt.trim())) {
      errs.questions = 'All question prompts must be filled in.';
    }
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setApiError('');
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setLoading(true);

    try {
      const payload = {
        title: title.trim(),
        monitoringMode,
        questions: questions.map((q) => ({ prompt: q.prompt.trim() })),
      };
      const mins = parseFloat(durationMinutes);
      if (durationMinutes !== '' && mins > 0) {
        payload.durationSeconds = Math.round(mins * 60);
      }
      await api.post('/api/quizzes', payload);
      navigate('/dashboard');
    } catch (err) {
      setApiError(err.response?.data?.error ?? 'Failed to create quiz. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-8">
        <Link to="/dashboard" className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
          ← Back to quizzes
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-gray-900">Create Quiz</h1>
        <p className="mt-1 text-sm text-gray-500">Add a title, an optional time limit, and your questions.</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-7 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-7">
          {/* Title */}
          <div>
            <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-gray-700">
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. SQL Fundamentals Quiz"
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            {fieldErrors.title && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{fieldErrors.title}</p>
            )}
          </div>

          {/* Duration */}
          <div>
            <label htmlFor="duration" className="mb-1.5 block text-sm font-medium text-gray-700">
              Duration{' '}
              <span className="font-normal text-gray-400">(minutes, optional)</span>
            </label>
            <input
              id="duration"
              type="number"
              min="1"
              step="1"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              placeholder="e.g. 60"
              className="w-36 rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>

          {/* Monitoring Mode */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Monitoring Mode</label>
            <div className="space-y-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  monitoringMode === 'lenient'
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="monitoringMode"
                  value="lenient"
                  checked={monitoringMode === 'lenient'}
                  onChange={() => setMonitoringMode('lenient')}
                  className="mt-0.5 accent-indigo-600"
                />
                <div>
                  <span className="block text-sm font-semibold text-gray-800">Lenient</span>
                  <span className="text-xs text-gray-500">Violations are flagged and logged; the student continues answering normally.</span>
                </div>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  monitoringMode === 'strict'
                    ? 'border-red-400 bg-red-50'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="monitoringMode"
                  value="strict"
                  checked={monitoringMode === 'strict'}
                  onChange={() => setMonitoringMode('strict')}
                  className="mt-0.5 accent-red-600"
                />
                <div>
                  <span className="block text-sm font-semibold text-gray-800">Strict</span>
                  <span className="text-xs text-gray-500">Any violation triggers a 6-second grace countdown — return in time to continue, or the quiz auto-submits.</span>
                </div>
              </label>
            </div>
          </div>

          {/* Questions */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Questions</label>
            <div className="space-y-2.5">
              {questions.map((q, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="w-5 shrink-0 text-right text-xs font-medium tabular-nums text-gray-400">{i + 1}.</span>
                  <input
                    type="text"
                    value={q.prompt}
                    onChange={(e) => updateQuestion(i, e.target.value)}
                    placeholder={`Question ${i + 1}`}
                    className="flex-1 rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                  <button
                    type="button"
                    onClick={() => removeQuestion(i)}
                    disabled={questions.length === 1}
                    aria-label="Remove question"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {fieldErrors.questions && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{fieldErrors.questions}</p>
            )}
            <button
              type="button"
              onClick={addQuestion}
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-700"
            >
              + Add question
            </button>
          </div>

          {apiError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {apiError}
            </p>
          )}

          <div className="flex items-center gap-3 border-t border-gray-100 pt-5">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300"
            >
              {loading ? 'Creating…' : 'Create Quiz'}
            </button>
            <Link
              to="/dashboard"
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
