const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/teacherCommentController');

router.route('/')
    .get(authenticateToken, ctrl.getComments)
    .post(authenticateToken, ctrl.createComment);

router.post('/bulk/reapprove', authenticateToken, ctrl.bulkReapproveComments);

router.put('/:id/approve', authenticateToken, ctrl.approveComment);
router.put('/:id/unapprove', authenticateToken, ctrl.unapproveComment);

module.exports = router;