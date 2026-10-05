const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/resultScheduleController');

console.log('🧩 resultScheduleController exports:', Object.keys(ctrl).join(', '));

// ── Static paths FIRST (never shadowed by /:id) ──
router.get('/current',       authenticateToken, ctrl.getSchedule);                 // resultScheduleAPI.getCurrent
router.get('/public-status', authenticateToken, ctrl.getPublicResultAccessStatus); // student-facing status

// ── Collection / param paths ──
router.get('/',              authenticateToken, ctrl.getAllSchedules);        // resultScheduleAPI.getAll
router.post('/',             authenticateToken, ctrl.createSchedule);         // resultScheduleAPI.create
router.put('/:id',           authenticateToken, ctrl.updateSchedule);         // resultScheduleAPI.update
router.patch('/:id/toggle-active', authenticateToken, ctrl.toggleScheduleActive); // resultScheduleAPI.toggleActive
router.delete('/:id',        authenticateToken, ctrl.deleteSchedule);         // resultScheduleAPI.delete

module.exports = router;