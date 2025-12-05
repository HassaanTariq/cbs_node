const express = require('express');
const router = express.Router();
const reportsCtrl = require('../controllers/reportsController');

// Audit log (latest first)
router.get('/audit-log', reportsCtrl.getAuditLog);

// Summary statistics
router.get('/summary', reportsCtrl.getSummary);

module.exports = router;
