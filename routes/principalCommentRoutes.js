// routes/principalCommentRoutes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/principalCommentController');

router.get('/', authenticateToken, ctrl.getPrincipalComments);
router.post('/', authenticateToken, ctrl.createPrincipalComment);
router.post('/generate', authenticateToken, ctrl.generatePrincipalComments);
router.put('/:id', authenticateToken, ctrl.updatePrincipalComment);
router.delete('/:id', authenticateToken, ctrl.deletePrincipalComment);

module.exports = router;