// routes/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const isTeacherOrAdmin = require('../middlewares/authMiddleware').isTeacherOrAdmin;
const ctrl = require('../controllers/analyticsController');

router.get('/classes/results', authenticateToken, isTeacherOrAdmin, ctrl.getClassesResults);
router.get('/students/:studentId/performance', authenticateToken, ctrl.getStudentPerformance);

module.exports = router;
