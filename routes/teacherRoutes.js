const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const teacherController = require('../controllers/teacherController');

// @route   GET /teachers
// @desc    Get all teachers
router.get('/', authenticateToken, teacherController.getTeachers);

// @route   POST /teachers
// @desc    Create a new teacher
router.post('/', authenticateToken, teacherController.createTeacher);

// @route   PUT /teachers/:id
// @desc    Update a teacher
router.put('/:id', authenticateToken, teacherController.updateTeacher);

// @route   DELETE /teachers/:id
// @desc    Delete a teacher and their subject assignments
router.delete('/:id', authenticateToken, teacherController.deleteTeacher);

module.exports = router;