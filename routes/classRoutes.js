const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const validate = require('../middlewares/validationMiddleware');
const classController = require('../controllers/classController');

// ===================================================================
// *** CLASS ROUTES ***
// ===================================================================

// Specific routes (must be defined before `/:id` to prevent route collision)
router.get('/all', authenticateToken, classController.getAllClassesForDropdown);
router.get('/teacher/:teacherId', authenticateToken, classController.getTeacherClasses);
router.get('/with-subjects/:id', authenticateToken, classController.getClassWithSubjects);

// Main CRUD routes
router.route('/')
    .get(authenticateToken, classController.getClasses)
    .post(authenticateToken, validate.createClass, classController.createClass);

router.route('/:id')
    .get(authenticateToken, classController.getClassById)
    .put(authenticateToken, validate.updateClass, classController.updateClass)
    .delete(authenticateToken, classController.deleteClass);

module.exports = router;