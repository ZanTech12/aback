const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const isTeacherOrAdmin = require('../middlewares/authMiddleware').isTeacherOrAdmin;

// Controllers
const sessionCtrl = require('../controllers/sessionController');
const termCtrl = require('../controllers/termController');
const gradingCtrl = require('../controllers/gradingSystemController');
const caCtrl = require('../controllers/continuousAssessmentController');

// Sessions
router.get('/sessions', authenticateToken, sessionCtrl.getSessions);
router.post('/sessions', authenticateToken, sessionCtrl.createSession);
router.put('/sessions/:id', authenticateToken, sessionCtrl.updateSession);
router.delete('/sessions/:id', authenticateToken, sessionCtrl.deleteSession);

// Terms
router.get('/terms', authenticateToken, termCtrl.getTerms);
router.get('/terms/active', authenticateToken, termCtrl.getActiveTerm);
router.post('/terms', authenticateToken, termCtrl.createTerm);
router.put('/terms/:id', authenticateToken, termCtrl.updateTerm);
router.delete('/terms/:id', authenticateToken, termCtrl.deleteTerm);

// Grading Systems
router.get('/grading-systems', authenticateToken, gradingCtrl.getGradingSystems);
router.get('/grading-systems/default', authenticateToken, gradingCtrl.getDefaultGradingSystem);
router.post('/grading-systems', authenticateToken, gradingCtrl.createGradingSystem);
router.put('/grading-systems/:id', authenticateToken, gradingCtrl.updateGradingSystem);
router.delete('/grading-systems/:id', authenticateToken, gradingCtrl.deleteGradingSystem);

// Continuous Assessments
router.get('/continuous-assessments', authenticateToken, caCtrl.getCAs);
router.get('/teacher/ca/eligible', authenticateToken, caCtrl.getTeacherCAEligible);
router.get('/teacher/ca/:classId/:subjectId/students', authenticateToken, caCtrl.getTeacherCAStudents);
router.post('/teacher/ca/upload', authenticateToken, caCtrl.uploadCA);

module.exports = router;