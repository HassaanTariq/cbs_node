/*
Quick Customers test: basic CRUD sanity against Customer and Account tables.
Usage: node test_customers.js
*/

const pool = require('./server/db');

async function listCustomers(limit = 5) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT customerid, fullname, email FROM Customer ORDER BY customerid LIMIT ' + Number(limit));
    console.log('Customers sample:', rows);
    return rows;
  } finally {
    conn.release();
  }
}

async function listAccounts(limit = 5) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT accountno, customerid, balance FROM Account ORDER BY accountno LIMIT ' + Number(limit));
    console.log('Accounts sample:', rows);
    return rows;
  } finally {
    conn.release();
  }
}

async function verifyConstraints() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(`
      SELECT a.accountno, a.customerid
      FROM Account a
      LEFT JOIN Customer c ON c.customerid = a.customerid
      WHERE c.customerid IS NULL
      LIMIT 1
    `);
    if (rows.length) {
      console.error('Orphaned account found (violates FK):', rows[0]);
    } else {
      console.log('Account -> Customer FK looks valid.');
    }
  } finally {
    conn.release();
  }
}

async function run() {
  try {
    console.log('--- Running Customers quick tests ---');
    await listCustomers();
    await listAccounts();
    await verifyConstraints();
    console.log('--- Tests finished ---');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

run();
