const pool = require('../db');

exports.createCustomer = async (req, res) => {
  const { fullname, email, phone, cnic, address, userid = 1 } = req.body;
  
  if (!fullname || !email) {
    return res.status(400).json({ error: 'Full name and email are required' });
  }

  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      
      const [result] = await conn.execute(
        `INSERT INTO Customer (fullname, email, phone, cnic, address) VALUES (?, ?, ?, ?, ?)`,
        [fullname, email, phone, cnic, address]
      );
      
      const customerId = result.insertId;
      
      await conn.execute(
        `INSERT INTO AuditLog (userid, action, description) VALUES (?, ?, ?)`,
        [userid, 'CREATE_CUSTOMER', `Created customer ${customerId}: ${fullname} (${email})`]
      );
      
      await conn.commit();
      res.json({ 
        success: true, 
        customerId,
        message: `Customer created successfully with ID: ${customerId}`
      });
      
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Customer creation error:', err);
    
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Customer with this email already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
};

exports.listCustomers = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, 
        COUNT(a.accountno) as total_accounts,
        SUM(a.balance) as total_balance
      FROM Customer c
      LEFT JOIN Account a ON c.customerid = a.customerid AND a.status = 'active'
      GROUP BY c.customerid
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('List customers error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getCustomer = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM Customer WHERE customerid = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Get customer error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getCustomerAccounts = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, b.branchname, b.city 
      FROM Account a 
      JOIN Branch b ON a.branchid = b.branchid 
      WHERE a.customerid = ? 
      ORDER BY a.created_at DESC
    `, [req.params.id]);
    
    res.json(rows);
  } catch (err) {
    console.error('Get customer accounts error:', err);
    res.status(500).json({ error: err.message });
  }
};