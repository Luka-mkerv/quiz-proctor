CREATE TABLE questions (
  id SERIAL PRIMARY KEY,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  question_order INTEGER NOT NULL DEFAULT 0,
  -- Free-text / SQL-answer style for now; can extend with a "type" column later
  -- (multiple_choice, free_text, etc.) without breaking existing data.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_questions_quiz_id ON questions(quiz_id);
