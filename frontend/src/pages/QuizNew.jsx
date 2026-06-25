import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../lib/api.js';

export default function QuizNew() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [monitoringMode, setMonitoringMode] = useState('lenient');
  const [questions, setQuestions] = useState([{ prompt: '', maxPoints: 10 }]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  function addQuestion() {
    setQuestions((prev) => [...prev, { prompt: '', maxPoints: 10 }]);
  }

  function removeQuestion(index) {
    if (questions.length === 1) return;
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateQuestion(index, field, value) {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
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
        questions: questions.map((q) => ({
          prompt: q.prompt.trim(),
          max_points: Number(q.maxPoints) || 10,
        })),
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
    <main className="p-8">
      <div className="mb-6">
        <Link to="/dashboard" className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Create Quiz</h1>
        <p className="mt-1 text-sm text-gray-500">Configure your examination parameters and questions</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Title + Duration row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-gray-700">
                Title
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. SQL Fundamentals Exam"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {fieldErrors.title && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.title}</p>
              )}
            </div>

            <div>
              <label htmlFor="duration" className="mb-1.5 block text-sm font-medium text-gray-700">
                Duration <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="duration"
                  type="number"
                  min="1"
                  step="1"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="60"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-500">min</span>
              </div>
            </div>
          </div>

          {/* Monitoring Mode */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Proctoring mode</label>
            <div className="space-y-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${
                  monitoringMode === 'lenient'
                    ? 'border-indigo-300 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300'
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
                  <span className="block text-sm font-medium text-gray-900">Lenient</span>
                  <span className="mt-0.5 block text-xs text-gray-500">Violations logged; student continues exam</span>
                </div>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${
                  monitoringMode === 'strict'
                    ? 'border-red-300 bg-red-50'
                    : 'border-gray-200 hover:border-gray-300'
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
                  <span className="block text-sm font-medium text-gray-900">Strict</span>
                  <span className="mt-0.5 block text-xs text-gray-500">Violations trigger 6-second countdown; auto-submit if not resolved</span>
                </div>
              </label>
            </div>
          </div>

          {/* Questions */}
          <div>
            <label className="mb-3 block text-sm font-medium text-gray-700">Questions</label>
            <div className="space-y-2">
              {questions.map((q, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-2 w-6 shrink-0 text-right text-xs font-medium tabular-nums text-gray-400">{i + 1}</span>
                  <input
                    type="text"
                    value={q.prompt}
                    onChange={(e) => updateQuestion(i, 'prompt', e.target.value)}
                    placeholder={`Question ${i + 1}`}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <div className="flex shrink-0 items-center gap-1.5">
                    <input
                      type="number"
                      value={q.maxPoints}
                      onChange={(e) => updateQuestion(i, 'maxPoints', e.target.value)}
                      min={1}
                      max={100}
                      aria-label={`Points for question ${i + 1}`}
                      className="w-16 rounded-md border border-gray-300 px-2 py-2 text-right text-sm text-gray-900 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-gray-400">pts</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeQuestion(i)}
                    disabled={questions.length === 1}
                    aria-label="Remove question"
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {fieldErrors.questions && (
              <p className="mt-1.5 text-xs text-red-600">{fieldErrors.questions}</p>
            )}
            <button
              type="button"
              onClick={addQuestion}
              className="mt-3 text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700"
            >
              + Add question
            </button>
          </div>

          {apiError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {apiError}
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-gray-200 pt-5">
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create Quiz'}
            </button>
            <Link
              to="/dashboard"
              className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
