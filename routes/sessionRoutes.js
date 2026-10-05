const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const sessionController = require('../controllers/sessionController');

// ===================================================================
// *** SESSION ROUTES ***
// ===================================================================

// @route   GET /sessions
// @desc    Get all active sessions
router.get('/', authenticateToken, sessionController.getSessions);

// @route   GET /sessions/:id
// @desc    Get a single session by ID
router.get('/:id', authenticateToken, sessionController.getSessionById);

// @route   POST /sessions
// @desc    Create a new academic session (Admin/SuperAdmin)
router.post('/', authenticateToken, sessionController.createSession);

// @route   PUT /sessions/:id
// @desc    Update an academic session (Admin/SuperAdmin)
router.put('/:id', authenticateToken, sessionController.updateSession);

// @route   DELETE /sessions/:id
// @desc    Soft delete an academic session (Admin/SuperAdmin)
router.delete('/:id', authenticateToken, sessionController.deleteSession);

module.exports = router;