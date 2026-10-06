const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const caController = require('../controllers/continuousAssessmentController');

// ===================================================================
// *** CONTINUOUS ASSESSMENT (CA) ROUTES ***
// ===================================================================

router.get('/', authenticateToken, caController.getCAs);
router.get('/teacher/ca/eligible', authenticateToken, caController.getTeacherCAEligible);
router.get('/teacher/ca/:classId/:subjectId/students', authenticateToken, caController.getTeacherCAStudents);
router.post('/teacher/ca/upload', authenticateToken, caController.uploadCA);
router.post('/teacher/ca/upload/bulk', authenticateToken, caController.bulkUploadCA);

// 👈 ADD THIS NEW ROUTE FOR SUBMITTING
router.put('/teacher/ca/submit/:classId/:subjectId', authenticateToken, caController.submitForApproval);
router.delete('/teacher/ca/:id', authenticateToken, caController.deleteDraftCA);

module.exports = router;