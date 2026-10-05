const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/broadsheetController');

// Class Teacher Routes
router.get('/class-teacher/broadsheet', authenticateToken, ctrl.getClassTeacherClasses);
router.get('/class-teacher/broadsheet/:classId', authenticateToken, ctrl.getClassTeacherBroadsheet);

// Teacher Route (Assigned Subjects)
router.get('/teacher/broadsheet/:classId', authenticateToken, ctrl.getTeacherBroadsheet);

// Admin Broadsheet Routes
router.get('/admin/broadsheet/classes', authenticateToken, ctrl.getAdminBroadsheetClasses);
router.get('/admin/broadsheet/:classId', authenticateToken, ctrl.getAdminBroadsheet);
router.get('/admin/broadsheet/global-stats', authenticateToken, ctrl.getGlobalBroadsheetStats);

module.exports = router;