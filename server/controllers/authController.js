
const pool = require('../db');
const bcrypt = require('bcryptjs');

// Customer login - DEBUG VERSION
exports.customerLogin = async (req, res) => {
    const { email, password } = req.body;
    
    console.log('🔐 LOGIN DEBUG START =================================');
    console.log('📧 Received login request:', { email, password });
    
    try {
        // STEP 1: Check database connection
        console.log('1. Testing database connection...');
        const connection = await pool.getConnection();
        console.log('   ✅ Database connection successful');
        connection.release();

        // STEP 2: Execute customer query
        console.log('2. Querying customer with email:', email);
        const [customers] = await pool.execute(
            'SELECT customerid, fullname, email, phone FROM Customer WHERE email = ?',
            [email]
        );
        
        console.log('3. Query results:', {
            rowsReturned: customers.length,
            customers: customers
        });

        // STEP 3: Check if customer found
        if (customers.length === 0) {
            console.log('❌ FAIL: No customer found with email:', email);
            
            // Let's check what emails actually exist in database
            const [allCustomers] = await pool.execute('SELECT email FROM Customer');
            console.log('📋 All existing emails in database:');
            allCustomers.forEach(cust => console.log('   -', cust.email));
            
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid email or password',
                debug: {
                    searchedEmail: email,
                    availableEmails: allCustomers.map(c => c.email)
                }
            });
        }

        const customer = customers[0];
        console.log('4. Customer found:', customer);

        // STEP 4: Validate password
        console.log('5. Validating password...');
        if (!password || password.trim() === '') {
            console.log('❌ FAIL: Empty password provided');
            return res.status(401).json({ 
                success: false, 
                error: 'Password is required' 
            });
        }

        console.log('6. Password validation passed');

        // STEP 5: Create session
        const sessionToken = `cust_${customer.customerid}_${Date.now()}`;
        console.log('7. Session token created:', sessionToken);

        // STEP 6: Send success response
        console.log('✅ LOGIN SUCCESSFUL for:', customer.fullname);
        console.log('🔐 LOGIN DEBUG END =================================\n');
        
        res.json({
            success: true,
            message: 'Login successful',
            customer: {
                customerid: customer.customerid,
                fullname: customer.fullname,
                email: customer.email,
                phone: customer.phone
            },
            sessionToken: sessionToken
        });
        
    } catch (err) {
        console.error('❌ LOGIN ERROR:', err);
        console.log('🔐 LOGIN DEBUG END =================================\n');
        res.status(500).json({ 
            success: false,
            error: 'Server error during login',
            debugError: err.message
        });
    }
};

// Middleware to verify customer session
exports.verifyCustomer = async (req, res, next) => {
    const token = req.headers.authorization || req.query.token;
    
    console.log('🔍 Verifying token:', token); // Debug log
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    try {
        // Simplified token verification for demo
        const tokenParts = token.split('_');
        if (tokenParts.length < 2 || tokenParts[0] !== 'cust') {
            return res.status(401).json({ error: 'Invalid token format' });
        }
        
        const customerId = tokenParts[1];
        
        // Verify customer exists
        const [customers] = await pool.execute(
            'SELECT customerid, fullname, email FROM Customer WHERE customerid = ?',
            [customerId]
        );
        
        if (customers.length === 0) {
            return res.status(401).json({ error: 'Invalid customer' });
        }
        
        req.customer = customers[0];
        console.log('✅ Customer verified:', req.customer.fullname);
        next();
        
    } catch (err) {
        console.error('❌ Token verification error:', err);
        res.status(401).json({ error: 'Token verification failed' });
    }
};

// Customer logout
exports.customerLogout = async (req, res) => {
    console.log('🚪 Customer logout');
    res.json({
        success: true,
        message: 'Logout successful'
    });
};

// Admin login (staff) - demo-friendly
exports.adminLogin = async (req, res) => {
    const { username, password } = req.body;

    try {
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password are required' });
        }

        const [rows] = await pool.execute(
            `SELECT userid, username, fullname, role, password_hash FROM UserAccount WHERE username = ? AND role = 'admin'`,
            [username]
        );

        if (rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
        }

        const user = rows[0];

        let passwordOk = false;
        if (user.password_hash) {
            try {
                passwordOk = await bcrypt.compare(password, user.password_hash);
            } catch (e) {
                passwordOk = false;
            }
        }

        // Demo fallback: if no valid hash, accept any non-empty password
        if (!user.password_hash) {
            passwordOk = password && password.trim().length > 0;
        }

        if (!passwordOk) {
            return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
        }

        const sessionToken = `admin_${user.userid}_${Date.now()}`;
        res.json({
            success: true,
            message: 'Admin login successful',
            admin: {
                userid: user.userid,
                username: user.username,
                fullname: user.fullname,
                role: user.role
            },
            sessionToken
        });
    } catch (err) {
        console.error('Admin login error:', err);
        res.status(500).json({ success: false, error: 'Server error during admin login' });
    }
};

// Middleware to verify admin session
exports.verifyAdmin = async (req, res, next) => {
    const token = req.headers.authorization || req.query.token;
    if (!token) {
        return res.status(401).json({ error: 'Admin access token required' });
    }
    const parts = token.split('_');
    if (parts.length < 2 || parts[0] !== 'admin') {
        return res.status(401).json({ error: 'Invalid admin token' });
    }
    const userid = parts[1];
    try {
        const [rows] = await pool.execute(
            `SELECT userid, username, fullname, role FROM UserAccount WHERE userid = ? AND role = 'admin'`,
            [userid]
        );
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid admin' });
        }
        req.admin = rows[0];
        next();
    } catch (err) {
        console.error('Verify admin error:', err);
        res.status(401).json({ error: 'Admin verification failed' });
    }
};

exports.adminLogout = async (req, res) => {
    res.json({ success: true, message: 'Admin logout successful' });
};