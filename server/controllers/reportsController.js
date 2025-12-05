const pool = require('../db');

exports.getAuditLog = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
  const search = (req.query.search || '').toString().trim();

  try {
    const params = [];
    let sql = `
      SELECT a.logid, a.userid, a.action, a.description, a.created_at,
             u.username, u.fullname
      FROM AuditLog a
      LEFT JOIN UserAccount u ON a.userid = u.userid
    `;
    if (search) {
      sql += `WHERE a.action LIKE ? OR a.description LIKE ? OR u.username LIKE ? OR u.fullname LIKE ? `;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    // Interpolate numeric LIMIT to avoid prepared LIMIT binding issues
    sql += `ORDER BY a.created_at DESC, a.logid DESC LIMIT ${limit}`;

    const [rows] = params.length > 0 ? await pool.execute(sql, params) : await pool.query(sql);
    res.json({ success: true, logs: rows });
  } catch (err) {
    console.error('getAuditLog error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getSummary = async (_req, res) => {
  try {
    const [[{ count: customers }]] = await pool.execute('SELECT COUNT(*) AS count FROM Customer');
    const [[{ count: accounts }]] = await pool.execute('SELECT COUNT(*) AS count FROM Account WHERE status = "active"');
    const [[{ count: transactions }]] = await pool.execute('SELECT COUNT(*) AS count FROM TransactionLog');
    const [[{ total_balance }]] = await pool.execute('SELECT COALESCE(SUM(balance),0) AS total_balance FROM Account WHERE status = "active"');

    res.json({
      success: true,
      summary: {
        customers,
        accounts,
        transactions,
        totalBalance: parseFloat(total_balance || 0)
      }
    });
  } catch (err) {
    console.error('getSummary error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
