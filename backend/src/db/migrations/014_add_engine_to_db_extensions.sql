-- quiz_db_extensions previously assumed SQL Server exclusively. Adding
-- PostgreSQL as a second engine option requires knowing which one a given
-- extension row belongs to, so downstream code can branch (restore vs.
-- CREATE DATABASE ... TEMPLATE, sandbox naming, executor choice, etc.).
ALTER TABLE quiz_db_extensions
  ADD COLUMN engine TEXT NOT NULL DEFAULT 'sqlserver'
    CHECK (engine IN ('sqlserver', 'postgres'));
