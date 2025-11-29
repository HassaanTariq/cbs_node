const pool = require('../db');

// Get customer dashboard data
exports.getCustomerDashboard = async (req, res) => {
    const customerId = req.customer.customerid;
    
    try {
        // Get customer basic info
        const [customerInfo] = await pool.execute(
            'SELECT customerid, fullname, email, phone, cnic, address, created_at FROM Customer WHERE customerid = ?',
            [customerId]
        );
        
        // Get accounts summary
        const [accounts] = await pool.execute(`
            SELECT a.accountno, a.type, a.balance, a.status, a.opened_at,
                   b.branchname, b.city,
                   (SELECT COUNT(*) FROM TransactionLog t WHERE t.accountno = a.accountno) as transaction_count
            FROM Account a 
            JOIN Branch b ON a.branchid = b.branchid 
            WHERE a.customerid = ? AND a.status = 'active'
            ORDER BY a.opened_at DESC
        `, [customerId]);
        
        // Get recent transactions - REMOVED t.remark
        const [recentTransactions] = await pool.execute(`
            SELECT t.transactionid, t.accountno, t.type, t.amount, t.reference_account,
                   t.created_at,
                   ref_a.accountno as reference_account_no,
                   ref_c.fullname as reference_customer_name,
                   CASE 
                       WHEN t.type = 'deposit' THEN 'Credit'
                       WHEN t.type = 'withdrawal' THEN 'Debit' 
                       WHEN t.type = 'transfer' AND t.reference_account IS NOT NULL THEN 'Transfer Out'
                       WHEN t.type = 'transfer' AND t.accountno IN (SELECT accountno FROM Account WHERE customerid = ?) THEN 'Transfer In'
                       ELSE t.type
                   END as transaction_category
            FROM TransactionLog t
            LEFT JOIN Account ref_a ON t.reference_account = ref_a.accountno
            LEFT JOIN Customer ref_c ON ref_a.customerid = ref_c.customerid
            WHERE t.accountno IN (SELECT accountno FROM Account WHERE customerid = ?)
               OR t.reference_account IN (SELECT accountno FROM Account WHERE customerid = ?)
            ORDER BY t.created_at DESC
            LIMIT 10
        `, [customerId, customerId, customerId]);
        
        // Calculate totals
        const totalBalance = accounts.reduce((sum, acc) => sum + parseFloat(acc.balance), 0);
        const totalAccounts = accounts.length;
        
        res.json({
            success: true,
            customer: customerInfo[0],
            dashboard: {
                totalBalance,
                totalAccounts,
                recentTransactions: recentTransactions.length
            },
            accounts,
            recentTransactions
        });
        
    } catch (err) {
        console.error('Customer dashboard error:', err);
        res.status(500).json({ error: err.message });
    }
};

// Get customer account details
exports.getCustomerAccount = async (req, res) => {
    const customerId = req.customer.customerid;
    const accountNo = req.params.accountNo;
    
    try {
        // Verify the account belongs to the customer
        const [accounts] = await pool.execute(`
            SELECT a.*, b.branchname, b.city 
            FROM Account a 
            JOIN Branch b ON a.branchid = b.branchid 
            WHERE a.accountno = ? AND a.customerid = ?
        `, [accountNo, customerId]);
        
        if (accounts.length === 0) {
            return res.status(404).json({ error: 'Account not found or access denied' });
        }
        
        const account = accounts[0];
        
        // Get account transactions - REMOVED t.remark from SELECT
        const [transactions] = await pool.execute(`
            SELECT t.*,
                   CASE 
                       WHEN t.type = 'deposit' THEN 'Credit'
                       WHEN t.type = 'withdrawal' THEN 'Debit'
                       WHEN t.type = 'transfer' AND t.accountno = ? THEN 'Transfer Out'
                       WHEN t.type = 'transfer' AND t.reference_account = ? THEN 'Transfer In'
                       ELSE t.type
                   END as direction,
                   CASE 
                       WHEN t.type = 'deposit' THEN 'text-success'
                       WHEN t.type = 'withdrawal' THEN 'text-danger'
                       WHEN t.type = 'transfer' AND t.accountno = ? THEN 'text-warning'
                       WHEN t.type = 'transfer' AND t.reference_account = ? THEN 'text-info'
                       ELSE ''
                   END as amount_class
            FROM TransactionLog t
            WHERE t.accountno = ? OR t.reference_account = ?
            ORDER BY t.created_at DESC
            LIMIT 50
        `, [accountNo, accountNo, accountNo, accountNo, accountNo, accountNo]);
        
        // Calculate account statistics
        const totalDeposits = transactions
            .filter(t => (t.type === 'deposit') || (t.type === 'transfer' && t.reference_account == accountNo))
            .reduce((sum, t) => sum + parseFloat(t.amount), 0);
            
        const totalWithdrawals = transactions
            .filter(t => (t.type === 'withdrawal') || (t.type === 'transfer' && t.accountno == accountNo))
            .reduce((sum, t) => sum + parseFloat(t.amount), 0);
        
        res.json({
            success: true,
            account,
            transactions,
            statistics: {
                totalDeposits,
                totalWithdrawals,
                transactionCount: transactions.length
            }
        });
        
    } catch (err) {
        console.error('Customer account error:', err);
        res.status(500).json({ error: err.message });
    }
};

