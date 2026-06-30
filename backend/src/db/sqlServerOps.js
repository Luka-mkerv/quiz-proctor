const { getMssqlPool } = require("./mssqlPool");

const DATA_DIR = "/var/opt/mssql/data";

function esc(str) {
  return str.replace(/'/g, "''");
}

// Restore backupPath as a new SQL Server database named dbName.
// Uses RESTORE FILELISTONLY first to discover logical file names dynamically,
// so this works with any .bak regardless of what logical names the backup was created with.
async function restoreDatabase(backupPath, dbName) {
  const pool = await getMssqlPool();

  const fileList = await pool
    .request()
    .query(`RESTORE FILELISTONLY FROM DISK = N'${esc(backupPath)}'`);

  const files = fileList.recordset;
  const dataFiles = files.filter((f) => f.Type === "D");
  const logFiles = files.filter((f) => f.Type === "L");

  const moveClauses = [
    ...dataFiles.map((f, i) => {
      const suffix = i === 0 ? ".mdf" : `_${i}.ndf`;
      return `MOVE N'${esc(f.LogicalName)}' TO N'${DATA_DIR}/${dbName}${suffix}'`;
    }),
    ...logFiles.map((f, i) => {
      const suffix = i === 0 ? "_log.ldf" : `_log_${i}.ldf`;
      return `MOVE N'${esc(f.LogicalName)}' TO N'${DATA_DIR}/${dbName}${suffix}'`;
    }),
  ];

  await pool.request().query(`
    RESTORE DATABASE [${dbName}]
    FROM DISK = N'${esc(backupPath)}'
    WITH ${moveClauses.join(",\n         ")},
         REPLACE
  `);
}

async function dropDatabase(dbName) {
  const pool = await getMssqlPool();
  await pool.request().query(`DROP DATABASE IF EXISTS [${dbName}]`);
}

async function getTableCount(dbName) {
  const pool = await getMssqlPool();
  const result = await pool.request().query(`
    SELECT COUNT(*) AS cnt
    FROM [${dbName}].INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
  `);
  return result.recordset[0].cnt;
}

module.exports = { restoreDatabase, dropDatabase, getTableCount };
