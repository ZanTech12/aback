const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const gradingController = require('../controllers/gradingSystemController');

// ===================================================================
// *** GRADING SYSTEM ROUTES ***
// ===================================================================

// @route   GET /grading-systems
// @desc    Get all grading systems
router.get('/', authenticateToken, gradingController.getGradingSystems);

// @route   GET /grading-systems/default
// @desc    Get the default grading system
router.get('/default', authenticateToken, gradingController.getDefaultGradingSystem);

// @route   POST /grading-systems
// @desc    Create a grading system (Admin/SuperAdmin)
router.post('/', authenticateToken, gradingController.createGradingSystem);

// @route   PUT /grading-systems/:id
// @desc    Update a grading system (Admin/SuperAdmin)
router.put('/:id', authenticateToken, gradingController.updateGradingSystem);

// @route   DELETE /grading-systems/:id
// @desc    Soft delete a grading system (Admin/SuperAdmin)
router.delete('/:id', authenticateToken, gradingController.deleteGradingSystem);

module.exports = router;