// Customer transfer allowing cross-customer destination
exports.customerTransfer = async (req, res) => {
    const customerId = req.customer.customerid;
    const { fromAccount, toAccount, amount, remark } = req.body;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Verify source account belongs to the authenticated customer and is active
        const [sourceRows] = await conn.execute(
            'SELECT accountno, balance, status FROM Account WHERE accountno = ? AND customerid = ? FOR UPDATE',
            [fromAccount, customerId]
        );

        if (sourceRows.length === 0) {
            throw new Error('Source account not found or access denied');
        }

        const source = sourceRows[0];
        if (source.status !== 'active') {
            throw new Error('Source account is not active');
        }

        // Verify destination account exists and is active (can belong to any customer)
        const [destRows] = await conn.execute(
            'SELECT accountno, status FROM Account WHERE accountno = ? FOR UPDATE',
            [toAccount]
        );

        if (destRows.length === 0) {
            throw new Error('Destination account not found');
        }

        const dest = destRows[0];
        if (dest.status !== 'active') {
            throw new Error('Destination account is not active');
        }

        // Amount validations
        if (parseFloat(amount) <= 0) {
            throw new Error('Transfer amount must be positive');
        }
        if (parseFloat(source.balance) < parseFloat(amount)) {
            throw new Error('Insufficient funds in source account');
        }

        // Perform transfer
        await conn.execute(
            'UPDATE Account SET balance = balance - ? WHERE accountno = ?',
            [amount, fromAccount]
        );

        await conn.execute(
            'UPDATE Account SET balance = balance + ? WHERE accountno = ?',
            [amount, toAccount]
        );

        // Record transactions (both sides for transfer)
        await conn.execute(
            `INSERT INTO TransactionLog (accountno, type, amount, reference_account, performed_by) 
             VALUES (?, 'transfer', ?, ?, ?)`,
            [fromAccount, amount, toAccount, 1]
        );

        await conn.execute(
            `INSERT INTO TransactionLog (accountno, type, amount, reference_account, performed_by) 
             VALUES (?, 'transfer', ?, ?, ?)`,
            [toAccount, amount, fromAccount, 1]
        );

        // Audit log
        await conn.execute(
            `INSERT INTO AuditLog (userid, action, description) 
             VALUES (?, 'CUSTOMER_TRANSFER', ?)`,
            [1, `Customer ${customerId} transferred ${amount} from account ${fromAccount} to ${toAccount}`]
        );

        await conn.commit();

        res.json({
            success: true,
            message: 'Transfer completed successfully',
            transfer: {
                fromAccount,
                toAccount,
                amount,
                remark
            }
        });

    } catch (err) {
        await conn.rollback();
        console.error('Customer transfer error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
};

// Customer transaction history with filters
exports.getTransactionHistory = async (req, res) => {
    const customerId = req.customer.customerid;
    const { accountNo, type, startDate, endDate, page = 1, limit = 20 } = req.query;
    
    console.log('📊 Transaction history request:', { customerId, accountNo, type, startDate, endDate, page, limit });
    
    try {
        // First, get all account numbers for this customer
        const [customerAccounts] = await pool.execute(
            'SELECT accountno FROM Account WHERE customerid = ?',
            [customerId]
        );
        const accountNumbers = customerAccounts.map(acc => acc.accountno);
        
        if (accountNumbers.length === 0) {
            return res.json({
                success: true,
                transactions: [],
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: 0,
                    totalTransactions: 0,
                    hasNext: false,
                    hasPrev: false
                }
            });
        }
        
        // Build placeholders for IN clause
        const accountPlaceholders = accountNumbers.map(() => '?').join(',');
        
         let query = `
            SELECT t.transactionid, t.accountno, t.type, t.amount, t.reference_account,
                   t.created_at,
                   ref_a.accountno as reference_account_no,
                   ref_c.fullname as reference_customer_name
            FROM TransactionLog t
            LEFT JOIN Account ref_a ON t.reference_account = ref_a.accountno
            LEFT JOIN Customer ref_c ON ref_a.customerid = ref_c.customerid
            WHERE (t.accountno IN (${accountPlaceholders})
                   OR t.reference_account IN (${accountPlaceholders}))
        `;
        
        // Parameters: account numbers for WHERE (2x)
        const params = [...accountNumbers, ...accountNumbers];
        
        if (accountNo) {
            query += ' AND (t.accountno = ? OR t.reference_account = ?)';
            // Ensure numeric when possible
            const accFilter = isNaN(Number(accountNo)) ? accountNo : Number(accountNo);
            params.push(accFilter, accFilter);
        }
        
        if (type) {
            query += ' AND t.type = ?';
            params.push(type);
        }
        
        if (startDate) {
            query += ' AND DATE(t.created_at) >= ?';
            params.push(startDate);
        }
        
        if (endDate) {
            query += ' AND DATE(t.created_at) <= ?';
            params.push(endDate);
        }
        
        // Inline LIMIT/OFFSET to avoid MySQL placeholder issues
        const pageNum = Number(page) || 1;
        const limitNum = Number(limit) || 20;
        const offsetNum = (pageNum - 1) * limitNum;
        query += ` ORDER BY t.created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`;
        
        const [transactions] = await pool.execute(query, params);
        console.log(`✅ Found ${transactions.length} transactions for customer ${customerId}`);
        
        // Calculate transaction_category after fetching (to avoid CASE with IN clause issues)
        const transactionsWithCategory = transactions.map(t => {
            let transaction_category;
            if (t.type === 'deposit') {
                transaction_category = 'Credit';
            } else if (t.type === 'withdrawal') {
                transaction_category = 'Debit';
            } else if (t.type === 'transfer') {
                // Check if this account belongs to the customer (transfer out)
                if (accountNumbers.includes(t.accountno)) {
                    transaction_category = 'Transfer Out';
                } else if (accountNumbers.includes(t.reference_account)) {
                    transaction_category = 'Transfer In';
                } else {
                    transaction_category = t.type;
                }
            } else {
                transaction_category = t.type;
            }
            return {
                ...t,
                transaction_category
            };
        });
        
        // Get total count for pagination
        let countQuery = `
            SELECT COUNT(*) as total
            FROM TransactionLog t
            WHERE (t.accountno IN (${accountPlaceholders})
                   OR t.reference_account IN (${accountPlaceholders}))
        `;
        
        // Parameters: account numbers for WHERE (2x)
        const countParams = [...accountNumbers, ...accountNumbers];
        
        if (accountNo) {
            countQuery += ' AND (t.accountno = ? OR t.reference_account = ?)';
            const accFilter = isNaN(Number(accountNo)) ? accountNo : Number(accountNo);
            countParams.push(accFilter, accFilter);
        }
        
        if (type) {
            countQuery += ' AND t.type = ?';
            countParams.push(type);
        }
        
        if (startDate) {
            countQuery += ' AND DATE(t.created_at) >= ?';
            countParams.push(startDate);
        }
        
        if (endDate) {
            countQuery += ' AND DATE(t.created_at) <= ?';
            countParams.push(endDate);
        }
        
        const [countResult] = await pool.execute(countQuery, countParams);
        const totalTransactions = countResult[0].total;
        const totalPages = Math.ceil(totalTransactions / limitNum);
        
        res.json({
            success: true,
            transactions: transactionsWithCategory,
            pagination: {
                currentPage: pageNum,
                totalPages,
                totalTransactions,
                hasNext: pageNum < totalPages,
                hasPrev: pageNum > 1
            }
        });
        
    } catch (err) {
        console.error('Transaction history error:', err);
        res.status(500).json({ 
            success: false,
            error: err.message 
        });
    }
};

