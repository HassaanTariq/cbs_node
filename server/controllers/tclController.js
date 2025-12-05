const pool = require('../db');

// Extract admin userid from Authorization token if present (non-fatal)
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

// Basic Transaction with TCL
exports.basicTransaction = async (req, res) => {
    const { accountno, amount, type } = req.body;
    const userId = getEffectiveUserId(req);
    
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        
        // Operation
        const operation = type === 'deposit' ? '+' : '-';
        await conn.execute(
            `UPDATE Account SET balance = balance ${operation} ? WHERE accountno = ?`,
            [amount, accountno]
        );
        
        // Verify balance doesn't go negative
        if (type === 'withdrawal') {
            const [account] = await conn.execute(
                'SELECT balance FROM Account WHERE accountno = ?',
                [accountno]
            );
            
            if (parseFloat(account[0].balance) < 0) {
                throw new Error('Insufficient funds - transaction will be rolled back');
            }
        }
        
        // Log transaction
        await conn.execute(
            `INSERT INTO TransactionLog (accountno, type, amount, performed_by) VALUES (?, ?, ?, ?)`,
            [accountno, type, amount, userId]
        );
        
        // Audit
        await conn.execute(
            `INSERT INTO AuditLog (userid, action, description) VALUES (?, ?, ?)`,
            [userId, `${type.toUpperCase()}_TCL`, `${type} of ${amount} to account ${accountno} - COMMITTED`]
        );
        
        await conn.commit();
        
        res.json({
            success: true,
            message: `${type} completed successfully`,
            transaction: 'COMMITTED'
        });
        
    } catch (err) {
        await conn.rollback();
        
        // Log rollback
        await conn.execute(
            `INSERT INTO AuditLog (userid, action, description) VALUES (?, ?, ?)`,
            [userId, `${type.toUpperCase()}_ROLLBACK`, `${type} of ${amount} to account ${accountno} - ROLLED BACK: ${err.message}`]
        );
        
        res.status(500).json({
            success: false,
            error: err.message,
            transaction: 'ROLLED BACK'
        });
    } finally {
        conn.release();
    }
};

// Atomic Transfer with TCL
exports.atomicTransfer = async (req, res) => {
    const { fromAccount, toAccount, amount } = req.body;
    const userId = getEffectiveUserId(req);
    
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        
        console.log('🔁 Starting atomic transfer...');
        
        // Lock both accounts
        const [accounts] = await conn.execute(
            'SELECT accountno, balance, status FROM Account WHERE accountno IN (?, ?) FOR UPDATE',
            [fromAccount, toAccount]
        );
        
        const accountMap = {};
        accounts.forEach(acc => accountMap[acc.accountno] = acc);
        
        // Validations
        if (!accountMap[fromAccount]) throw new Error('Sender account not found');
        if (!accountMap[toAccount]) throw new Error('Receiver account not found');
        if (accountMap[fromAccount].status !== 'active') throw new Error('Sender account inactive');
        if (accountMap[toAccount].status !== 'active') throw new Error('Receiver account inactive');
        if (parseFloat(accountMap[fromAccount].balance) < parseFloat(amount)) {
            throw new Error('Insufficient funds');
        }
        
        console.log('✅ Validations passed, executing transfer...');
        
        // Perform transfer
        await conn.execute(
            'UPDATE Account SET balance = balance - ? WHERE accountno = ?',
            [amount, fromAccount]
        );
        
        await conn.execute(
            'UPDATE Account SET balance = balance + ? WHERE accountno = ?',
            [amount, toAccount]
        );
        
        // Log transactions
        await conn.execute(
            `INSERT INTO TransactionLog (accountno, type, amount, reference_account, performed_by) 
             VALUES (?, 'transfer', ?, ?, ?)`,
            [fromAccount, amount, toAccount, userId]
        );
        
        await conn.execute(
            `INSERT INTO TransactionLog (accountno, type, amount, reference_account, performed_by) 
             VALUES (?, 'transfer', ?, ?, ?)`,
            [toAccount, amount, fromAccount, userId]
        );
        
        // Audit
        await conn.execute(
            `INSERT INTO AuditLog (userid, action, description) 
             VALUES (?, 'ATOMIC_TRANSFER_SUCCESS', ?)`,
            [userId, `Atomic transfer: ${amount} from ${fromAccount} to ${toAccount} - COMMITTED`]
        );
        
        await conn.commit();
        console.log('✅ Atomic transfer COMMITTED');
        
        res.json({
            success: true,
            message: 'Atomic transfer completed successfully',
            details: {
                fromAccount,
                toAccount,
                amount,
                transaction: 'COMMITTED'
            }
        });
        
    } catch (err) {
        await conn.rollback();
        console.log('❌ Atomic transfer ROLLED BACK:', err.message);
        
        // Log the rollback
        await conn.execute(
            `INSERT INTO AuditLog (userid, action, description) 
             VALUES (?, 'ATOMIC_TRANSFER_ROLLBACK', ?)`,
            [userId, `Atomic transfer rolled back: ${err.message}`]
        );
        
        res.status(500).json({
            success: false,
            error: err.message,
            transaction: 'ROLLED BACK'
        });
    } finally {
        conn.release();
    }
};

