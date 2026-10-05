// routes/studentRoutes.js
console.log('🔥 studentRoutes.js LOADED — GET / registered'); // remove after verifying

const express = require('express');
const router = express.Router();

// ⚠️ All three must exist in authMiddleware.js exports:
const { authenticateToken, isTeacherOrAdmin, isAdmin } = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/studentController');

// ===================================================================
// *** STATIC ROUTES — registered BEFORE /:id ***
// ===================================================================

// ✅ THE MISSING ROUTE — GET /students (list all students for this tenant)
router.get('/', authenticateToken, isTeacherOrAdmin, ctrl.getStudents);

// POST /students — register a new student (admission number auto-generated)
router.post('/', authenticateToken, isTeacherOrAdmin, ctrl.createStudent);

// GET /students/recycle-bin — list soft-deleted students (admin only)
router.get('/recycle-bin', authenticateToken, isAdmin, ctrl.getRecycleBin);

// PUT /students/restore/:id — restore from recycle bin (admin only)
router.put('/restore/:id', authenticateToken, isAdmin, ctrl.restoreStudent);

// DELETE /students/permanent/:id — permanently delete + clean up records (admin only)
router.delete('/permanent/:id', authenticateToken, isAdmin, ctrl.permanentDeleteStudent);

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