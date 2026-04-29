const mysql = require('mysql2/promise');

const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || '3306',
    database: process.env.DB_NAME || 'chessusnode',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true,
    dateStrings: true
});

// Slow-query logger — logs any query that takes longer than SLOW_QUERY_MS ms.
// Set SLOW_QUERY_MS=0 in .env to disable.
const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS ?? '300');
if (SLOW_QUERY_MS > 0) {
  const _origQuery = db.query.bind(db);
  db.query = function slowQueryWrapper(sql, params) {
    const start = Date.now();
    const promise = _origQuery(sql, params);
    promise.then(() => {
      const ms = Date.now() - start;
      if (ms >= SLOW_QUERY_MS) {
        const preview = (typeof sql === 'string' ? sql : sql.sql || '').replace(/\s+/g, ' ').slice(0, 150);
        console.warn(`[slow-query ${ms}ms] ${preview}`);
      }
    }).catch(() => {/* error already surfaced by caller */});
    return promise;
  };
}

module.exports = db;