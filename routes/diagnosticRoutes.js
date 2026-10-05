// routes/diagnosticRoutes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
// ... import controllers for diagnostics
module.exports = router;