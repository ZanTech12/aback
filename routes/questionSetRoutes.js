const express = require('express');
const router = express.Router();
const { authenticateToken, isTeacherOrAdmin } = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/questionSetController');

router.route('/')
    .get(authenticateToken, isTeacherOrAdmin, ctrl.getQuestionSets)
    .post(authenticateToken, isTeacherOrAdmin, ctrl.createQuestionSet);

router.route('/:id')
    .put(authenticateToken, isTeacherOrAdmin, ctrl.updateQuestionSet)
    .delete(authenticateToken, isTeacherOrAdmin, ctrl.deleteQuestionSet);

module.exports = router;