-- Tracks the outcome of a student's last SQL execution against their sandbox,
-- so the grading view can show what actually ran (not just the saved SQL text).
ALTER TABLE answers
  ADD COLUMN last_execution_success BOOLEAN,
  ADD COLUMN last_execution_result JSONB;
