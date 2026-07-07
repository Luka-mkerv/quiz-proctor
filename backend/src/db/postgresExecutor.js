const { Pool } = require("pg");

const QUERY_TIMEOUT_MS = 10000;
const ROW_CAP = 200;

// Simplified split on semicolons. KNOWN LIMITATION: this does not understand
// string literals or dollar-quoted bodies ($$ ... $$), so a semicolon inside
// a string constant or a PL/pgSQL function/procedure body will be treated as
// a batch boundary and break the statement in two. Fine for the basic
// SELECT/INSERT/UPDATE/DDL statements expected in an intro SQL course; not
// safe for multi-statement functions, triggers, or procedures that rely on
// internal semicolons. A real fix needs a proper SQL tokenizer that tracks
// quote/dollar-quote state.
function splitBatches(rawSql) {
  return rawSql
    .split(";")
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

function classifyResult(result) {
  if (result.rows && result.rows.length > 0) {
    const columns = result.fields.map((f) => f.name);
    const totalRowCount = result.rows.length;
    const rows = result.rows.slice(0, ROW_CAP).map((row) => columns.map((c) => row[c]));
    return {
      type: "select",
      message: null,
      columns,
      rows,
      totalRowCount,
    };
  }

  if (result.rowCount > 0) {
    return {
      type: "dml",
      message: `${result.rowCount} row(s) affected`,
      columns: null,
      rows: null,
      totalRowCount: null,
    };
  }

  return {
    type: "ddl",
    message: "Command completed successfully",
    columns: null,
    rows: null,
    totalRowCount: null,
  };
}

function poolForDatabase(dbName) {
  return new Pool({
    connectionString: process.env.DATABASE_URL.replace(/\/[^/]+$/, `/${dbName}`),
  });
}

async function executeSql(sandboxDbName, rawSql) {
  const batches = splitBatches(rawSql);
  const results = [];

  const dbPool = poolForDatabase(sandboxDbName);
  const client = await dbPool.connect();

  try {
    await client.query(`SET statement_timeout = '${QUERY_TIMEOUT_MS}ms'`);

    for (let i = 0; i < batches.length; i++) {
      const batchSql = batches[i];
      const start = Date.now();

      try {
        const result = await client.query(batchSql);
        const durationMs = Date.now() - start;
        const classified = classifyResult(result);

        results.push({
          batchIndex: i,
          sql: batchSql,
          ...classified,
          durationMs,
        });
      } catch (err) {
        const durationMs = Date.now() - start;
        const isTimeout = err.code === "57014"; // query_canceled (statement_timeout)

        const message = isTimeout
          ? "Query exceeded the 10-second time limit. Simplify your query or add a WHERE clause."
          : err.message;

        results.push({
          batchIndex: i,
          sql: batchSql,
          type: "error",
          message,
          columns: null,
          rows: null,
          totalRowCount: null,
          durationMs,
        });
      }
    }
  } finally {
    client.release();
    await dbPool.end();
  }

  return results;
}

module.exports = { executeSql, splitBatches };
