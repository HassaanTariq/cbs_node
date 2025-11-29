const pool = require('../db');

exports.openAccount = async (req, res) => {
  const { customerid, branchid, type = 'saving', balance = 0.00, userid = 1 } = req.body;
  
  if (!customerid || !branchid) {
    return res.status(400).json({ error: 'Customer ID and Branch ID are required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Verify customer exists
    const [customers] = await conn.execute('SELECT fullname FROM Customer WHERE customerid = ?', [customerid]);
    if (customers.length === 0) {
      throw new Error('Customer not found');
    }

    // Verify branch exists
    const [branches] = await conn.execute('SELECT branchname FROM Branch WHERE branchid = ?', [branchid]);
    if (branches.length === 0) {
      throw new Error('Branch not found');
    }

    // Create account
    const [result] = await conn.execute(
      `INSERT INTO Account (customerid, branchid, type, balance, opened_at) VALUES (?, ?, ?, ?, NOW())`,
      [customerid, branchid, type, parseFloat(balance)]
    );
    
    const accountNo = result.insertId;

    // Record initial deposit if any
    if (parseFloat(balance) > 0) {
      await conn.execute(
        `INSERT INTO TransactionLog (accountno, type, amount, performed_by) VALUES (?, ?, ?, ?)`,
        [accountNo, 'deposit', balance, userid]
      );
    }

    // Audit log
    await conn.execute(
      `INSERT INTO AuditLog (userid, action, description) VALUES (?, ?, ?)`,
      [userid, 'OPEN_ACCOUNT', `Opened ${type} account ${accountNo} for customer ${customerid} with initial balance ${balance}`]
    );

    await conn.commit();
    
    res.json({ 
      success: true, 
      accountno: accountNo,
      message: `Account opened successfully. Account Number: ${accountNo}`
    });
    
  } catch (err) {
    await conn.rollback();
    console.error('Open account error:', err);
    
    if (err.message.includes('foreign key constraint')) {
      res.status(400).json({ error: 'Invalid customer or branch ID' });
    } else {
      res.status(500).json({ error: err.message });
    }
  } finally {
    conn.release();
  }
};

exports.listAccounts = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, 
        c.fullname AS customer_name, 
        c.email AS customer_email,
        b.branchname, 
        b.city
      FROM Account a
      JOIN Customer c ON a.customerid = c.customerid
      JOIN Branch b ON a.branchid = b.branchid
      ORDER BY a.accountno DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('List accounts error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getAccount = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, 
        c.fullname AS customer_name, 
        c.phone AS customer_phone,
        c.email AS customer_email,
        b.branchname, 
        b.city
      FROM Account a
      JOIN Customer c ON a.customerid = c.customerid
      JOIN Branch b ON a.branchid = b.branchid
      WHERE a.accountno = ?
    `, [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Get account error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getAccountTransactions = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*, u.fullname as performed_by_name
      FROM TransactionLog t
      LEFT JOIN UserAccount u ON t.performed_by = u.userid
      WHERE t.accountno = ? OR t.reference_account = ?
      ORDER BY t.created_at DESC
      LIMIT 50
    `, [req.params.id, req.params.id]);
    
    res.json(rows);
  } catch (err) {
    console.error('Get account transactions error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.updateAccountStatus = async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  const userid = req.body.userid || 1;

  if (!['active', 'closed', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.execute(
      'UPDATE Account SET status = ? WHERE accountno = ?',
      [status, id]
    );

    if (result.affectedRows === 0) {
      throw new Error('Account not found');
    }

    await conn.execute(
      'INSERT INTO AuditLog (userid, action, description) VALUES (?, ?, ?)',
      [userid, 'UPDATE_ACCOUNT_STATUS', `Changed account ${id} status to ${status}`]
    );

    await conn.commit();
    
    res.json({ 
      success: true, 
      message: `Account status updated to ${status}`
    });
    
  } catch (err) {
    await conn.rollback();
    console.error('Update account status error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};