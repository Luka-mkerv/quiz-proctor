-- Multiple choice as a third question type alongside open text and SQL.
ALTER TABLE questions
  ADD COLUMN question_type TEXT NOT NULL DEFAULT 'open'
  CHECK (question_type IN ('open', 'multiple_choice', 'sql'));

CREATE TABLE question_options (
  id SERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL
    REFERENCES questions(id) ON DELETE CASCADE,
  option_letter TEXT NOT NULL,
  option_text TEXT NOT NULL,
  option_order INTEGER NOT NULL DEFAULT 0,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (question_id, option_letter)
);

-- Auto-grading result for a student's answer. null: open/sql question or not
-- yet evaluated. true/false: student picked the correct/wrong option.
ALTER TABLE answers
  ADD COLUMN is_correct BOOLEAN;

CREATE INDEX idx_question_options_question_id ON question_options(question_id);
