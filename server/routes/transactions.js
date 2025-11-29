const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/transactionController');

router.post('/deposit', ctrl.deposit);
router.post('/withdraw', ctrl.withdraw);
router.post('/transfer', ctrl.transfer);
router.post('/demo-savepoint', ctrl.demoSavepoint);
router.get('/list', ctrl.listTransactions);
router.get('/account/:accountNo', ctrl.getAccountTransactions);

module.exports = router;