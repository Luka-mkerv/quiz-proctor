const sql = require("mssql");

let pool = null;

async function getMssqlPool() {
  if (pool) return pool;

  pool = await new sql.ConnectionPool({
    server: process.env.MSSQL_HOST || "sqlserver",
    port: parseInt(process.env.MSSQL_PORT || "1433", 10),
    user: "sa",
    password: process.env.MSSQL_SA_PASSWORD,
    database: "master",
    options: {
      trustServerCertificate: true,
    },
    connectionTimeout: 30000,
    requestTimeout: 600000, // 10 min — large .bak restores can be slow
  }).connect();

  pool.on("error", (err) => {
    console.error("SQL Server pool error:", err);
    pool = null; // allow reconnect on next call
  });

  return pool;
}

module.exports = { getMssqlPool, sql };
