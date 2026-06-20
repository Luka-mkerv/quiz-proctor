import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import QuizNew from './pages/QuizNew.jsx';
import QuizDetail from './pages/QuizDetail.jsx';
import QuizResults from './pages/QuizResults.jsx';
import QuizPage from './pages/QuizPage.jsx';
import QuizMonitor from './pages/QuizMonitor.jsx';
import AppLayout from './components/AppLayout.jsx';

function RequireAuth() {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/quiz/:id" element={<QuizPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/dashboard/quizzes/new" element={<QuizNew />} />
          <Route path="/dashboard/quizzes/:id" element={<QuizDetail />} />
          <Route path="/dashboard/quizzes/:id/results" element={<QuizResults />} />
          <Route path="/dashboard/quizzes/:id/monitor" element={<QuizMonitor />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
