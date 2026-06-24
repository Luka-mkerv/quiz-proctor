-- enrollment_id is nullable so existing test submissions are not broken.
-- All new submissions created via the student login flow will have it set.
ALTER TABLE submissions
  ADD COLUMN enrollment_id INTEGER
    REFERENCES quiz_enrollments(id) ON DELETE CASCADE;
