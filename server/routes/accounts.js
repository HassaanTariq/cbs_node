const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/accountController');

router.post('/open', ctrl.openAccount);
router.get('/', ctrl.listAccounts);
router.get('/:id', ctrl.getAccount);
router.get('/:id/transactions', ctrl.getAccountTransactions);
router.patch('/:id/status', ctrl.updateAccountStatus);

module.exports = router;