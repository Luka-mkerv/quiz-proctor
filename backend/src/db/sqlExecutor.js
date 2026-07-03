const { getMssqlPool, sql } = require("./mssqlPool");

const QUERY_TIMEOUT_MS = 10000;
const ROW_CAP = 200;

function splitBatches(rawSql) {
  return rawSql
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

function classifyResult(result) {
  const recordset = result.recordset;
  if (recordset && recordset.length > 0) {
    const columns = Object.keys(recordset.columns || {});
    const columnNames = columns.length > 0 ? columns : Object.keys(recordset[0]);
    const totalRowCount = recordset.length;
    const rows = recordset.slice(0, ROW_CAP).map((row) => columnNames.map((c) => row[c]));
    return {
      type: "select",
      message: null,
      columns: columnNames,
      rows,
      totalRowCount,
    };
  }

  const rowsAffected = Array.isArray(result.rowsAffected)
    ? result.rowsAffected.reduce((a, b) => a + b, 0)
    : 0;

  if (rowsAffected > 0) {
    return {
      type: "dml",
      message: `${rowsAffected} row(s) affected`,
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

function formatSqlError(err) {
  const msgNumber = err.number != null ? `Msg ${err.number}, ` : "";
  const lineInfo = err.lineNumber != null ? `Line ${err.lineNumber}: ` : "";
  return `${msgNumber}${lineInfo}${err.message}`;
}

async function executeSql(sandboxDbName, rawSql) {
  const batches = splitBatches(rawSql);
  const results = [];

  const pool = await getMssqlPool();

  for (let i = 0; i < batches.length; i++) {
    const batchSql = batches[i];
    const start = Date.now();

    // Each batch gets its own Transaction so USE and the batch SQL are sent
    // as two separate wire batches on the SAME pinned connection. Sending
    // them concatenated in one query() call (the previous approach) put USE
    // ahead of the batch's own DDL statement, which SQL Server rejects for
    // CREATE VIEW/TRIGGER/FUNCTION/PROCEDURE ("must be the first statement
    // in a query batch"). pool.request() can't guarantee the same
    // connection across two separate query() calls, hence the Transaction.
    const transaction = new sql.Transaction(pool);
    let timedOut = false;
    let timer;
    let request;

    try {
      await transaction.begin();
      await new sql.Request(transaction).query(`USE [${sandboxDbName}]`);

      request = new sql.Request(transaction);
      timer = setTimeout(() => {
        timedOut = true;
        request.cancel();
      }, QUERY_TIMEOUT_MS);

      const result = await request.query(batchSql);
      clearTimeout(timer);
      await transaction.commit();

      const durationMs = Date.now() - start;
      const classified = classifyResult(result);

      results.push({
        batchIndex: i,
        sql: batchSql,
        ...classified,
        durationMs,
      });
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const isTimeout = timedOut || err.code === "ETIMEOUT";

      try {
        await transaction.rollback();
      } catch (_rollbackErr) {
        // transaction may already be unusable (e.g. connection cancelled on timeout)
      }

      const message = isTimeout
        ? "Query exceeded the 10-second time limit. Simplify your query or add a WHERE clause."
        : formatSqlError(err);

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

  return results;
}

module.exports = { executeSql, splitBatches };
