const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);
const { authenticateToken } = require('../middlewares/authMiddleware');

// ===================================================================
// SYNCHRONIZATION ROUTE
// ===================================================================
router.post('/:direction', authenticateToken, async (req, res) => {
    try {
        // ✅ CHANGED: Allow both Admin and SuperAdmin
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admins only.' });
        }

        const direction = req.params.direction;
        const LOCAL_URL = process.env.DATABASE_URL;
        const ONLINE_URL = process.env.ONLINE_DATABASE_URL;

        if (!LOCAL_URL || !ONLINE_URL) {
            return res.status(500).json({ success: false, message: 'Database URLs not configured in .env' });
        }

        const tempFile = path.join(os.tmpdir(), 'temp_sync.dump');
        let dumpCmd, restoreCmd;

        if (direction === 'to-local') {
            console.log("Dumping from Neon Cloud...");
            dumpCmd = `pg_dump -Fc -f "${tempFile}" "${ONLINE_URL}"`;
            restoreCmd = `pg_restore -c -d "${LOCAL_URL}" "${tempFile}"`;
        } else if (direction === 'to-online') {
            console.log("Dumping from Local Database...");
            dumpCmd = `pg_dump -Fc -f "${tempFile}" "${LOCAL_URL}"`;
            restoreCmd = `pg_restore -c -d "${ONLINE_URL}" "${tempFile}"`;
        } else {
            return res.status(400).json({ success: false, message: 'Invalid direction. Use "to-local" or "to-online".' });
        }

        console.log(`Starting sync (${direction})...`);
        
        await execAsync(dumpCmd);
        await execAsync(restoreCmd);

        console.log(`Sync (${direction}) completed successfully!`);
        return res.status(200).json({ success: true, message: `Synchronization (${direction}) completed successfully!` });

    } catch (error) {
        console.error('Sync error:', error.message);
        return res.status(500).json({ success: false, message: 'Synchronization failed.', error: error.message });
    } finally {
        const tempFile = path.join(os.tmpdir(), 'temp_sync.dump');
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
    }
});

module.exports = router;