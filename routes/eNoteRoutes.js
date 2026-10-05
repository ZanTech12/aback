const express = require('express');
const router = express.Router();
const multer = require('multer');
const eNoteController = require('../controllers/eNoteController');

// Use your exact auth middleware
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;

// REMOVED: fs and path imports (Vercel serverless is read-only)
// REMOVED: mkdirSync directory creation logic

// CHANGED: Use memoryStorage instead of diskStorage
const storage = multer.memoryStorage();

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Only PDFs allowed!'), false),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

// ============================================
// ROUTES
// ============================================

router.get('/my-info', authenticateToken, eNoteController.getMyStudentInfo);
router.get('/my-classes', authenticateToken, eNoteController.getMyClasses);
router.get('/my-subjects', authenticateToken, eNoteController.getMySubjects);
router.get('/students', authenticateToken, eNoteController.getStudentsByClass);
router.get('/weeks', authenticateToken, eNoteController.getWeeksByClass);

router.post('/weeks', authenticateToken, eNoteController.createWeek);
router.post('/weeks/:weekId/upload', authenticateToken, upload.array('pdfFiles', 10), eNoteController.uploadFiles);

router.delete('/files/:fileId', authenticateToken, eNoteController.deleteFile);
// ✅ Delete Week (Admin Only)
router.delete('/weeks/:weekId', authenticateToken, eNoteController.deleteWeek);

module.exports = router;