const jwt = require('jsonwebtoken');

exports.authenticateToken = (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        console.log('[DEBUG Auth] Authorization Header:', authHeader ? authHeader.substring(0, 30) + '...' : 'MISSING');

        let token = authHeader && authHeader.split(' ')[1];

        // --- NEW: Fallback to URL query parameter for WebBrowser/PDF viewers ---
        if (!token && req.query.token) {
            token = req.query.token;
            console.log('[DEBUG Auth] SUCCESS: Found token in URL query parameter.');
        }
        // ----------------------------------------------------------------------

        if (!token) {
            console.log('[DEBUG Auth] FAILED: No token provided');
            return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('[DEBUG Auth] SUCCESS: Token decoded. Role:', decoded.role);
        
        // ✅ normalize role to lowercase so 'Admin'/'ADMIN' never 403 by accident
        const user = decoded.user || decoded;
        req.user = { ...user, role: String(user.role || '').toLowerCase() };
        next();
    } catch (error) {
        console.error('[DEBUG Auth] FAILED: jwt.verify error:', error.message);
        res.status(401).json({ success: false, message: 'Token is not valid' });
    }
};

exports.isTeacherOrAdmin = (req, res, next) => {
    if (!['teacher', 'admin', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    next();
};

// ✅ NEW: admin OR superadmin — matches the ['admin','superadmin'] checks
// your studentController already performs internally
exports.isAdmin = (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
    }
    next();
};

exports.isSuperAdmin = (req, res, next) => {
    if (req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Access denied. SuperAdmin role required.' });
    }
    next();
};