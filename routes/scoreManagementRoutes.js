const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/scoreManagementController');

// Admin Only
router.get('/admin/students/:studentId/all-subject-scores', authenticateToken, ctrl.requireAdmin, ctrl.getStudentAllSubjectScores);

// All routes below require authentication
router.use(authenticateToken);

router.route('/api/students-classes-scores')
    .get(ctrl.getStudentsClassesScores)
    .post(ctrl.createStudentClassesScores);

router.get('/api/students-classes-scores/summary/:classId', ctrl.getClassScoreSummary);

router.route('/api/students-classes-scores/bulk')
    .patch(ctrl.bulkUpdateScores)
    .delete(ctrl.bulkDeleteScores);

router.route('/api/students-classes-scores/:studentId')
    .get(ctrl.getSingleStudentClassesScores);

router.route('/api/students-classes-scores/:assessmentId')
    .put(ctrl.updateStudentClassesScores)
    .delete(ctrl.deleteStudentClassesScores);

module.exports = router;