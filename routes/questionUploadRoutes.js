const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;

// Configure Cloudinary
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET 
});

// REMOVED: fs and path imports (Vercel serverless is read-only)
// REMOVED: mkdirSync directory creation logic

// CHANGED: Use memoryStorage instead of diskStorage
const storage = multer.memoryStorage();

// Images only, max 5MB
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.mimetype);
        cb(ok ? null : new Error('Only image files are allowed'), ok);
    },
});

// POST /question-sets/upload-image   (multipart field: "image")
router.post('/upload-image', authenticateToken, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });

    // Create a Cloudinary upload stream directly from the memory buffer
    const stream = cloudinary.uploader.upload_stream(
        { folder: "school_questions" }, 
        (error, result) => {
            if (error) {
                console.error('Cloudinary Upload Error:', error);
                return res.status(500).json({ success: false, message: error.message });
            }
            
            // Return the permanent Cloudinary URL to the frontend
            res.json({
                success: true,
                url: result.secure_url 
            });
        }
    );
    
    // Pipe the multer memory buffer to Cloudinary
    stream.end(req.file.buffer);
});

module.exports = router;