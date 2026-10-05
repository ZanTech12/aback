const express = require('express');
const router = express.Router();
const resultPinController = require('../controllers/resultPinController');
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;

// ============================================
// ROUTES
// ============================================

// POST /admin/result-pins/generate
router.post('/generate', authenticateToken, resultPinController.generatePins);

// GET /admin/result-pins/list
router.get('/list', authenticateToken, resultPinController.getPins);

module.exports = router;