import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../lib/api.js';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

const STATUS_BADGE = {
  locked: 'border-gray-300 bg-gray-100 text-gray-700',
  open:   'border-green-300 bg-green-50 text-green-700',
  closed: 'border-gray-300 bg-gray-100 text-gray-600',
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
    <div className="flex min-h-screen flex-col bg-gray-50">

      {/* Breadcrumb / page header bar */}
      <header className="border-b border-gray-200 bg-white px-6 py-3">
        <span className="text-sm font-medium text-gray-900">Quizzes</span>
      </header>

      <div className="flex-1">
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">

          {/* Title + primary action */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Quizzes</h1>
              <p className="mt-1 text-sm text-gray-500">Manage your proctored examinations</p>
            </div>
            <Button asChild className="shrink-0 bg-indigo-600 hover:bg-indigo-700">
              <Link to="/dashboard/quizzes/new">
                <Plus className="h-4 w-4 mr-1.5" />
                Create quiz
              </Link>
            </Button>
          </div>

          {/* Loading */}
          {loading && <p className="text-sm text-gray-500">Loading…</p>}

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Empty state */}
          {!loading && !error && quizzes.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-white">
                  <svg className="h-7 w-7 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-900">No quizzes yet</p>
                <p className="mt-1 text-sm text-gray-500">Create your first quiz to get started</p>
                <Button asChild className="mt-4 bg-indigo-600 hover:bg-indigo-700">
                  <Link to="/dashboard/quizzes/new">
                    <Plus className="h-4 w-4 mr-1.5" />
                    Create quiz
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Quizzes table */}
          {!loading && !error && quizzes.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">
                      Title
                    </TableHead>
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">
                      Status
                    </TableHead>
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">
                      Questions
                    </TableHead>
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">
                      Duration
                    </TableHead>
                    <TableHead className="h-10 text-xs font-medium uppercase tracking-wide text-gray-500">
                      Created
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quizzes.map((quiz) => (
                    <TableRow key={quiz.id}>
                      <TableCell className="font-medium">
                        <Link
                          to={`/dashboard/quizzes/${quiz.id}`}
                          className="text-gray-900 transition-colors hover:text-indigo-600"
                        >
                          {quiz.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'capitalize',
                            STATUS_BADGE[quiz.status] ?? 'border-gray-200 bg-gray-100 text-gray-600',
                          )}
                        >
                          {quiz.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {quiz.questions?.length ?? 0}
                      </TableCell>
                      <TableCell className="text-gray-600">
                        {formatDuration(quiz.duration_seconds)}
                      </TableCell>
                      <TableCell className="text-xs text-gray-400">
                        {formatDate(quiz.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
