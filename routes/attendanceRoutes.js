const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/attendanceController');

// School Open Days
router.get('/school-open-days', authenticateToken, ctrl.getSchoolOpenDays);
router.post('/school-open-days', authenticateToken, ctrl.upsertSchoolOpenDays);
router.put('/school-open-days', authenticateToken, ctrl.updateSchoolOpenDays);
router.delete('/school-open-days', authenticateToken, ctrl.deleteSchoolOpenDays);

// Student Attendance
router.post('/', authenticateToken, ctrl.upsertAttendance);
router.get('/class/:classId/student-counts', authenticateToken, ctrl.getStudentAttendanceCounts);

module.exports = router;