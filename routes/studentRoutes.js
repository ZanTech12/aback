// routes/studentRoutes.js
console.log('🔥 studentRoutes.js LOADED — students + promotion + recycle-bin registered');

const express = require('express');
const router = express.Router();

// ⚠️ All three must exist in authMiddleware.js exports:
const { authenticateToken, isTeacherOrAdmin, isAdmin } = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/studentController');

// ===================================================================
// *** STATIC ROUTES — registered BEFORE /:id so nothing shadows them ***
// ===================================================================

// GET /students — list all students for this tenant
router.get('/', authenticateToken, isTeacherOrAdmin, ctrl.getStudents);

// POST /students — register a new student (admission number auto-generated,
// or honored as-is when provided by the CSV import)
router.post('/', authenticateToken, isTeacherOrAdmin, ctrl.createStudent);

// ===================================================================
// *** PROMOTION ROUTES (static paths — MUST stay before /:id) ***
// ===================================================================

// POST /students/promotion/preview — dry-run the promotion plan (no changes)
router.post('/promotion/preview', authenticateToken, isAdmin, ctrl.promotionPreview);

// POST /students/promotion/execute — run the promotion (all-or-nothing transaction)
router.post('/promotion/execute', authenticateToken, isAdmin, ctrl.promotionExecute);

// ===================================================================
// *** TEMPORARY: counter reset — hit once to repair a drifted
//     currentStudentCount, then remove this route ***
// ===================================================================
router.post('/reset-counter', authenticateToken, isAdmin, ctrl.resetMyCounter);

// ===================================================================
// *** RECYCLE BIN — both path styles registered for frontend
//     compatibility (your api file may call either form) ***
// ===================================================================

// GET /students/recycle-bin — list soft-deleted students (admin only)
router.get('/recycle-bin', authenticateToken, isAdmin, ctrl.getRecycleBin);

// Restore — PUT /restore/:id OR PATCH /recycle-bin/:id/restore (admin only)
router.put('/restore/:id', authenticateToken, isAdmin, ctrl.restoreStudent);
router.patch('/recycle-bin/:id/restore', authenticateToken, isAdmin, ctrl.restoreStudent);

// Permanent delete — DELETE /permanent/:id OR DELETE /recycle-bin/:id/permanent
router.delete('/permanent/:id', authenticateToken, isAdmin, ctrl.permanentDeleteStudent);
router.delete('/recycle-bin/:id/permanent', authenticateToken, isAdmin, ctrl.permanentDeleteStudent);

// ===================================================================
// *** DYNAMIC ROUTES — registered LAST so /:id doesn't shadow statics ***
// ===================================================================

// GET /students/:id — single student (students may view only their own profile)
router.get('/:id', authenticateToken, ctrl.getStudentById);

// PUT /students/:id — update student
router.put('/:id', authenticateToken, isTeacherOrAdmin, ctrl.updateStudent);

// DELETE /students/:id — soft delete to recycle bin (admin only)
router.delete('/:id', authenticateToken, isAdmin, ctrl.softDeleteStudent);

// ===================================================================
// *** PROFILE IMAGE ROUTES (CLOUDINARY) ***
// ===================================================================

// POST /students/:id/profile-image — upload to Cloudinary
router.post('/:id/profile-image', authenticateToken, isTeacherOrAdmin, ctrl.uploadStudentImage, ctrl.uploadProfileImage);

// DELETE /students/:id/profile-image — remove from Cloudinary
router.delete('/:id/profile-image', authenticateToken, isTeacherOrAdmin, ctrl.removeProfileImage);

module.exports = router;