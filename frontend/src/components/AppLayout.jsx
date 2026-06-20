import { useNavigate, Outlet, Link } from 'react-router-dom';

export default function AppLayout() {
  const navigate = useNavigate();
  const lecturer = JSON.parse(localStorage.getItem('lecturer') || '{}');

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('lecturer');
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link
            to="/dashboard"
            className="group flex items-center gap-2.5"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white shadow-sm">
              QP
            </span>
            <span className="text-sm font-semibold tracking-tight text-gray-900 transition-colors group-hover:text-indigo-600">
              Quiz Proctor
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-gray-500 sm:inline">{lecturer.email}</span>
            <button
              onClick={handleLogout}
              className="rounded-md px-2.5 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