// SAVEPOINT Demonstration
exports.savepointDemo = async (req, res) => {
    const { accountno, operations } = req.body;
    const userId = getEffectiveUserId(req);
    
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        
        const results = {
            initialBalance: 0,
            operations: [],
            finalBalance: 0,
            savepointsCreated: 0,
            rollbacksPerformed: 0
        };
        
        // Get initial balance
        const [initial] = await conn.execute(
            'SELECT balance FROM Account WHERE accountno = ? FOR UPDATE',
            [accountno]
        );
        results.initialBalance = parseFloat(initial[0].balance);
        
        let currentBalance = results.initialBalance;
        
        console.log('🔁 Starting SAVEPOINT demo...');
        
        // Process each step with SAVEPOINT
        for (let i = 0; i < operations.length; i++) {
            const operation = operations[i];
            const savepointName = `sp_${i}`;
            
            console.log(`📝 Step ${i + 1}: ${operation.type} ${operation.amount}`);
            
            // Create SAVEPOINT BEFORE operation to allow rollback if constraints fail
            // Note: SAVEPOINT must use query() not execute() as it's not supported in prepared statements
            await conn.query(`SAVEPOINT ${savepointName}`);
            results.savepointsCreated++;
            
            // Execute operation
            const operator = operation.type === 'credit' ? '+' : '-';
            await conn.execute(
                `UPDATE Account SET balance = balance ${operator} ? WHERE accountno = ?`,
                [operation.amount, accountno]
            );
            
            // Check current balance
            const [current] = await conn.execute(
                'SELECT balance FROM Account WHERE accountno = ?',
                [accountno]
            );
            currentBalance = parseFloat(current[0].balance);
            
            const stepResult = {
                step: i + 1,
                type: operation.type,
                amount: operation.amount,
                balanceAfter: currentBalance,
                savepoint: savepointName,
                status: 'completed'
            };
            
            // Check if we need to rollback this step
            if (operation.constraint) {
                if (operation.constraint.minBalance !== undefined && currentBalance < operation.constraint.minBalance) {
                    try {
                        // Note: ROLLBACK TO SAVEPOINT must use query() not execute()
                        await conn.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
                        results.rollbacksPerformed++;
                        stepResult.status = 'rolled back';
                        stepResult.reason = `Balance (${currentBalance}) below minimum (${operation.constraint.minBalance})`;
                        
                        // Re-check balance after rollback
                        const [afterRollback] = await conn.execute(
                            'SELECT balance FROM Account WHERE accountno = ?',
                            [accountno]
                        );
                        currentBalance = parseFloat(afterRollback[0].balance);
                        stepResult.balanceAfter = currentBalance;
                        
                        console.log(`↩️ Step ${i + 1} rolled back to SAVEPOINT`);
                    } catch (rollbackError) {
                        // If rollback fails, mark as error
                        stepResult.status = 'error';
                        stepResult.reason = `Rollback failed: ${rollbackError.message}`;
                        console.error(`Failed to rollback step ${i + 1}:`, rollbackError.message);
                    }
                }
            }
            
            results.operations.push(stepResult);
        }
        
        // Get final balance
        results.finalBalance = currentBalance;
        
        // Log successful operations
        const successfulOps = results.operations.filter(op => op.status === 'completed');
        if (successfulOps.length > 0) {
            const netAmount = successfulOps.reduce((sum, op) => {
                return op.type === 'credit' ? sum + parseFloat(op.amount) : sum - parseFloat(op.amount);
            }, 0);
            
            await conn.execute(
                `INSERT INTO TransactionLog (accountno, type, amount, performed_by) 
                 VALUES (?, 'batch', ?, ?)`,
                [accountno, Math.abs(netAmount), userId]
            );
        }
        
        // Audit
        await conn.execute(
            `INSERT INTO AuditLog (userid, action, description) 
             VALUES (?, 'SAVEPOINT_DEMO', ?)`,
            [userId, `SAVEPOINT demo: ${results.savepointsCreated} savepoints, ${results.rollbacksPerformed} rollbacks`]
        );
        
        await conn.commit();
        console.log('✅ SAVEPOINT demo COMMITTED');
        
        res.json({
            success: true,
            results,
            message: `SAVEPOINT demonstration completed with ${results.rollbacksPerformed} rollbacks`
        });
        
    } catch (err) {
        await conn.rollback();
        console.log('❌ SAVEPOINT demo ROLLED BACK:', err.message);
        
        res.status(500).json({
            success: false,
            error: err.message
        });
    } finally {
        conn.release();
    }
};

