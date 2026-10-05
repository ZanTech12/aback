// routes/studentFeesRoutes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/studentFeesController');

router.get('/fees-summary', authenticateToken, ctrl.getFeesSummary);

module.exports = router;
