const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/adminScoresController');

// Apply Admin/SuperAdmin middleware to all routes in this file
router.use(authenticateToken, ctrl.requireAdmin);

router.get('/students/search', ctrl.searchStudents);
router.get('/students/:studentId/academic-profile', ctrl.getStudentAcademicProfile);
router.get('/students/:studentId/scores', ctrl.getStudentScores);

router.put('/ca/:assessmentId/edit-scores', ctrl.editScores);
router.post('/ca/upsert', ctrl.upsertCA);
router.post('/ca/bulk-edit-scores', ctrl.bulkEditScores);
router.delete('/ca/:assessmentId/force-delete', ctrl.forceDeleteCA);

module.exports = router;