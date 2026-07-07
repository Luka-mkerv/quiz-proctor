const fs = require("fs/promises");
const { Pool } = require("pg");
const { pool } = require("./pool");

// CREATE DATABASE / DROP DATABASE cannot run inside a transaction and aren't
// scoped to any particular database, so they go through the existing
// quiz_proctor pool directly (same connection the rest of the app uses).
// Anything that needs to run statements *inside* a specific database (loading
// a dump, counting tables) needs its own connection pointed at that database
// — the shared `pool` is pinned to quiz_proctor and can't be redirected
// per-query.
function poolForDatabase(dbName) {
  return new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\/[^/]+$/, `/${dbName}`),
  });
}

function esc(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// Creates quiz_{quizId}_pg_template and populates it from the uploaded dump.
// Returns { tableCount } for the extension row.
async function createPostgresTemplate(quizId, sqlDumpPath) {
  const templateDbName = `quiz_${quizId}_pg_template`;

  await pool.query(`CREATE DATABASE ${esc(templateDbName)}`);

  const rawDumpSql = await fs.readFile(sqlDumpPath, "utf8");
  // pg_dump emits psql-only meta-commands (\restrict / \unrestrict, added as
  // a dump-integrity guard in newer pg_dump versions) that aren't valid SQL
  // and aren't understood by the wire protocol the `pg` driver speaks —
  // sending them through templatePool.query() would error immediately.
  // psql itself interprets these; strip any backslash-command line before
  // executing the dump directly.
  const dumpSql = rawDumpSql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n");

  const templatePool = poolForDatabase(templateDbName);
  try {
    await templatePool.query(dumpSql);
  } finally {
    await templatePool.end();
  }

  const tableCount = await getPostgresTableCount(templateDbName);
  return { tableCount };
}

async function dropPostgresTemplate(quizId) {
  const templateDbName = `quiz_${quizId}_pg_template`;
  await pool.query(`DROP DATABASE IF EXISTS ${esc(templateDbName)} WITH (FORCE)`);
}

// TEMPLATE-based CREATE DATABASE is a Postgres filesystem-level copy —
// effectively instant regardless of database size, unlike SQL Server's
// BACKUP/RESTORE cycle.
async function createPostgresSandbox(submissionId, quizId) {
  const templateDbName = `quiz_${quizId}_pg_template`;
  const sandboxDbName = `sandbox_${submissionId}_pg`;

  await pool.query(
    `CREATE DATABASE ${esc(sandboxDbName)} TEMPLATE ${esc(templateDbName)}`
  );

  return sandboxDbName;
}

async function dropPostgresSandbox(sandboxDbName) {
  await pool.query(`DROP DATABASE IF EXISTS ${esc(sandboxDbName)} WITH (FORCE)`);
}

async function getPostgresTableCount(dbName) {
  const dbPool = poolForDatabase(dbName);
  try {
    const result = await dbPool.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    return Number(result.rows[0].cnt);
  } finally {
    await dbPool.end();
  }
}

module.exports = {
  createPostgresTemplate,
  dropPostgresTemplate,
  createPostgresSandbox,
  dropPostgresSandbox,
  getPostgresTableCount,
};
