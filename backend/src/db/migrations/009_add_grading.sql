-- Max points per question, set at creation
ALTER TABLE questions
  ADD COLUMN max_points NUMERIC(5,2) NOT NULL DEFAULT 10;

-- Grades table: one row per question per submission
CREATE TABLE grades (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL
    REFERENCES submissions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL
    REFERENCES questions(id) ON DELETE CASCADE,
  points NUMERIC(5,2),
  notes TEXT,
  graded_by INTEGER NOT NULL
    REFERENCES lecturers(id),
  graded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, question_id)
);

CREATE INDEX idx_grades_submission_id
  ON grades(submission_id);
