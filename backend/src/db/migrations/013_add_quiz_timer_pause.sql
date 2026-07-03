-- Tracks lecturer-initiated pauses (Lock mid-exam) so the exam timer, which
-- now runs from a single opened_at rather than per-student login, can freeze
-- and resume correctly instead of penalizing students for paused time.
ALTER TABLE quizzes
  ADD COLUMN paused_at TIMESTAMPTZ,
  ADD COLUMN total_paused_seconds INTEGER NOT NULL DEFAULT 0;
