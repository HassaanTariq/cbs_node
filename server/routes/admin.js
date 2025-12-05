const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/authController');

router.post('/login', authCtrl.adminLogin);
router.post('/logout', authCtrl.adminLogout);

// Example protected route (future use)
router.get('/me', authCtrl.verifyAdmin, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

module.exports = router;
