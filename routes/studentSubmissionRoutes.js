const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/studentSubmissionController');

router.route('/')
    .get(authenticateToken, ctrl.getSubmissions)
    .post(authenticateToken, ctrl.createSubmission);

router.route('/:id')
    .put(authenticateToken, ctrl.updateSubmission);

module.exports = router;