// Customer profile update
exports.updateCustomerProfile = async (req, res) => {
    const customerId = req.customer.customerid;
    const { phone, address } = req.body;
    
    try {
        await pool.execute(
            'UPDATE Customer SET phone = ?, address = ? WHERE customerid = ?',
            [phone, address, customerId]
        );
        
        // Audit log
        await pool.execute(
            `INSERT INTO AuditLog (userid, action, description) 
             VALUES (?, 'CUSTOMER_PROFILE_UPDATE', ?)`,
            [1, `Customer ${customerId} updated their profile information`]
        );
        
        res.json({
            success: true,
            message: 'Profile updated successfully'
        });
        
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).json({ error: err.message });
    }
};

// Customer statement generation
exports.generateStatement = async (req, res) => {
    const customerId = req.customer.customerid;
    const { accountNo, startDate, endDate } = req.query;
    
    try {
        // Verify account belongs to customer
        if (accountNo) {
            const [accounts] = await pool.execute(
                'SELECT accountno FROM Account WHERE accountno = ? AND customerid = ?',
                [accountNo, customerId]
            );
            
            if (accounts.length === 0) {
                return res.status(404).json({ error: 'Account not found or access denied' });
            }
        }
        
        let query = `
            SELECT t.transactionid, t.accountno, t.type, t.amount, t.reference_account,
                   t.created_at,
                   a.type as account_type,
                   ref_a.accountno as reference_account_no,
                   CASE 
                       WHEN t.type = 'deposit' THEN 'CR'
                       WHEN t.type = 'withdrawal' THEN 'DR'
                       WHEN t.type = 'transfer' AND t.accountno IN (SELECT accountno FROM Account WHERE customerid = ?) THEN 'DR'
                       WHEN t.type = 'transfer' AND t.reference_account IN (SELECT accountno FROM Account WHERE customerid = ?) THEN 'CR'
                   END as dr_cr,
                   CASE 
                       WHEN t.type = 'deposit' THEN t.amount
                       WHEN t.type = 'transfer' AND t.reference_account IN (SELECT accountno FROM Account WHERE customerid = ?) THEN t.amount
                       ELSE 0
                   END as credit,
                   CASE 
                       WHEN t.type = 'withdrawal' THEN t.amount
                       WHEN t.type = 'transfer' AND t.accountno IN (SELECT accountno FROM Account WHERE customerid = ?) THEN t.amount
                       ELSE 0
                   END as debit
            FROM TransactionLog t
            JOIN Account a ON t.accountno = a.accountno
            LEFT JOIN Account ref_a ON t.reference_account = ref_a.accountno
            WHERE (t.accountno IN (SELECT accountno FROM Account WHERE customerid = ?)
                   OR t.reference_account IN (SELECT accountno FROM Account WHERE customerid = ?))
        `;
        
        const params = [customerId, customerId, customerId, customerId, customerId, customerId];
        
        if (accountNo) {
            query += ' AND (t.accountno = ? OR t.reference_account = ?)';
            params.push(accountNo, accountNo);
        }
        
        if (startDate) {
            query += ' AND DATE(t.created_at) >= ?';
            params.push(startDate);
        }
        
        if (endDate) {
            query += ' AND DATE(t.created_at) <= ?';
            params.push(endDate);
        }
        
        query += ' ORDER BY t.created_at DESC';
        
        const [transactions] = await pool.execute(query, params);
        
        // Calculate running balance
        let runningBalance = 0;
        const statement = transactions.map(transaction => {
            if (transaction.dr_cr === 'CR') {
                runningBalance += parseFloat(transaction.amount);
            } else {
                runningBalance -= parseFloat(transaction.amount);
            }
            
            return {
                ...transaction,
                runningBalance: runningBalance.toFixed(2)
            };
        }).reverse(); // Reverse to show oldest first
        
        res.json({
            success: true,
            statement: {
                customerId,
                accountNo: accountNo || 'All Accounts',
                period: {
                    startDate: startDate || 'Beginning',
                    endDate: endDate || 'Current'
                },
                generatedAt: new Date().toISOString(),
                transactions: statement
            }
        });
        
    } catch (err) {
        console.error('Statement generation error:', err);
        res.status(500).json({ error: err.message });
    }
};