// Nested Transaction Demo
exports.nestedTransactions = async (req, res) => {
    const { operations } = req.body;
    const userId = getEffectiveUserId(req);
    
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        
        console.log('🔁 Starting main transaction...');
        
        const results = {
            mainTransaction: 'active',
            subTransactions: [],
            finalState: 'committed'
        };
        
        // Main transaction operations
        for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            
            try {
                if (op.requiresSavepoint) {
                    // Note: SAVEPOINT must use query() not execute()
                    await conn.query(`SAVEPOINT nested_${i}`);
                    console.log(`💾 Created SAVEPOINT nested_${i}`);
                }
                
                // Execute operation
                await conn.execute(
                    'UPDATE Account SET balance = balance + ? WHERE accountno = ?',
                    [op.amount, op.accountno]
                );
                
                // Log operation
                await conn.execute(
                    `INSERT INTO TransactionLog (accountno, type, amount, performed_by) 
                     VALUES (?, ?, ?, ?)`,
                    [op.accountno, op.type, Math.abs(op.amount), userId]
                );
                
                results.subTransactions.push({
                    account: op.accountno,
                    operation: op.type,
                    amount: op.amount,
                    status: 'completed',
                    savepoint: op.requiresSavepoint ? `nested_${i}` : null
                });
                
                console.log(`✅ Sub-operation ${i + 1} completed`);
                
            } catch (error) {
                if (op.requiresSavepoint) {
                    try {
                        // Note: ROLLBACK TO SAVEPOINT must use query() not execute()
                        await conn.query(`ROLLBACK TO SAVEPOINT nested_${i}`);
                        console.log(`↩️ Rolled back to SAVEPOINT nested_${i}`);
                        
                        results.subTransactions.push({
                            account: op.accountno,
                            operation: op.type,
                            amount: op.amount,
                            status: 'rolled back',
                            error: error.message,
                            savepoint: `nested_${i}`
                        });
                    } catch (rollbackError) {
                        // If rollback fails, it's a serious error - fail the transaction
                        console.error(`Failed to rollback to savepoint nested_${i}:`, rollbackError.message);
                        throw new Error(`Rollback failed: ${rollbackError.message}`);
                    }
                } else {
                    throw error; // Re-throw if no savepoint
                }
            }
        }
        
        // Final validation
        const [negativeAccounts] = await conn.execute(
            'SELECT COUNT(*) as count FROM Account WHERE balance < 0'
        );
        
        if (negativeAccounts[0].count > 0) {
            throw new Error('Negative balances detected - rolling back entire transaction');
        }
        
        await conn.commit();
        results.finalState = 'committed';
        console.log('✅ All transactions COMMITTED');
        
        res.json({
            success: true,
            results,
            message: 'Nested transactions completed successfully'
        });
        
    } catch (err) {
        await conn.rollback();
        results.finalState = 'rolled back';
        console.log('❌ Main transaction ROLLED BACK:', err.message);
        
        res.status(500).json({
            success: false,
            error: err.message,
            results
        });
    } finally {
        conn.release();
    }
};

