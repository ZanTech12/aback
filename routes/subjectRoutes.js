const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const subjectController = require('../controllers/subjectController');

// @route   GET /subjects
// @desc    Get all subjects
router.get('/', authenticateToken, subjectController.getSubjects);

// @route   POST /subjects
// @desc    Create a subject
router.post('/', authenticateToken, subjectController.createSubject);

// @route   GET /subjects/by-class/:classId
// @desc    Get subjects assigned to a specific class
router.get('/by-class/:classId', authenticateToken, subjectController.getSubjectsByClass);

// @route   PUT /subjects/:id
// @desc    Update a subject
router.put('/:id', authenticateToken, subjectController.updateSubject);

// @route   DELETE /subjects/:id
// @desc    Delete a subject (if not in use)
router.delete('/:id', authenticateToken, subjectController.deleteSubject);

module.exports = router;