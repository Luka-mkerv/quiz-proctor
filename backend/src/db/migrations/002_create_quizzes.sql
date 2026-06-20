CREATE TYPE quiz_status AS ENUM ('locked', 'open', 'closed');

CREATE TABLE quizzes (
  id SERIAL PRIMARY KEY,
  lecturer_id INTEGER NOT NULL REFERENCES lecturers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status quiz_status NOT NULL DEFAULT 'locked',
  duration_seconds INTEGER, -- NULL means no timer / manual close only
  opened_at TIMESTAMPTZ,    -- set when lecturer flips status to 'open'
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