// Batch Processing with Individual Rollback
exports.batchProcessing = async (req, res) => {
    const { operations } = req.body;
    const userId = getEffectiveUserId(req);
    
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        
        const results = {
            processed: 0,
            successful: 0,
            failed: 0,
            details: []
        };
        
        console.log(`🔁 Starting batch processing of ${operations.length} operations...`);
        
        for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            const savepointName = `batch_${i}`;
            
            try {
                // Create savepoint BEFORE operation to allow rollback if anything fails
                // Note: SAVEPOINT must use query() not execute() as it's not supported in prepared statements
                await conn.query(`SAVEPOINT ${savepointName}`);
                
                // Lock account
                const [account] = await conn.execute(
                    'SELECT balance, status FROM Account WHERE accountno = ? FOR UPDATE',
                    [op.accountno]
                );
                
                if (account.length === 0) {
                    throw new Error('Account not found');
                }
                
                if (account[0].status !== 'active') {
                    throw new Error('Account not active');
                }
                
                // Execute operation
                await conn.execute(
                    'UPDATE Account SET balance = balance + ? WHERE accountno = ?',
                    [op.amount, op.accountno]
                );
                
                // Verify constraints
                const [current] = await conn.execute(
                    'SELECT balance FROM Account WHERE accountno = ?',
                    [op.accountno]
                );
                
                if (current[0].balance < 0) {
                    throw new Error('Insufficient funds');
                }
                
                // Log transaction
                const transactionType = op.amount >= 0 ? 'deposit' : 'withdrawal';
                await conn.execute(
                    `INSERT INTO TransactionLog (accountno, type, amount, performed_by) 
                     VALUES (?, ?, ?, ?)`,
                    [op.accountno, transactionType, Math.abs(op.amount), userId]
                );
                
                results.processed++;
                results.successful++;
                results.details.push({
                    accountno: op.accountno,
                    operation: transactionType,
                    amount: op.amount,
                    status: 'success',
                    balance: current[0].balance,
                    savepoint: savepointName
                });
                
                console.log(`✅ Batch operation ${i + 1} completed successfully`);
                
            } catch (error) {
                // Rollback to savepoint for this specific operation
                try {
                    // Note: ROLLBACK TO SAVEPOINT must use query() not execute()
                    await conn.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
                } catch (rollbackError) {
                    // If rollback fails, log it but continue
                    console.error(`Failed to rollback to savepoint ${savepointName}:`, rollbackError.message);
                }
                
                results.processed++;
                results.failed++;
                results.details.push({
                    accountno: op.accountno,
                    operation: op.amount >= 0 ? 'deposit' : 'withdrawal',
                    amount: op.amount,
                    status: 'failed',
                    error: error.message,
                    savepoint: savepointName
                });
                
                console.log(`❌ Batch operation ${i + 1} failed:`, error.message);
                // Continue with next operation despite this failure
                continue;
            }
        }
        
        // Final audit
        await conn.execute(
            `INSERT INTO AuditLog (userid, action, description) 
             VALUES (?, 'BATCH_PROCESSING', ?)`,
            [userId, `Batch processing: ${results.successful} successful, ${results.failed} failed out of ${results.processed} total`]
        );
        
        await conn.commit();
        console.log('✅ Batch processing COMMITTED');
        
        res.json({
            success: true,
            batchResults: results,
            message: `Batch processing completed: ${results.successful} successful, ${results.failed} failed`
        });
        
    } catch (err) {
        await conn.rollback();
        console.log('❌ Batch processing ROLLED BACK:', err.message);
        
        res.status(500).json({
            success: false,
            error: err.message
        });
    } finally {
        conn.release();
    }
};

