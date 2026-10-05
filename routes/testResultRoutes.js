const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const isTeacherOrAdmin = require('../middlewares/authMiddleware').isTeacherOrAdmin;
const ctrl = require('../controllers/testResultController');

router.post('/', authenticateToken, ctrl.createTestResult);
router.get('/', authenticateToken, isTeacherOrAdmin, ctrl.getTestResults);
router.get('/test/:testId', authenticateToken, isTeacherOrAdmin, ctrl.getTestResultsByTest);
router.get('/class/:classId', authenticateToken, isTeacherOrAdmin, ctrl.getTestResultsByClass);
router.get('/student/:studentId', authenticateToken, ctrl.getTestResultsByStudent);
router.get('/export/:testId', authenticateToken, isTeacherOrAdmin, ctrl.exportTestResults);

router.delete('/:studentId/:testId', authenticateToken, isTeacherOrAdmin, ctrl.deleteTestResult);
router.delete('/student/:studentId/all', authenticateToken, isTeacherOrAdmin, ctrl.deleteAllStudentResults);
router.delete('/delete-all', authenticateToken, isTeacherOrAdmin, ctrl.deleteAllSystemResults);

module.exports = router;