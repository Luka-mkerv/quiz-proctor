-- One row per student attempt of a quiz. No login required, just a name tied
-- to a quiz_id. Unique constraint stops the same name from creating two
-- in-progress submissions for the same quiz.
CREATE TABLE submissions (
  id SERIAL PRIMARY KEY,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  auto_submitted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (quiz_id, student_name)
);

CREATE TABLE answers (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL DEFAULT '',
  UNIQUE (submission_id, question_id)
);

CREATE TYPE violation_type AS ENUM ('tab_switch', 'window_blur', 'fullscreen_exit', 'devtools_attempt');

CREATE TABLE violations (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  event_type violation_type NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_answers_submission_id ON answers(submission_id);
CREATE INDEX idx_violations_submission_id ON violations(submission_id);