// TCL Test Suite
exports.runTclTestSuite = async (req, res) => {
    const testResults = [];
    
    // Helper function to get a test account
    const getTestAccount = async (conn) => {
        const [accounts] = await conn.execute(
            'SELECT accountno FROM Account WHERE status = "active" LIMIT 1'
        );
        if (accounts.length === 0) {
            throw new Error('No active accounts found for testing');
        }
        return accounts[0].accountno;
    };
    
    // Test 1: Basic COMMIT
    let conn1 = null;
    try {
        conn1 = await pool.getConnection();
        const testAccount = await getTestAccount(conn1);
        
        await conn1.beginTransaction();
        await conn1.execute('UPDATE Account SET balance = balance + 1 WHERE accountno = ?', [testAccount]);
        await conn1.commit();
        
        testResults.push({
            test: 'Basic COMMIT',
            result: 'PASSED',
            description: 'Transaction committed successfully'
        });
    } catch (err) {
        testResults.push({
            test: 'Basic COMMIT',
            result: 'FAILED',
            description: err.message
        });
    } finally {
        if (conn1) conn1.release();
    }
    
    // Test 2: Basic ROLLBACK
    let conn2 = null;
    try {
        conn2 = await pool.getConnection();
        const testAccount = await getTestAccount(conn2);
        
        await conn2.beginTransaction();
        const [initial] = await conn2.execute('SELECT balance FROM Account WHERE accountno = ?', [testAccount]);
        const initialBalance = parseFloat(initial[0].balance);
        
        await conn2.execute('UPDATE Account SET balance = balance + 100 WHERE accountno = ?', [testAccount]);
        await conn2.rollback();
        
        const [afterRollback] = await conn2.execute('SELECT balance FROM Account WHERE accountno = ?', [testAccount]);
        const finalBalance = parseFloat(afterRollback[0].balance);
        
        if (Math.abs(initialBalance - finalBalance) < 0.01) {
            testResults.push({
                test: 'Basic ROLLBACK',
                result: 'PASSED',
                description: 'Transaction rolled back successfully - balance unchanged'
            });
        } else {
            testResults.push({
                test: 'Basic ROLLBACK',
                result: 'FAILED',
                description: `Balance changed after rollback: Initial ${initialBalance}, Final ${finalBalance}`
            });
        }
    } catch (err) {
        testResults.push({
            test: 'Basic ROLLBACK',
            result: 'FAILED',
            description: err.message
        });
    } finally {
        if (conn2) conn2.release();
    }
    
    // Test 3: SAVEPOINT functionality
    let conn3 = null;
    try {
        conn3 = await pool.getConnection();
        const testAccount = await getTestAccount(conn3);
        
        await conn3.beginTransaction();
        const [initial] = await conn3.execute('SELECT balance FROM Account WHERE accountno = ?', [testAccount]);
        const initialBalance = parseFloat(initial[0].balance);
        
        await conn3.execute('UPDATE Account SET balance = balance + 50 WHERE accountno = ?', [testAccount]);
        // Note: SAVEPOINT must use query() not execute() as it's not supported in prepared statements
        await conn3.query('SAVEPOINT test_sp');
        await conn3.execute('UPDATE Account SET balance = balance + 50 WHERE accountno = ?', [testAccount]);
        // Note: ROLLBACK TO SAVEPOINT must use query() not execute()
        await conn3.query('ROLLBACK TO SAVEPOINT test_sp');
        await conn3.commit();
        
        const [final] = await conn3.execute('SELECT balance FROM Account WHERE accountno = ?', [testAccount]);
        const finalBalance = parseFloat(final[0].balance);
        const expected = initialBalance + 50;
        
        if (Math.abs(finalBalance - expected) < 0.01) {
            testResults.push({
                test: 'SAVEPOINT and Partial Rollback',
                result: 'PASSED',
                description: 'Partial rollback worked correctly - only first update committed'
            });
        } else {
            testResults.push({
                test: 'SAVEPOINT and Partial Rollback',
                result: 'FAILED',
                description: `Expected ${expected.toFixed(2)}, got ${finalBalance.toFixed(2)}`
            });
        }
    } catch (err) {
        testResults.push({
            test: 'SAVEPOINT and Partial Rollback',
            result: 'FAILED',
            description: err.message
        });
    } finally {
        if (conn3) conn3.release();
    }
    
    res.json({
        success: true,
        testResults,
        summary: {
            total: testResults.length,
            passed: testResults.filter(t => t.result === 'PASSED').length,
            failed: testResults.filter(t => t.result === 'FAILED').length
        }
    });
};