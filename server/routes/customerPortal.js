const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/authController');
const portalCtrl = require('../controllers/customerPortalController');

// Public routes
router.post('/login', authCtrl.customerLogin);
router.post('/logout', authCtrl.customerLogout);

// Protected routes (require customer authentication)
router.get('/dashboard', authCtrl.verifyCustomer, portalCtrl.getCustomerDashboard);
router.get('/account/:accountNo', authCtrl.verifyCustomer, portalCtrl.getCustomerAccount);
router.post('/transfer', authCtrl.verifyCustomer, portalCtrl.customerTransfer);
router.get('/transactions', authCtrl.verifyCustomer, portalCtrl.getTransactionHistory);
router.put('/profile', authCtrl.verifyCustomer, portalCtrl.updateCustomerProfile);
router.get('/statement', authCtrl.verifyCustomer, portalCtrl.generateStatement);

module.exports = router;