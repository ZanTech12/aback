const express = require('express');
const prisma = require('../config/db');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Import the auth middleware
const { authenticateToken } = require('../middlewares/authMiddleware');

// Initialize Express App
const app = express();

// Helper — pick the first existing path. This file lives in /api, so we check
// both the "/api-relative" and "repo-root-relative" layouts. This lets the
// same file work locally (LAN/desktop server) AND on Vercel.
const firstExisting = (candidates, mustContain) =>
    candidates.find(p => fs.existsSync(mustContain ? path.join(p, mustContain) : p)) || null;

// ===================================================================
// *** 1. CORS CONFIGURATION ***
// ===================================================================
const allowedOrigins = process.env.CLIENT_URLS
    ? process.env.CLIENT_URLS.split(',')
    : [
        'https://okispecial.com.ng',
        'https://www.okispecial.com.ng',
        'https://fountainhillsschools.com.ng',
        'https://www.fountainhillsschools.com.ng',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173'
    ];

const corsOptions = {
    origin: function (origin, callback) {
        // ✅ Allow all origins in development mode (local network/phone testing)
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }

        // Production CORS rules
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
        if (origin.includes('lvh.me') || origin.includes('nip.io')) return callback(null, true);
        if (origin.includes('okispecial.com.ng')) return callback(null, true);
        if (origin.includes('fountainhillsschools.com.ng')) return callback(null, true);

        // ✅ Allow localhost + private-network origins in EVERY mode.
        // Students connect from http://<server-ip>:5000 (same server, different
        // host string), and the desktop app's own probes come from localhost.
        // This is what a school-LAN server should always accept.
        try {
            const host = new URL(origin).hostname;
            if (
                host === 'localhost' || host === '127.0.0.1' ||
                /^10\./.test(host) ||
                /^192\.168\./.test(host) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(host)
            ) {
                return callback(null, true);
            }
        } catch (e) { /* malformed origin — fall through */ }

        console.log(`🚫 Blocked by CORS: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// ===================================================================
// *** 2. GLOBAL MIDDLEWARES ***
// ===================================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static admin pages (sync.html etc.) — api/public OR <repo-root>/public
const publicDir = firstExisting([
    path.join(__dirname, 'public'),
    path.join(__dirname, '..', 'public')
]);
if (publicDir) app.use(express.static(publicDir));

// ===================================================================
// *** SERVE REACT FRONTEND — static files ***
// (server.js resolves <backend>/../cschoolexam/build; this file sits in
//  /api — one level deeper — so both layouts are checked.)
// ===================================================================
const frontendBuild = firstExisting([
    path.join(__dirname, '..', 'cschoolexam', 'build'),
    path.join(__dirname, '..', '..', 'cschoolexam', 'build')
], 'index.html');

if (frontendBuild) {
    app.use(express.static(frontendBuild));
}

// ===================================================================
// *** SPA ROUTES — browser navigations to frontend pages ***
// ===================================================================
const SPA_ROUTES = ['/login', '/admin', '/teacher', '/student', '/register'];
if (frontendBuild) {
    app.use((req, res, next) => {
        if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
            const matchesSpa = SPA_ROUTES.some(r => req.path === r || req.path.startsWith(r + '/'));
            if (matchesSpa) {
                return res.sendFile(path.join(frontendBuild, 'index.html'));
            }
        }
        next();
    });
}

// ===================================================================
// ✅ HEALTH CHECK ROUTE — registered BEFORE all API mounts (especially
//    app.use('/api', analyticsRoutes)) so nothing can intercept it.
//    Reports the sync version so you can verify in the browser WHICH
//    code is actually running. Used by Network Settings.
// ===================================================================
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        status: 'ok',
        message: 'Server is online',
        syncVersion: 'v4.1'
    });
});

// ===================================================================
// *** SECURE STATIC FILE SERVING FOR UPLOADS ***
// ✅ Authenticated + path-traversal safe.
// ===================================================================
const uploadsDir = firstExisting([
    path.join(__dirname, 'uploads'),
    path.join(__dirname, '..', 'uploads')
]) || path.join(__dirname, '..', 'uploads');

app.use('/uploads', authenticateToken, (req, res) => {
    const resolvedRoot = path.resolve(uploadsDir);
    const filePath = path.resolve(uploadsDir, '.' + req.path);

    // Block any attempt to escape the uploads folder (../../)
    if (filePath !== resolvedRoot && !filePath.startsWith(resolvedRoot + path.sep)) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('File send error:', err);
            res.status(404).json({ success: false, message: 'File not found' });
        }
    });
});

// ===================================================================
// *** 3. DATABASE CONNECTION (local/desktop mode only — on Vercel, ***
// *** Prisma connects lazily on the first query)                 ***
// ===================================================================
async function connectDB() {
    try {
        await prisma.$connect();
        console.log('✅ PostgreSQL Database connected successfully!');
    } catch (err) {
        console.error('❌ PostgreSQL Connection Error:', err);
        process.exit(1);
    }
}

// ===================================================================
// *** 4. IMPORT ROUTES ***
// ===================================================================
const authRoutes = require('../routes/authRoutes');
const superAdminRoutes = require('../routes/superAdminRoutes');
const dashboardRoutes = require('../routes/dashboardRoutes');
const teacherRoutes = require('../routes/teacherRoutes');
const subjectRoutes = require('../routes/subjectRoutes');
const classRoutes = require('../routes/classRoutes');
const studentRoutes = require('../routes/studentRoutes');
const studentFeesRoutes = require('../routes/studentFeesRoutes');
const studentTestRoutes = require('../routes/studentTestRoutes');
const testRoutes = require('../routes/testRoutes');
const testResultRoutes = require('../routes/testResultRoutes');
const questionSetRoutes = require('../routes/questionSetRoutes');
const studentSubmissionRoutes = require('../routes/studentSubmissionRoutes');
const questionUploadRoutes = require('../routes/questionUploadRoutes');
const classTeacherCommentRoutes = require('../routes/classTeacherCommentRoutes');
const teacherAssignmentRoutes = require('../routes/teacherAssignmentRoutes');
const principalCommentRoutes = require('../routes/principalCommentRoutes');
const teacherCommentRoutes = require('../routes/teacherCommentRoutes');
const sessionRoutes = require('../routes/sessionRoutes');
const termRoutes = require('../routes/termRoutes');
const gradingSystemRoutes = require('../routes/gradingSystemRoutes');
const continuousAssessmentRoutes = require('../routes/continuousAssessmentRoutes');
const adminUtilityRoutes = require('../routes/adminUtilityRoutes');
const adminCaRoutes = require('../routes/adminCaRoutes');
const analyticsRoutes = require('../routes/analyticsRoutes');
const diagnosticRoutes = require('../routes/diagnosticRoutes');
const attendanceRoutes = require('../routes/attendanceRoutes');
const reportCardRoutes = require('../routes/reportCardRoutes');
const publicRoutes = require('../routes/publicRoutes');
const studentResultRoutes = require('../routes/studentResultRoutes');
const adminStudentBlockRoutes = require('../routes/adminStudentBlockRoutes');
const siteInfoRoutes = require('../routes/siteInformationRoutes');
const resultScheduleRoutes = require('../routes/resultScheduleRoutes');
const broadsheetRoutes = require('../routes/broadsheetRoutes');
const adminCaManagementRoutes = require('../routes/adminCaManagementRoutes');
const adminScoresRoutes = require('../routes/adminScoresRoutes');
const scoreManagementRoutes = require('../routes/scoreManagementRoutes');
const eNoteRoutes = require('../routes/eNoteRoutes');
const resultPinRoutes = require('../routes/resultPinRoutes'); // ✅ Result PIN routes

// ✅ SYNC ROUTE — lives in ../routes/syncRoutes.js (v4.1)
//    Pre-flight schema check • strict exit codes • --single-transaction
//    • unique temp dumps • concurrency guard • auto schema repair.
//    All pg_dump/pg_restore/prisma logic is in that file, NOT here.
//    (Replaces the old inline sync route — same endpoints:
//      POST /sync/to-online  and  POST /sync/to-local)
const syncRoutes = require('../routes/syncRoutes');

// ===================================================================
// *** 5. MOUNT ROUTES ***
// ===================================================================

// Root endpoint
app.get('/', (req, res) => res.json({ success: true, message: 'School Management API is running...' }));

app.use('/login', authRoutes);
app.use('/superadmin', superAdminRoutes);

app.use('/dashboard', dashboardRoutes);
app.use('/teachers', teacherRoutes);
app.use('/subjects', subjectRoutes);
app.use('/classes', classRoutes);

app.use('/students', studentRoutes);
app.use('/students', studentFeesRoutes);
app.use('/student', studentTestRoutes);

app.use('/tests', testRoutes);
app.use('/test-results', testResultRoutes);

app.use('/question-sets', questionUploadRoutes);
app.use('/question-sets', questionSetRoutes);

app.use('/student-submissions', studentSubmissionRoutes);

app.use('/class-teacher-comments', classTeacherCommentRoutes);
app.use('/teacher-assignments', teacherAssignmentRoutes);
app.use('/principal-comments', principalCommentRoutes);
app.use('/teacher-comments', teacherCommentRoutes);

app.use('/sessions', sessionRoutes);
app.use('/terms', termRoutes);
app.use('/grading-systems', gradingSystemRoutes);
app.use('/continuous-assessments', continuousAssessmentRoutes);

app.use('/attendance', attendanceRoutes);
app.use('/report-cards', reportCardRoutes);
app.use('/api', analyticsRoutes);
app.use('/public', publicRoutes);
app.use('/result-schedules', resultScheduleRoutes);
app.use('/e-notes', eNoteRoutes);

// ✅ SPECIFIC ADMIN ROUTES (Must be mounted BEFORE the generic /admin route)
app.use('/admin/ca', adminCaRoutes);
app.use('/admin/result-pins', resultPinRoutes);

// ✅ SYNC — POST /sync/to-online and /sync/to-local
//    (Was the inline pg_dump/pg_restore route with progress streaming —
//    now served by the syncRoutes v4.1 module, exactly like server.js.)
app.use('/sync', syncRoutes);

// ✅ GENERIC ADMIN ROUTE (Must be mounted AFTER specific routes)
app.use('/admin', adminUtilityRoutes);

// --- Root mounted routes (These must be LAST so they don't block specific routes) ---
app.use('/', diagnosticRoutes);
app.use('/', studentResultRoutes);
app.use('/site-information', siteInfoRoutes);
app.use('/', adminStudentBlockRoutes);
app.use('/', broadsheetRoutes);
app.use('/', adminCaManagementRoutes);
app.use('/', adminScoresRoutes);
app.use('/', scoreManagementRoutes);

// ===================================================================
// *** SPA FALLBACK — any unmatched GET that wants HTML gets the app ***
// ===================================================================
if (frontendBuild) {
    app.use((req, res, next) => {
        if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
            return res.sendFile(path.join(frontendBuild, 'index.html'));
        }
        next();
    });
}

// ===================================================================
// *** 6. GLOBAL ERROR HANDLER ***
// ===================================================================
app.use((req, res, next) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
    console.error('Global Error:', err.stack);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
    });
});

// ===================================================================
// *** 7. AUTOMATIC SUPERADMIN INITIALIZATION ***
// (Runs only when starting locally — skipped on Vercel serverless)
// ===================================================================
const initializeSuperAdmin = async () => {
    try {
        const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
        const email = process.env.SUPERADMIN_EMAIL || 'superadmin@yourschool.com';
        const password = process.env.SUPERADMIN_PASSWORD || 'SuperSecretPassword123';

        const superAdminExists = await prisma.superAdmin.findUnique({ where: { username } });

        if (!superAdminExists) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            await prisma.superAdmin.create({
                data: { username, email, password: hashedPassword }
            });

            console.log('✅ Default SuperAdmin created successfully!');
        }
    } catch (error) {
        console.error('❌ Error initializing SuperAdmin:', error.message);
    }
};

// ===================================================================
// *** 8. START SERVER LOCALLY / EXPORT FOR VERCEL SERVERLESS ***
// Vercel sets VERCEL automatically. Everything else (local dev, LAN
// server, packaged desktop app — even with NODE_ENV=production) runs
// as a real HTTP server.
// ===================================================================
const isServerless = !!process.env.VERCEL;

if (!isServerless) {
    const PORT = process.env.PORT || 5000;

    connectDB().then(async () => {
        await initializeSuperAdmin();

        try {
            app.listen(PORT, () => {
                console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
                console.log(`🌐 Allowed CORS Origins: ${allowedOrigins.join(', ')}`);
            });
        } catch (err) {
            console.error(`❌ Failed to start server on port ${PORT}:`, err.message);
        }
    }).catch(err => {
        console.error('❌ Failed to connect to database or start server:', err);
    });

    process.on('exit', (code) => {
        console.log(`\n⚠️ Process is exiting with code: ${code}`);
    });
    process.on('uncaughtException', (err) => {
        console.error('❌ UNCAUGHT EXCEPTION:', err);
    });
    process.on('unhandledRejection', (reason) => {
        console.error('❌ UNHANDLED REJECTION:', reason);
    });

    // Keep the Node process alive when embedded (desktop / packaged app)
    setInterval(() => {}, 1000);
} else {
    // Vercel serverless: app is exported below; Prisma connects lazily.
    console.log('☁️  Serverless (Vercel) mode — app exported; Prisma connects lazily.');
}

// Export for Vercel Serverless
module.exports = app;