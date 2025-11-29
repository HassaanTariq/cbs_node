const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/customerController');

router.post('/', ctrl.createCustomer);
router.get('/', ctrl.listCustomers);
router.get('/:id', ctrl.getCustomer);
router.get('/:id/accounts', ctrl.getCustomerAccounts);

module.exports = router;