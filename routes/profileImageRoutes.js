// routes/profileImageRoutes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/profileImageController');
// const upload = require('../middlewares/multerSetup'); // You need to set up multer

// router.post('/student/profile-image', authenticateToken, upload.single('profileImage'), ctrl.uploadStudentProfileImage);
// router.post('/admin/students/:studentId/profile-image', authenticateToken, upload.single('profileImage'), ctrl.uploadAdminStudentProfileImage);
// router.delete('/admin/students/:studentId/profile-image', authenticateToken, ctrl.removeAdminStudentProfileImage);

module.exports = router;