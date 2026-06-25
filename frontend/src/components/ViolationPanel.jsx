export const VIOLATION_LABELS = {
  tab_switch:         'Tab switch',
  window_blur:        'Window blur',
  fullscreen_exit:    'Exited fullscreen',
  fullscreen_reenter: 'Returned to fullscreen',
  devtools_attempt:   'DevTools attempt',
};

export const VIOLATION_PILL_STYLES = {
  fullscreen_reenter: 'bg-blue-50 text-blue-700 border-blue-200',
};
export const DEFAULT_PILL_STYLE = 'bg-red-50 text-red-700 border-red-200';

export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// violations entries may come from two sources:
//   - socket (monitor): { type, occurredAt }   — camelCase
//   - results API:      { type, occurred_at }   — snake_case
// Both are handled below.
export function ViolationPanel({ title, statusNode, violations, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/30" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-96 flex-col border-l border-gray-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-gray-900">{title}</p>
            {statusNode && <div className="mt-2">{statusNode}</div>}
          </div>
          <button
            onClick={onClose}
            className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Violation history */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {violations.length === 0 ? (
            <div className="mt-12 flex flex-col items-center text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-green-200 bg-green-50">
                <svg className="h-5 w-5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900">No violations</p>
              <p className="mt-0.5 text-xs text-gray-500">Clean record</p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
                Violations · {violations.length}
              </p>
              <div className="space-y-1.5">
                {violations.slice().reverse().map((v, i) => (
                  <div key={i} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-gray-50">
                    <span className="w-20 shrink-0 tabular-nums text-gray-400">
                      {fmtTime(v.occurred_at ?? v.occurredAt)}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-medium ${
                        VIOLATION_PILL_STYLES[v.type] ?? DEFAULT_PILL_STYLE
                      }`}
                    >
                      {VIOLATION_LABELS[v.type] ?? v.type}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
