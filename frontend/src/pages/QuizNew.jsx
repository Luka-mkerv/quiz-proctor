import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ChevronRight, Plus, X } from 'lucide-react';
import api from '../lib/api.js';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

// ─── Constants ────────────────────────────────────────────────────────────────

const QUESTION_TYPES = [
  { value: 'open',            label: 'Open Text' },
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'sql',             label: 'SQL Query' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relabelOptions(options) {
  return options.map((o, i) => ({ ...o, letter: String.fromCharCode(65 + i) }));
}

function emptyOptions() {
  return relabelOptions([{ text: '', isCorrect: false }, { text: '', isCorrect: false }]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function QuizNew() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [monitoringMode, setMonitoringMode] = useState('lenient');
  const [questions, setQuestions] = useState([{ prompt: '', maxPoints: 10, questionType: 'open', options: [] }]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Question management ──────────────────────────────────────────────────

  function addQuestion() {
    setQuestions((prev) => [...prev, { prompt: '', maxPoints: 10, questionType: 'open', options: [] }]);
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

  function updateQuestionType(index, questionType) {
    setQuestions((prev) => {
      const next = [...prev];
      const q = next[index];
      next[index] = {
        ...q,
        questionType,
        // Lazily initialize a 2-option skeleton the first time a question
        // switches to multiple choice; switching away keeps the options in
        // local state (just hidden) so flipping back doesn't lose work.
        options: questionType === 'multiple_choice' && q.options.length === 0 ? emptyOptions() : q.options,
      };
      return next;
    });
  }

  function addOption(qIndex) {
    setQuestions((prev) => {
      const next = [...prev];
      next[qIndex] = {
        ...next[qIndex],
        options: relabelOptions([...next[qIndex].options, { text: '', isCorrect: false }]),
      };
      return next;
    });
  }

  function removeOption(qIndex, optIndex) {
    setQuestions((prev) => {
      const next = [...prev];
      const options = next[qIndex].options;
      if (options.length <= 2) return prev;
      // Letters auto-reassign (A, B, C…) after removal so there's never a gap.
      next[qIndex] = { ...next[qIndex], options: relabelOptions(options.filter((_, i) => i !== optIndex)) };
      return next;
    });
  }

  function updateOptionText(qIndex, optIndex, text) {
    setQuestions((prev) => {
      const next = [...prev];
      const options = [...next[qIndex].options];
      options[optIndex] = { ...options[optIndex], text };
      next[qIndex] = { ...next[qIndex], options };
      return next;
    });
  }

  function setCorrectOption(qIndex, optIndex) {
    setQuestions((prev) => {
      const next = [...prev];
      const options = next[qIndex].options.map((o, i) => ({ ...o, isCorrect: i === optIndex }));
      next[qIndex] = { ...next[qIndex], options };
      return next;
    });
  }

  // ── Validation + submit ──────────────────────────────────────────────────

  function validate() {
    const errs = {};
    if (!title.trim()) errs.title = 'Title is required.';
    if (questions.some((q) => !q.prompt.trim())) {
      errs.questions = 'All question prompts must be filled in.';
    }
    for (const q of questions) {
      if (q.questionType !== 'multiple_choice') continue;
      if (q.options.some((o) => !o.text.trim())) {
        errs.questions = 'All multiple choice options must have text.';
      }
      if (!q.options.some((o) => o.isCorrect)) {
        errs.questions = 'Each multiple choice question needs exactly one correct option.';
      }
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
          question_type: q.questionType,
          ...(q.questionType === 'multiple_choice'
            ? {
                options: q.options.map((o) => ({
                  letter: o.letter,
                  text: o.text.trim(),
                  is_correct: o.isCorrect,
                })),
              }
            : {}),
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">

      {/* Breadcrumb */}
      <header className="border-b border-gray-200 bg-white px-6 py-3">
        <nav className="flex items-center gap-1 text-sm">
          <Link to="/dashboard" className="text-gray-500 transition-colors hover:text-gray-900">
            Quizzes
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
          <span className="font-medium text-gray-900">Create Quiz</span>
        </nav>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto">
        <form onSubmit={handleSubmit}>
          <div className="mx-auto max-w-3xl space-y-6 px-6 py-6 pb-24">

            {/* ── Quiz Settings card ──────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Quiz Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">

                {/* Title */}
                <div className="space-y-1.5">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. SQL Fundamentals Exam"
                  />
                  {fieldErrors.title && (
                    <p className="text-xs text-red-600">{fieldErrors.title}</p>
                  )}
                </div>

                {/* Duration */}
                <div className="space-y-1.5">
                  <Label htmlFor="duration">
                    Duration{' '}
                    <span className="font-normal text-gray-400">(optional)</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="duration"
                      type="number"
                      min="1"
                      step="1"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                      placeholder="60"
                      className="w-32"
                    />
                    <span className="text-sm text-gray-500">minutes</span>
                  </div>
                </div>

                <Separator />

                {/* Monitoring mode */}
                <div className="space-y-2">
                  <Label>Proctoring mode</Label>
                  <div className="space-y-2 pt-0.5">
                    {[
                      {
                        value: 'lenient',
                        label: 'Lenient',
                        desc: 'Violations logged; student continues exam',
                      },
                      {
                        value: 'strict',
                        label: 'Strict',
                        desc: 'Violations trigger 6-second countdown; auto-submit if not resolved',
                      },
                    ].map(({ value, label, desc }) => (
                      <label
                        key={value}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
                          monitoringMode === value
                            ? value === 'strict'
                              ? 'border-red-300 bg-red-50'
                              : 'border-indigo-300 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300',
                        )}
                      >
                        <input
                          type="radio"
                          name="monitoringMode"
                          value={value}
                          checked={monitoringMode === value}
                          onChange={() => setMonitoringMode(value)}
                          className={cn(
                            'mt-0.5',
                            value === 'strict' ? 'accent-red-600' : 'accent-indigo-600',
                          )}
                        />
                        <div>
                          <span className="block text-sm font-medium text-gray-900">{label}</span>
                          <span className="mt-0.5 block text-xs text-gray-500">{desc}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

              </CardContent>
            </Card>

            {/* ── Questions card ──────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Questions</CardTitle>
                  <span className="text-sm text-gray-500">
                    {questions.length} question{questions.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">

                {questions.map((q, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-gray-200 bg-white p-4 space-y-3"
                  >
                    {/* Row: number + prompt + points + remove */}
                    <div className="flex items-start gap-3">
                      <span className="mt-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                        {i + 1}
                      </span>
                      <Input
                        type="text"
                        value={q.prompt}
                        onChange={(e) => updateQuestion(i, 'prompt', e.target.value)}
                        placeholder={`Question ${i + 1}`}
                        className="flex-1"
                      />
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Input
                          type="number"
                          value={q.maxPoints}
                          onChange={(e) => updateQuestion(i, 'maxPoints', e.target.value)}
                          min={1}
                          max={100}
                          aria-label={`Points for question ${i + 1}`}
                          className="w-16 text-right"
                        />
                        <span className="text-xs text-gray-400">pts</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeQuestion(i)}
                        disabled={questions.length === 1}
                        aria-label="Remove question"
                        className="mt-0.5 h-8 w-8 shrink-0 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Question type selector */}
                    <div className="ml-8">
                      <div className="inline-flex items-center gap-0.5 rounded-md border border-gray-200 bg-gray-50 p-0.5">
                        {QUESTION_TYPES.map((t) => (
                          <button
                            key={t.value}
                            type="button"
                            onClick={() => updateQuestionType(i, t.value)}
                            className={cn(
                              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                              q.questionType === t.value
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-900',
                            )}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Multiple choice options builder */}
                    {q.questionType === 'multiple_choice' && (
                      <div className="ml-8 space-y-2">
                        {q.options.map((o, optIdx) => (
                          <div key={optIdx} className="flex items-center gap-2">
                            <span className="w-5 shrink-0 text-center text-xs font-semibold text-gray-500">
                              {o.letter}
                            </span>
                            <Input
                              type="text"
                              value={o.text}
                              onChange={(e) => updateOptionText(i, optIdx, e.target.value)}
                              placeholder={`Option ${o.letter}`}
                              className="flex-1 text-sm"
                            />
                            <label className="flex shrink-0 items-center gap-1.5 text-xs text-gray-600">
                              <input
                                type="radio"
                                name={`correct-option-${i}`}
                                checked={o.isCorrect}
                                onChange={() => setCorrectOption(i, optIdx)}
                                className="accent-green-600"
                              />
                              Correct
                            </label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeOption(i, optIdx)}
                              disabled={q.options.length <= 2}
                              aria-label={`Remove option ${o.letter}`}
                              className="h-7 w-7 shrink-0 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => addOption(i)}
                          className="h-7 px-2 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Add option
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                {fieldErrors.questions && (
                  <Alert variant="destructive">
                    <AlertDescription>{fieldErrors.questions}</AlertDescription>
                  </Alert>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addQuestion}
                  className="mt-1 text-sm text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add question
                </Button>

              </CardContent>
            </Card>

            {/* API error */}
            {apiError && (
              <Alert variant="destructive">
                <AlertDescription>{apiError}</AlertDescription>
              </Alert>
            )}

          </div>

          {/* ── Fixed bottom bar ──────────────────────────────────────── */}
          <div className="fixed bottom-0 left-56 right-0 z-10 flex items-center justify-between border-t border-gray-200 bg-white px-6 py-3">
            <span className="text-sm text-gray-500">
              {questions.length} question{questions.length !== 1 ? 's' : ''} configured
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" asChild>
                <Link to="/dashboard">Cancel</Link>
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {loading ? 'Creating…' : 'Create Quiz'}
              </Button>
            </div>
          </div>

        </form>
      </div>
    </div>
  );
}
