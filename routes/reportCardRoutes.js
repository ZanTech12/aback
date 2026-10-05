const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/reportCardController');

console.log('🧩 reportCardController exports:', Object.keys(ctrl).join(', '));

// Static paths FIRST so /:id patterns never swallow them
router.get('/status',     authenticateToken, ctrl.getStatus);         // → getReportCardStatus
router.get('/print-data', authenticateToken, ctrl.getPrintData);       // grouped batch print

// Param paths
router.get('/class/:classId',           authenticateToken, ctrl.getClassReport);
router.get('/student/:studentId',       authenticateToken, ctrl.getStudentReport);
router.get('/student-print/:studentId', authenticateToken, ctrl.getStudentPrint); // → getStudentPrintData

module.exports = router;