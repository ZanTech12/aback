const express = require('express');
const router = express.Router();
const multer = require('multer');
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/siteInformationController');

// ==========================================
// MULTER CONFIGURATION (Memory Storage for Cloudinary)
// ==========================================
// ✅ CHANGED: Using memoryStorage instead of diskStorage.
// This is required for Vercel/Serverless so the file can be streamed directly to Cloudinary.
const storage = multer.memoryStorage();

const upload = multer({ storage: storage });

// All routes are protected
router.use(authenticateToken);

// GET /site-information
router.get('/', ctrl.getSiteInfo);

// PUT /site-information (Creates or Updates)
// We use upload.fields() to accept multiple file inputs from the frontend
router.put('/', upload.fields([
    { name: 'schoolLogo', maxCount: 1 },
    { name: 'principalSignature', maxCount: 1 },
    { name: 'schoolStamp', maxCount: 1 }
]), ctrl.upsertSiteInfo);

// ✅ NEW: DELETE /site-information/image/:field (Removes a single image from Cloudinary/DB)
router.delete('/image/:field', ctrl.deleteSingleImage);

// ✅ ADDED: Network Settings Routes
router.get('/network-settings', ctrl.getNetworkSettings);
router.put('/network-settings', ctrl.updateNetworkSettings);

// DELETE /site-information (Deletes the entire site info record)
router.delete('/', ctrl.deleteSiteInfo);

module.exports = router;