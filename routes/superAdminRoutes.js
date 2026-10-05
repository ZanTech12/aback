const express = require('express');
const router = express.Router();
const { authenticateToken, isSuperAdmin } = require('../middlewares/authMiddleware');
const superAdminController = require('../controllers/superAdminController');

// PUBLIC: Admin registers using a token (no auth)
router.post('/register', superAdminController.registerAdminWithToken);

// All routes below require a valid token AND the superadmin role
router.use(authenticateToken, isSuperAdmin);

// GET /superadmin/admins
router.get('/admins', superAdminController.getAllAdmins);

// POST /superadmin/generate-token
router.post('/generate-token', superAdminController.generateAdminToken);

// PUT & DELETE /superadmin/admins/:id
router.route('/admins/:id')
    .put(superAdminController.updateAdmin)
    .delete(superAdminController.deleteAdmin);

// PATCH /superadmin/admins/:id/toggle-status
router.patch('/admins/:id/toggle-status', superAdminController.toggleAdminStatus);

module.exports = router;