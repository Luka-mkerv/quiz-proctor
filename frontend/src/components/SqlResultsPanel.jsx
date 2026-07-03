// Renders the batch-by-batch execution results returned by
// POST /api/public/student/execute (and the same shape saved as
// answers.last_execution_result for the grading view).

function BatchResult({ batch, compact }) {
  const cellPad = compact ? 'px-2 py-1' : 'px-3 py-1.5';

  if (batch.type === 'select') {
    return (
      <div>
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {batch.columns.map((col, i) => (
                  <th key={i} className={`${cellPad} text-left font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap`}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {batch.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((val, ci) => (
                    <td key={ci} className={`${cellPad} whitespace-nowrap text-gray-700`}>
                      {val === null ? <span className="italic text-gray-400">NULL</span> : String(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {batch.totalRowCount > batch.rows.length && (
          <p className="mt-1 text-xs text-gray-500">
            Showing {batch.rows.length} of {batch.totalRowCount.toLocaleString()} rows
          </p>
        )}
      </div>
    );
  }

  if (batch.type === 'error') {
    return (
      <p className="whitespace-pre-wrap break-words rounded-md border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
        ❌ {batch.message}
      </p>
    );
  }

  // ddl | dml
  return (
    <p className="text-xs font-medium text-green-700">
      ✅ {batch.message}
    </p>
  );
}

export default function SqlResultsPanel({ results, compact = false }) {
  if (!results || results.length === 0) return null;

  const totalMs = results.reduce((sum, b) => sum + (b.durationMs || 0), 0);

  return (
    <div className="space-y-3">
      {results.map((batch, i) => (
        <div key={batch.batchIndex ?? i} className={i > 0 ? 'border-t border-gray-200 pt-3' : ''}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">Batch {i + 1}</span>
            <span className="text-xs text-gray-400">{batch.durationMs} ms</span>
          </div>
          <BatchResult batch={batch} compact={compact} />
        </div>
      ))}
      <p className="border-t border-gray-200 pt-2 text-xs text-gray-500">
        Total: {totalMs} ms across {results.length} batch{results.length !== 1 ? 'es' : ''}
      </p>
    </div>
  );
}
