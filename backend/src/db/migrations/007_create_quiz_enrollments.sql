CREATE TABLE quiz_enrollments (
  id SERIAL PRIMARY KEY,
  quiz_id INTEGER NOT NULL
    REFERENCES quizzes(id) ON DELETE CASCADE,
  student_email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, student_email)
);
