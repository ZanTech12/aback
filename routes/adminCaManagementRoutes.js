const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/adminCaManagementController');

router.get('/filter-options', authenticateToken, ctrl.getFilterOptions);
router.get('/assessments', authenticateToken, ctrl.getAssessments);
router.get('/classes-with-approved', authenticateToken, ctrl.getClassesWithApproved);
router.get('/classes/:classId/subjects-with-approved', authenticateToken, ctrl.getSubjectsInClassWithApproved);
router.get('/clear-approval-status/preview', authenticateToken, ctrl.previewClearApprovalStatus);

router.patch('/clear-approval-status', authenticateToken, ctrl.clearApprovalStatus);
router.patch('/clear-approval-status/by-ids', authenticateToken, ctrl.clearApprovalStatusByIds);

module.exports = router;