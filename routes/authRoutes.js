const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// ===================================================================
// *** AUTH ROUTES ***
// ===================================================================

// @route   POST /login
// @desc    General Login (handles superadmin, admin, teacher, student based on 'role' in body)
router.post('/', authController.login);

// @route   POST /login/superadmin
// @desc    Dedicated SuperAdmin Login
router.post('/superadmin', authController.loginSuperAdmin);

// @route   POST /login/admin
// @desc    Dedicated Admin Login (Checks expiry & active status)
router.post('/admin', authController.loginAdmin);

// @route   POST /login/teacher
// @desc    Dedicated Teacher Login (Tracks last login IP/Device)
router.post('/teacher', authController.loginTeacher);

// @route   POST /login/student
// @desc    Dedicated Student Login (Checks fees & admission number)
router.post('/student', authController.loginStudent);

module.exports = router;