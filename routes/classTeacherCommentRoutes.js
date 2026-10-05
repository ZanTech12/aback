const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/classTeacherCommentController');

router.get('/', authenticateToken, ctrl.getComments);
router.get('/class/:classId', authenticateToken, ctrl.getCommentsByClass);
router.get('/student/:studentId', authenticateToken, ctrl.getCommentsByStudent);

router.post('/', authenticateToken, ctrl.createComment);
router.put('/:id', authenticateToken, ctrl.updateComment);
router.delete('/:id', authenticateToken, ctrl.deleteComment);

module.exports = router;