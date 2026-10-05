const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/adminStudentBlockController');

router.patch('/students/:id/toggle-fees-access', authenticateToken, ctrl.toggleFeesAccess);
router.patch('/students/:id/toggle-owing', authenticateToken, ctrl.toggleOwing);
router.patch('/students/:id/toggle-result-access', authenticateToken, ctrl.toggleStudentResultAccess);
router.patch('/students/:id/block-result-access', authenticateToken, ctrl.setStudentResultBlock);
router.patch('/students/bulk-result-access', authenticateToken, ctrl.bulkResultAccess);

router.patch('/classes/:id/toggle-result-access', authenticateToken, ctrl.toggleClassResultAccess);
router.patch('/classes/:id/block-result-access', authenticateToken, ctrl.setClassResultBlock);

module.exports = router;