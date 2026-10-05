const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const termController = require('../controllers/termController');

// ===================================================================
// *** TERM ROUTES ***
// ===================================================================

// Specific routes (must be before /:id to prevent routing conflicts)
router.get('/active', authenticateToken, termController.getActiveTerm);

// Main CRUD routes
router.route('/')
    .get(authenticateToken, termController.getTerms)
    .post(authenticateToken, termController.createTerm);

router.route('/:id')
    .get(authenticateToken, termController.getTermById)
    .put(authenticateToken, termController.updateTerm)
    .delete(authenticateToken, termController.deleteTerm);

module.exports = router;