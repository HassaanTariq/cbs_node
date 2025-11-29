const express = require('express');
const router = express.Router();
const tclCtrl = require('../controllers/tclController');

// Basic TCL Operations
router.post('/basic-transaction', tclCtrl.basicTransaction);
router.post('/atomic-transfer', tclCtrl.atomicTransfer);

// Advanced TCL Features
router.post('/savepoint-demo', tclCtrl.savepointDemo);
router.post('/nested-transactions', tclCtrl.nestedTransactions);
router.post('/batch-processing', tclCtrl.batchProcessing);

// Testing
router.get('/test-suite', tclCtrl.runTclTestSuite);

module.exports = router;