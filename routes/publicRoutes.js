const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/publicController');
const resultPinController = require('../controllers/resultPinController');

// ⚠️ NOTICE: There is NO authenticateToken middleware here! 
// This file must remain completely public.

// Your exact working routes
router.get('/terms', ctrl.getPublicTerms);
router.get('/sessions', ctrl.getPublicSessions);

// ✅ ADDED: Public route for school information (address, motto, phone, email, etc.)
router.get('/site-info', ctrl.getPublicSiteInfo);

// ✅ ADDED: Public route for checking results (NO AUTH REQUIRED)
router.post('/check-result', resultPinController.checkResultPublic);

module.exports = router;