import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronRight, BarChart2, Activity, Check, X, AlertTriangle, RotateCcw } from 'lucide-react';
import api from '../lib/api.js';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { ViolationPanel } from '../components/ViolationPanel.jsx';
import SqlResultsPanel from '../components/SqlResultsPanel.jsx';

// ─── Badge sub-components ─────────────────────────────────────────────────────

function ExecutionBadge({ lastExecutionSuccess }) {
  if (lastExecutionSuccess === true) {
    return (
      <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs">
        ✅ Ran successfully
      </Badge>
    );
  }
  if (lastExecutionSuccess === false) {
    return (
      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-xs">
        ❌ Had errors
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-gray-200 bg-gray-100 text-gray-500 text-xs">
      Not executed
    </Badge>
  );
}

function QuestionTypeBadge({ questionType }) {
  if (questionType !== 'multiple_choice') return null;
  return (
    <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-700 text-xs">
      Multiple Choice
    </Badge>
  );
}

function AutoGradeBadge({ isCorrect, maxPoints }) {
  if (isCorrect === null || isCorrect === undefined) return null;
  if (isCorrect) {
    return (
      <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs">
        ✓ Auto: {maxPoints}/{maxPoints} pts
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-xs">
      ✗ Auto: 0/{maxPoints} pts
    </Badge>
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
      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 text-xs">
        ⚠️ Bypassed exam interface
      </Badge>
    );
  }
  return <span className="text-gray-400 text-xs">—</span>;
}

function SubmissionStatus({ submitted_at, auto_submitted }) {
  if (!submitted_at) {
    return (
      <Badge variant="outline" className="border-gray-200 bg-gray-100 text-gray-600 text-xs">
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-gray-400 inline-block" />
        In progress
      </Badge>
    );
  }
  if (auto_submitted) {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs">
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
        Auto-submitted
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs">
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
      Submitted
    </Badge>
  );
}

// ─── MultipleChoiceOptions ────────────────────────────────────────────────────

function MultipleChoiceOptions({ options, studentLetter, correctLetter }) {
  return (
    <div className="space-y-1.5">
      {options.map((opt) => {
        const isCorrect = opt.letter === correctLetter;
        const isSelected = opt.letter === studentLetter;
        let icon = '○';
        let cls = 'border-gray-200 text-gray-600';
        if (isCorrect) {
          icon = '✓';
          cls = 'border-green-200 bg-green-50 text-green-800';
        } else if (isSelected) {
          icon = '✗';
          cls = 'border-red-200 bg-red-50 text-red-800';
        }
        return (
          <div
            key={opt.letter}
            className={cn('flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm', cls)}
          >
            <span className="w-4 shrink-0 text-center font-semibold">{icon}</span>
            <span className="w-5 shrink-0 font-semibold">{opt.letter}</span>
            <span className="flex-1">{opt.text}</span>
            {isSelected && <span className="shrink-0 text-xs opacity-75">student&apos;s answer</span>}
          </div>
        );
      })}
    </div>
  );
}

// ─── GradeCard ────────────────────────────────────────────────────────────────

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

  const isMultipleChoice = question.question_type === 'multiple_choice';

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        {/* Question header */}
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-medium text-gray-900">Q{question.question_order + 1}</h3>
          <span className="text-xs text-gray-400">{question.max_points} pts</span>
          <QuestionTypeBadge questionType={question.question_type} />
          {isMultipleChoice
            ? <AutoGradeBadge isCorrect={answer.is_correct} maxPoints={question.max_points} />
            : <ExecutionBadge lastExecutionSuccess={answer.last_execution_success} />
          }
        </div>
        <p className="text-sm text-gray-700">{question.prompt}</p>

        {/* Answer display */}
        {isMultipleChoice ? (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">Options</p>
            <MultipleChoiceOptions
              options={question.options ?? []}
              studentLetter={answer.answer_text || null}
              correctLetter={question.correct_option}
            />
          </div>
        ) : (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">Answer</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-sm text-gray-900">
              {answer.answer_text
                ? answer.answer_text
                : <span className="font-sans italic text-gray-400">No answer</span>
              }
            </pre>
          </div>
        )}

        {/* Last execution result */}
        {answer.last_execution_result && (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">Last execution result</p>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <SqlResultsPanel results={answer.last_execution_result} compact />
            </div>
          </div>
        )}

        <Separator />

        {/* Grading row */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Points</span>
            <Input
              type="number"
              min={0}
              max={maxPts}
              step={0.5}
              value={pts}
              onChange={(e) => { setPts(e.target.value); setStatus(null); }}
              className="w-20 text-right"
            />
            <span className="text-sm text-gray-500">/ {question.max_points}</span>
          </div>
          <Input
            type="text"
            value={notes}
            onChange={(e) => { setNotes(e.target.value); setStatus(null); }}
            placeholder="Notes (optional)"
            className="min-w-40 flex-1"
          />
          <Button
            onClick={handleSave}
            disabled={status === 'saving'}
            className={cn(
              'shrink-0',
              status === 'saved'  ? 'bg-green-600 hover:bg-green-700' :
              status === 'error'  ? 'bg-red-600 hover:bg-red-700' :
              'bg-indigo-600 hover:bg-indigo-700',
            )}
          >
            {saveLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── GradingPanel ─────────────────────────────────────────────────────────────

function GradingPanel({ submission, questions, quizId, onGradeUpdated, onClose, onPrev, onNext, hasPrev, hasNext }) {
  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-indigo-200 bg-indigo-50/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-indigo-200 bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onPrev}
            disabled={!hasPrev}
            className="text-gray-600"
          >
            ← Prev
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900">{submission.student_name}</p>
            <div className="mt-1">
              <SubmissionStatus
                submitted_at={submission.submitted_at}
                auto_submitted={submission.auto_submitted}
              />
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onNext}
            disabled={!hasNext}
            className="text-gray-600"
          >
            Next →
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close"
          className="ml-4 h-7 w-7 shrink-0 text-gray-400 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </Button>
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreLabel(submission) {
  const possible = submission.total_points_possible;
  if (submission.total_points_awarded == null) return `— / ${possible} pts`;
  const awarded = parseFloat(submission.total_points_awarded);
  const rounded = Number.isInteger(awarded) ? awarded : awarded.toFixed(2).replace(/\.?0+$/, '');
  return `${rounded} / ${possible} pts`;
}

// ─── Main component ───────────────────────────────────────────────────────────

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

  // ── Loading / error screens ───────────────────────────────────────────────

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  if (error || !results) {
    return (
      <main className="p-8">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{error || 'Failed to load results'}</AlertDescription>
        </Alert>
        <Link
          to={`/dashboard/quizzes/${id}`}
          className="mt-4 inline-block text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
        >
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
          <Link
            to={`/dashboard/quizzes/${id}`}
            className="text-gray-500 transition-colors hover:text-gray-900"
          >
            Quiz
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
          <span className="font-medium text-gray-900">Results &amp; Grading</span>
        </nav>
      </header>

      {/* Page content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-6 pb-24">

          {/* Page title + grading progress */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Results &amp; Grading</h1>
              <p className="mt-1 text-sm text-gray-500">
                {submissions.length} submission{submissions.length !== 1 ? 's' : ''}
              </p>
            </div>
            {submissions.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm">
                <span className="font-medium text-gray-900">Graded:</span>
                <span className="text-gray-700">{gradedCount} / {submissions.length}</span>
                {gradedCount === submissions.length && submissions.length > 0 && (
                  <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs">
                    ✓ Complete
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Empty state */}
          {submissions.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm text-gray-500">No submissions yet</p>
              </CardContent>
            </Card>
          )}

          {/* Submissions table */}
          {submissions.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">Student</TableHead>
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">Submitted</TableHead>
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">Status</TableHead>
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">Monitor</TableHead>
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">Score</TableHead>
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">Flags</TableHead>
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((s, idx) => (
                    <TableRow
                      key={s.id}
                      className={cn(
                        'transition-colors',
                        gradingIdx === idx ? 'bg-indigo-50 hover:bg-indigo-50' : '',
                      )}
                    >
                      <TableCell className="font-medium text-gray-900">{s.student_name}</TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {s.submitted_at
                          ? new Date(s.submitted_at).toLocaleString()
                          : <span className="text-gray-400">—</span>}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1.5">
                          <SubmissionStatus submitted_at={s.submitted_at} auto_submitted={s.auto_submitted} />
                          {canReopen(s) && (
                            <div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleReopen(s)}
                                disabled={reopeningId === s.id}
                                className="h-6 px-2 text-xs"
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                {reopeningId === s.id ? 'Reopening…' : 'Reopen'}
                              </Button>
                              {reopenError[s.id] && (
                                <p className="mt-1 max-w-[10rem] text-xs text-red-600">{reopenError[s.id]}</p>
                              )}
                            </div>
                          )}
                          {reopenSuccessId === s.id && (
                            <p className="max-w-[10rem] text-xs text-green-600">
                              Reopened — student can now log back in
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <MonitorStatus socket_connected={s.socket_connected} submitted_at={s.submitted_at} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        <span className={s.total_points_awarded == null ? 'text-gray-400' : 'font-medium text-gray-900'}>
                          {scoreLabel(s)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => setViolationId(s.id)}
                          className="group inline-flex cursor-pointer items-center gap-2 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                        >
                          {s.violation_count > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-red-200 bg-red-50 text-red-700 group-hover:bg-red-100 text-xs cursor-pointer"
                            >
                              {s.violation_count}
                            </Badge>
                          ) : (
                            <span className="text-gray-400 text-sm">—</span>
                          )}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant={gradingIdx === idx ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setGradingIdx(gradingIdx === idx ? null : idx)}
                          className={cn(
                            'h-7 px-3 text-xs',
                            gradingIdx === idx
                              ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                              : '',
                          )}
                        >
                          {gradingIdx === idx ? 'Close' : 'Grade'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Grading panel */}
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

        </div>
      </div>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-56 right-0 z-10 flex items-center justify-between border-t border-gray-200 bg-white px-6 py-3">
        <span className="text-sm font-medium text-gray-700">Results &amp; Grading</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/dashboard/quizzes/${id}`}>
              ← Back to quiz
            </Link>
          </Button>
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" asChild>
            <Link to={`/dashboard/quizzes/${id}/monitor`}>
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              Live Monitor
            </Link>
          </Button>
        </div>
      </div>

      {/* Violation side panel */}
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
    </div>
  );
}
