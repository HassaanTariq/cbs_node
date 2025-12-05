/*
Quick CBS backend test: verifies DB connectivity, table presence, and simple queries.
Usage: node test_cbs.js
*/

const pool = require('./server/db');

async function checkConnection() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT 1 AS ok');
    console.log('DB connectivity:', rows[0].ok === 1 ? 'OK' : 'FAILED');
  } finally {
    conn.release();
  }
}

async function checkTables() {
  const required = ['UserAccount', 'Customer', 'Branch', 'Account', 'TransactionLog', 'AuditLog'];
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()"
    );
    const existing = new Set(rows.map(r => r.TABLE_NAME));
    const missing = required.filter(t => !existing.has(t));
    if (missing.length) {
      console.error('Missing tables:', missing.join(', '));
    } else {
      console.log('All required tables present.');
    }
  } finally {
    conn.release();
  }
}

async function sampleDataChecks() {
  const conn = await pool.getConnection();
  try {
    const [[custCount]] = await conn.query('SELECT COUNT(*) AS cnt FROM Customer');
    const [[acctCount]] = await conn.query('SELECT COUNT(*) AS cnt FROM Account');
    console.log('Customers:', custCount.cnt, 'Accounts:', acctCount.cnt);

    const [accounts] = await conn.query('SELECT accountno, balance FROM Account ORDER BY accountno LIMIT 5');
    console.log('Sample accounts:', accounts);
  } finally {
    conn.release();
  }
}

async function run() {
  try {
    console.log('--- Running CBS quick tests ---');
    await checkConnection();
    await checkTables();
    await sampleDataChecks();
    console.log('--- Tests finished ---');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

run();
