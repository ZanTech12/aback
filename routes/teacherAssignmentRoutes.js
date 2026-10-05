const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/teacherAssignmentController');

router.get('/', authenticateToken, ctrl.getAssignments);
router.get('/count', authenticateToken, ctrl.getAssignmentCount);
router.get('/teacher/:teacherId', authenticateToken, ctrl.getAssignmentsByTeacher);
router.get('/class/:classId', authenticateToken, ctrl.getAssignmentsByClass);
router.post('/bulk', authenticateToken, ctrl.bulkCreateAssignments);

router.route('/')
    .post(authenticateToken, ctrl.createAssignment);

router.route('/:id')
    .get(authenticateToken, ctrl.getAssignmentById)
    .put(authenticateToken, ctrl.updateAssignment)
    .delete(authenticateToken, ctrl.deleteAssignment);

router.delete('/:id/permanent', authenticateToken, ctrl.permanentDeleteAssignment);

module.exports = router;