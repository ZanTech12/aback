const express = require('express');
const router = express.Router();
const { authenticateToken, isTeacherOrAdmin } = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/testController');

// ==================== ADMIN & TEACHER TEST MANAGEMENT ====================
router.post('/', authenticateToken, isTeacherOrAdmin, ctrl.createTest);
router.get('/', authenticateToken, ctrl.getTests);
router.get('/all', authenticateToken, ctrl.getAllTests);
router.get('/teacher/:teacherId', authenticateToken, ctrl.getTestsByTeacher);

// ✅ SECURITY FIX: /:id now guarded — students can no longer fetch tests
// (with correct answers) by guessing URLs. Student test-taking lives at
// /student/tests/:id in studentTestRoutes.js, properly role-guarded there.
router.route('/:id')
    .get(authenticateToken, isTeacherOrAdmin, ctrl.getTestById)
    .put(authenticateToken, isTeacherOrAdmin, ctrl.updateTest)
    .delete(authenticateToken, isTeacherOrAdmin, ctrl.deleteTest);

router.post('/:testId/publish-results', authenticateToken, isTeacherOrAdmin, ctrl.publishResults);
router.post('/:testId/unpublish-results', authenticateToken, isTeacherOrAdmin, ctrl.unpublishResults);

// ✅ Removed dead duplicate student routes — live versions are in
// routes/studentTestRoutes.js (mounted at /student, matching api.js).

module.exports = router;