// routes/studentTestRoutes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const checkResultAccess = require('../middlewares/resultMiddleware').checkResultAccess;
const ctrl = require('../controllers/studentTestController');
const mainCtrl = require('../controllers/testController'); // has getStudentTestById & submitTest
 dashboardController = require('../controllers/dashboardController');   // ✅ ADD THIS

// ---- STATIC ROUTES (before :id) ----
router.get('/dashboard', authenticateToken, dashboardController.getStudentDashboard);  // ✅ ADD THIS
router.get('/tests', authenticateToken, mainCtrl.getStudentTests);
router.get('/all-tests', authenticateToken, ctrl.getStudentAllTests);
router.get('/test-schedule', authenticateToken, ctrl.getStudentTestSchedule);
router.get('/test-results', authenticateToken, checkResultAccess, ctrl.getStudentTestResults);

// ---- DYNAMIC ROUTES (LAST) ----
router.get('/tests/:id', authenticateToken, mainCtrl.getStudentTestById);
router.post('/tests/:id/submit', authenticateToken, mainCtrl.submitTest);

module.exports = router;