const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const dashboardController = require('../controllers/dashboardController');

// Count routes
router.get('/teachers/count', authenticateToken, dashboardController.getTeachersCount);
router.get('/students/count', authenticateToken, dashboardController.getStudentsCount);
router.get('/classes/count', authenticateToken, dashboardController.getClassesCount);
router.get('/subjects/count', authenticateToken, dashboardController.getSubjectsCount);
router.get('/questions/count', authenticateToken, dashboardController.getQuestionsCount);
router.get('/tests/count', authenticateToken, dashboardController.getTestsCount);

// Dashboard stats routes
router.get('/stats', authenticateToken, dashboardController.getDashboardStats);
router.get('/teacher-logins', authenticateToken, dashboardController.getTeacherLogins);
router.get('/student/dashboard', authenticateToken, dashboardController.getStudentDashboard);

module.exports = router;