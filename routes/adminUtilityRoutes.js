// routes/adminUtilityRoutes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/adminUtilityController');

router.post('/add-questionset-to-test', authenticateToken, ctrl.addQuestionSetToTest);
router.post('/fix-all-tests', authenticateToken, ctrl.fixAllTests);
router.post('/fix-test-dates', authenticateToken, ctrl.fixTestDates);
router.post('/extend-all-tests', authenticateToken, ctrl.extendAllTests);
router.post('/convert-questions', authenticateToken, ctrl.convertQuestions);

module.exports = router;