CREATE TABLE quiz_db_extensions (
  id SERIAL PRIMARY KEY,
  quiz_id INTEGER NOT NULL UNIQUE REFERENCES quizzes(id) ON DELETE CASCADE,
  template_db_name TEXT NOT NULL,
  backup_file_path TEXT NOT NULL,
  original_filename TEXT,
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'restoring', 'ready', 'error')),
  error_message TEXT,
  table_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE submissions
  ADD COLUMN sandbox_db_name TEXT;
