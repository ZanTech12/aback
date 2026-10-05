const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const checkPublicResultAccess = require('../middlewares/resultMiddleware').checkPublicResultAccess;
const ctrl = require('../controllers/studentResultController');

router.get('/student/:studentId', authenticateToken, ctrl.getStudentReportCard);
router.get('/result-access-status', authenticateToken, ctrl.getStudentResultAccessStatus);
router.post('/check-results', checkPublicResultAccess, ctrl.checkResultsPublic);
router.get('/class/:classId', authenticateToken, ctrl.getClassReportCards);

module.exports = router;