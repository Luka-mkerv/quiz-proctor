ALTER TABLE quizzes ADD COLUMN monitoring_mode TEXT NOT NULL DEFAULT 'lenient' CHECK (monitoring_mode IN ('lenient', 'strict'));
