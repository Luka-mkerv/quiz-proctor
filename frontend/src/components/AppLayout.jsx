import { useNavigate, Outlet, Link, useLocation } from 'react-router-dom';

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const lecturer = JSON.parse(localStorage.getItem('lecturer') || '{}');

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('lecturer');
    navigate('/login');
  }

  const isActive = (path) => location.pathname === path;

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Left sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 w-56 border-r border-gray-200 bg-white">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 px-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-xs font-bold text-white">
              QP
            </div>
            <span className="text-sm font-semibold text-gray-900">Quiz Proctor</span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 p-3">
            <Link
              to="/dashboard"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive('/dashboard')
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
              </svg>
              Quizzes
            </Link>
          </nav>

          {/* User section */}
          <div className="shrink-0 border-t border-gray-200 p-3">
            <div className="mb-2 rounded-md bg-gray-50 px-3 py-2">
              <p className="truncate text-xs font-medium text-gray-900">{lecturer.name || 'Lecturer'}</p>
              <p className="truncate text-xs text-gray-500">{lecturer.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            >
              Log out
            </button>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 pl-56">
        <Outlet />
      </div>
    </div>
  );
}
