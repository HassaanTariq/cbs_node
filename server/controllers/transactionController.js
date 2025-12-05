const pool = require('../db');

// Extract admin userid from Authorization token if present; fallback to body.userid or 1
function getEffectiveUserId(req) {
  try {
    const token = req.headers?.authorization || req.query?.token;
    if (token && typeof token === 'string') {
      const parts = token.split('_');
      if (parts.length >= 2 && parts[0] === 'admin') {
        const id = parseInt(parts[1], 10);
        if (!isNaN(id) && id > 0) return id;
      }
    }
  } catch (_) { /* ignore */ }
  const bodyId = req.body && req.body.userid ? parseInt(req.body.userid, 10) : null;
  return !isNaN(bodyId) && bodyId > 0 ? bodyId : 1;
}

exports.deposit = async (req, res) => {
  const { accountno, amount } = req.body;
  const userid = getEffectiveUserId(req);
  
  if (!accountno || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid account number and positive amount are required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Verify account exists and is active
    const [accounts] = await conn.execute(
      'SELECT accountno, status FROM Account WHERE accountno = ? FOR UPDATE',
      [accountno]
    );
    
    if (accounts.length === 0) {
      throw new Error('Account not found');
    }
    
    if (accounts[0].status !== 'active') {
      throw new Error('Account is not active');
    }

    // Update balance
    const [updateResult] = await conn.execute(
      'UPDATE Account SET balance = balance + ? WHERE accountno = ?',
      [parseFloat(amount), accountno]
    );

    if (updateResult.affectedRows === 0) {
      throw new Error('Failed to update account balance');
    }

    // Record transaction
    await conn.execute(
      `INSERT INTO TransactionLog (accountno, type, amount, performed_by) VALUES (?, ?, ?, ?)`,
      [accountno, 'deposit', amount, userid]
    );

    // Audit log
    await conn.execute(
      `INSERT INTO AuditLog (userid, action, description) VALUES (?, ?, ?)`,
      [userid, 'DEPOSIT', `Deposited ${amount} to account ${accountno}`]
    );

    await conn.commit();
    
    res.json({ 
      success: true, 
      message: `Deposit of ${amount} to account ${accountno} completed successfully`
    });
    
  } catch (err) {
    await conn.rollback();
    console.error('Deposit error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

exports.withdraw = async (req, res) => {
  const { accountno, amount } = req.body;
  const userid = getEffectiveUserId(req);
  
  if (!accountno || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid account number and positive amount are required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock and verify account
    const [accounts] = await conn.execute(
      'SELECT accountno, balance, status FROM Account WHERE accountno = ? FOR UPDATE',
      [accountno]
    );
    
    if (accounts.length === 0) {
      throw new Error('Account not found');
    }
    
    if (accounts[0].status !== 'active') {
      throw new Error('Account is not active');
    }
    
    if (parseFloat(accounts[0].balance) < parseFloat(amount)) {
      throw new Error('Insufficient funds');
    }

    // Update balance
    await conn.execute(
      'UPDATE Account SET balance = balance - ? WHERE accountno = ?',
      [parseFloat(amount), accountno]
    );

    // Record transaction
    await conn.execute(
      `INSERT INTO TransactionLog (accountno, type, amount, performed_by) VALUES (?, ?, ?, ?)`,
      [accountno, 'withdrawal', amount, userid]
    );

    // Audit log
    await conn.execute(
      `INSERT INTO AuditLog (userid, action, description) VALUES (?, ?, ?)`,
      [userid, 'WITHDRAWAL', `Withdrew ${amount} from account ${accountno}`]
    );

    await conn.commit();
    
    res.json({ 
      success: true, 
      message: `Withdrawal of ${amount} from account ${accountno} completed successfully`
    });
    
  } catch (err) {
    await conn.rollback();
    console.error('Withdrawal error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

exports.transfer = async (req, res) => {
  const { fromaccount, toaccount, amount } = req.body;
  const userid = getEffectiveUserId(req);
  
  if (!fromaccount || !toaccount || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid account numbers and positive amount are required' });
  }
  
  if (fromaccount === toaccount) {
    return res.status(400).json({ error: 'Cannot transfer to the same account' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock both accounts in consistent order to prevent deadlocks
    const accountIds = [parseInt(fromaccount), parseInt(toaccount)].sort((a, b) => a - b);
    
    const [accounts] = await conn.execute(
      'SELECT accountno, balance, status FROM Account WHERE accountno IN (?, ?) FOR UPDATE',
      accountIds
    );
    
    const accountMap = {};
    accounts.forEach(acc => accountMap[acc.accountno] = acc);

    // Verify sender account
    if (!accountMap[fromaccount]) {
      throw new Error('Sender account not found');
    }
    if (accountMap[fromaccount].status !== 'active') {
      throw new Error('Sender account is not active');
    }
    if (parseFloat(accountMap[fromaccount].balance) < parseFloat(amount)) {
      throw new Error('Insufficient funds');
    }

    // Verify receiver account
    if (!accountMap[toaccount]) {
      throw new Error('Receiver account not found');
    }
    if (accountMap[toaccount].status !== 'active') {
      throw new Error('Receiver account is not active');
    }

    // Perform transfer - debit sender
    await conn.execute(
      'UPDATE Account SET balance = balance - ? WHERE accountno = ?',
      [parseFloat(amount), fromaccount]
    );
    
    // Credit receiver
    await conn.execute(
      'UPDATE Account SET balance = balance + ? WHERE accountno = ?',
      [parseFloat(amount), toaccount]
    );

    // Record transactions (both sides for transfer)
    await conn.execute(
      `INSERT INTO TransactionLog (accountno, type, amount, reference_account, performed_by) VALUES (?, ?, ?, ?, ?)`,
      [fromaccount, 'transfer', amount, toaccount, userid]
    );
    
    await conn.execute(
      `INSERT INTO TransactionLog (accountno, type, amount, reference_account, performed_by) VALUES (?, ?, ?, ?, ?)`,
      [toaccount, 'transfer', amount, fromaccount, userid]
    );

    // Audit log
    await conn.execute(
      `INSERT INTO AuditLog (userid, action, description) VALUES (?, ?, ?)`,
      [userid, 'TRANSFER', `Transferred ${amount} from account ${fromaccount} to ${toaccount}`]
    );

    await conn.commit();
    
    res.json({ 
      success: true, 
      message: `Transfer of ${amount} from account ${fromaccount} to ${toaccount} completed successfully`
    });
    
  } catch (err) {
    await conn.rollback();
    console.error('Transfer error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

// SAVEPOINT Demo for TCL demonstration
exports.demoSavepoint = async (req, res) => {
  const { accountno, amount1 = 100, amount2 = 200 } = req.body;
  const userid = getEffectiveUserId(req);
  
  if (!accountno) {
    return res.status(400).json({ error: 'Account number is required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const actions = [];
    
    // Get initial balance
    const [initialRows] = await conn.execute('SELECT balance FROM Account WHERE accountno = ? FOR UPDATE', [accountno]);
    if (initialRows.length === 0) {
      throw new Error('Account not found');
    }
    
    const initialBalance = parseFloat(initialRows[0].balance);
    actions.push(`Initial balance: ${initialBalance.toFixed(2)}`);

    // Guard: ensure sufficient funds for first withdrawal
    if (initialBalance < parseFloat(amount1)) {
      actions.push(`Insufficient funds for first withdrawal (${amount1}). Demo aborted.`);
      await conn.rollback();
      return res.status(400).json({ success: false, actions, message: 'Not enough balance for first withdrawal' });
    }

    // First withdrawal
    await conn.execute('UPDATE Account SET balance = balance - ? WHERE accountno = ?', [amount1, accountno]);
    await conn.query('SAVEPOINT after_first_withdrawal'); // SAVEPOINT requires query()

    const [afterFirst] = await conn.execute('SELECT balance FROM Account WHERE accountno = ?', [accountno]);
    const balanceAfterFirst = parseFloat(afterFirst[0].balance);
    actions.push(`After first withdrawal (${amount1}): ${balanceAfterFirst.toFixed(2)}`);

    // Decide whether to attempt second withdrawal
    if (balanceAfterFirst < parseFloat(amount2)) {
      actions.push(`Second withdrawal (${amount2}) skipped due to insufficient funds.`);
      // Record only the first withdrawal
      await conn.execute(
        `INSERT INTO TransactionLog (accountno, type, amount, performed_by) VALUES (?, ?, ?, ?)`,
        [accountno, 'withdrawal', amount1, userid]
      );
    } else {
      // Attempt second withdrawal
      await conn.execute('UPDATE Account SET balance = balance - ? WHERE accountno = ?', [amount2, accountno]);
      const [afterSecond] = await conn.execute('SELECT balance FROM Account WHERE accountno = ?', [accountno]);
      const balanceAfterSecond = parseFloat(afterSecond[0].balance);
      actions.push(`After second withdrawal (${amount2}): ${balanceAfterSecond.toFixed(2)}`);

      if (balanceAfterSecond < 0) {
        // Roll back second if it caused negative balance
        await conn.query('ROLLBACK TO SAVEPOINT after_first_withdrawal');
        actions.push('Second withdrawal caused negative balance - rolled back to SAVEPOINT.');
        // Record only first withdrawal
        await conn.execute(
          `INSERT INTO TransactionLog (accountno, type, amount, performed_by) VALUES (?, ?, ?, ?)`,
          [accountno, 'withdrawal', amount1, userid]
        );
      } else {
        actions.push('Both withdrawals successful - no rollback needed');
        // Record combined withdrawal as a single logical transaction
        await conn.execute(
          `INSERT INTO TransactionLog (accountno, type, amount, performed_by) VALUES (?, ?, ?, ?)`,
          [accountno, 'withdrawal', parseFloat(amount1) + parseFloat(amount2), userid]
        );
      }
    }

    // Get final balance
    const [finalRows] = await conn.execute('SELECT balance FROM Account WHERE accountno = ?', [accountno]);
    const finalBalance = parseFloat(finalRows[0].balance);
    actions.push(`Final balance: ${finalBalance.toFixed(2)}`);

    // Audit log
    await conn.execute(
      `INSERT INTO AuditLog (userid, action, description) VALUES (?, ?, ?)`,
      [userid, 'SAVEPOINT_DEMO', `SAVEPOINT demo on account ${accountno}: ${actions.join('; ')}`]
    );

    await conn.commit();
    
    res.json({ 
      success: true, 
      actions,
      initialBalance,
      finalBalance,
      message: 'SAVEPOINT demo completed successfully'
    });
    
  } catch (err) {
    await conn.rollback();
    console.error('SAVEPOINT demo error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

exports.listTransactions = async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const [rows] = await pool.query(`
      SELECT t.*, 
        a1.customerid as from_customer_id,
        c1.fullname as from_customer_name,
        a2.customerid as to_customer_id, 
        c2.fullname as to_customer_name,
        u.fullname as performed_by_name,
        CASE 
          WHEN t.type = 'deposit' THEN CONCAT('Deposit to ', c1.fullname)
          WHEN t.type = 'withdrawal' THEN CONCAT('Withdrawal from ', c1.fullname) 
          WHEN t.type = 'transfer' AND t.reference_account IS NOT NULL THEN 
            CONCAT('Transfer from ', c1.fullname, ' to ', c2.fullname)
          ELSE t.type
        END as description
      FROM TransactionLog t
      JOIN Account a1 ON t.accountno = a1.accountno
      JOIN Customer c1 ON a1.customerid = c1.customerid
      LEFT JOIN Account a2 ON t.reference_account = a2.accountno
      LEFT JOIN Customer c2 ON a2.customerid = c2.customerid
      LEFT JOIN UserAccount u ON t.performed_by = u.userid
      ORDER BY t.created_at DESC
      LIMIT ?
    `, [parseInt(limit)]);
    
    res.json(rows);
  } catch (err) {
    console.error('List transactions error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getAccountTransactions = async (req, res) => {
  try {
    const { accountNo } = req.params;
    const { limit = 20 } = req.query;
    
    const [rows] = await pool.query(`
      SELECT t.*, u.fullname as performed_by_name,
        CASE 
          WHEN t.type = 'deposit' THEN 'credit'
          WHEN t.type = 'withdrawal' THEN 'debit'
          WHEN t.type = 'transfer' AND t.accountno = ? THEN 'debit'
          WHEN t.type = 'transfer' AND t.reference_account = ? THEN 'credit'
        END as direction
      FROM TransactionLog t
      LEFT JOIN UserAccount u ON t.performed_by = u.userid
      WHERE t.accountno = ? OR t.reference_account = ?
      ORDER BY t.created_at DESC
      LIMIT ?
    `, [accountNo, accountNo, accountNo, accountNo, parseInt(limit)]);
    
    res.json(rows);
  } catch (err) {
    console.error('Get account transactions error:', err);
    res.status(500).json({ error: err.message });
  }
};