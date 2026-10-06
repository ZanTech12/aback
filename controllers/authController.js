const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

// ===================================================================
// *** HELPER: Extract School Code from Subdomain ***
// ✅ FIXED: *.vercel.app hosts must NEVER be treated as school subdomains.
//    On Vercel the "subdomain" is just the PROJECT NAME (aback-xi,
//    hybridsys-pi), which was silently overwriting the schoolCode sent
//    by the mobile/web login form → "Invalid school portal."
//    Now only YOUR base domains can carry a school subdomain, and only
//    when one actually exists (apex domains like okispecial.com.ng → null).
// ===================================================================
const SCHOOL_DOMAIN_SUFFIXES = [
    '.okispecial.com.ng',
    '.fountainhillsschools.com.ng',
    '.lvh.me',   // local dev: fountainhills.lvh.me
    '.nip.io',   // local dev: fountainhills.192.168.x.x.nip.io
];

const getSchoolCodeFromSubdomain = (req) => {
    let host = (req.headers['x-forwarded-host'] || req.headers.host || '')
        .toLowerCase().trim();
    host = host.split(':')[0]; // drop :port

    // Ignore localhost and raw IP addresses (local/LAN server)
    if (host.includes('localhost') || host.match(/^(\d{1,3}\.){3}\d{1,3}$/)) {
        return null;
    }

    // ✅ Never treat Vercel's own domains as school subdomains
    if (host.endsWith('.vercel.app')) {
        return null;
    }

    // ✅ Only whitelisted base domains can carry a school subdomain
    const suffix = SCHOOL_DOMAIN_SUFFIXES.find(s => host.endsWith(s));
    if (!suffix) return null;

    const sub = host.slice(0, host.length - suffix.length);
    if (sub && sub !== 'www' && !sub.includes('.')) {
        return sub.toLowerCase().trim();
    }
    return null; // apex domain (no subdomain) → let the body's schoolCode be used
};

// ===================================================================
// *** HELPER: Check Expiry Status ***
// ===================================================================
const checkExpiryStatus = async (admin) => {
    if (admin.expiryDate && new Date() > admin.expiryDate) {
        if (admin.isActive) {
            await prisma.admin.update({
                where: { id: admin.id },
                data: { isActive: false, deactivatedAt: new Date() }
            });
        }
        return false;
    }
    return admin.isActive;
};

// ===================================================================
// *** 1. GENERAL LOGIN (Handles all roles via req.body.role) ***
// ===================================================================
exports.login = async (req, res) => {
    const { role, ...credentials } = req.body;

    try {
        let user;

        // ✅ DEBUG: prints the EXACT username received (whitespace is visible
        // in the quotes — e.g. "abimbola " with a trailing space)
        console.log(`[LOGIN] role=${role} username=${JSON.stringify(credentials.username)}`);
        
        // --- SUPERADMIN LOGIN ---
        if (role === 'superadmin') {
            const cleanUsername = String(credentials.username || '').trim();   // ✅ trim
            user = await prisma.superAdmin.findFirst({ where: { username: { equals: cleanUsername, mode: 'insensitive' } } });
            if (!user) return res.status(401).json({ success: false, message: 'SuperAdmin not found' });

            const isMatch = await bcrypt.compare(credentials.password, user.password);
            if (!isMatch) return res.status(401).json({ success: false, message: 'Password mismatch' });

            const token = jwt.sign(
                { id: user.id, role: 'superadmin', name: user.username }, 
                process.env.JWT_SECRET, 
                { expiresIn: '24h' }
            );
            return res.json({ 
                success: true, token, 
                user: { _id: user.id, name: user.username, role: 'superadmin' } 
            });
        } 
        
        // --- ADMIN LOGIN (No School Code Required) ---
        else if (role === 'admin') {
            const cleanUsername = String(credentials.username || '').trim();   // ✅ trim — phone keyboards append spaces
            user = await prisma.admin.findFirst({ 
                where: { 
                    username: { equals: cleanUsername, mode: 'insensitive' }
                } 
            });
            
            if (!user) {
                return res.status(401).json({ success: false, message: 'Admin not found' });
            }

            const isMatch = await bcrypt.compare(credentials.password, user.password);
            if (!isMatch) {
                return res.status(401).json({ success: false, message: 'Password mismatch' });
            }

            const isActive = await checkExpiryStatus(user);
            if (!isActive) return res.status(403).json({ success: false, message: 'Account deactivated due to subscription expiry.' });
            if (!user.isActive) return res.status(403).json({ success: false, message: 'Account deactivated by SuperAdmin.' });

            const token = jwt.sign(
                { 
                    id: user.id, 
                    role: 'admin', 
                    name: user.name, 
                    schoolCode: user.schoolCode,
                    allowedFeatures: user.allowedFeatures,
                    networkSettings: user.networkSettings
                }, 
                process.env.JWT_SECRET, 
                { expiresIn: '24h' }
            );
            return res.json({ 
                success: true, token, 
                user: { 
                    _id: user.id, 
                    name: user.name, 
                    username: user.username, 
                    role: 'admin', 
                    schoolName: user.schoolName,
                    allowedFeatures: user.allowedFeatures,
                    networkSettings: user.networkSettings
                } 
            });
        } 
        
        // --- TEACHER LOGIN ---
        else if (role === 'teacher') {
            let schoolCode = credentials.schoolCode?.toLowerCase().trim();
            const subdomainCode = getSchoolCodeFromSubdomain(req);
            if (subdomainCode) schoolCode = subdomainCode;
            
            if (!schoolCode) return res.status(400).json({ success: false, message: 'Please login via your school portal link.' });

            const school = await prisma.admin.findFirst({ 
                where: { schoolCode: { equals: schoolCode, mode: 'insensitive' } } 
            });
            if (!school) return res.status(404).json({ success: false, message: 'Invalid school portal.' });

            if (!school.isActive) {
                return res.status(403).json({ success: false, message: 'This school portal is currently deactivated. Please contact the SuperAdmin.' });
            }

            const cleanUsername = String(credentials.username || '').trim();   // ✅ trim
            user = await prisma.teacher.findFirst({ where: { username: { equals: cleanUsername, mode: 'insensitive' }, adminId: school.id } });
            if (!user) return res.status(401).json({ success: false, message: 'Teacher not found' });

            const isMatch = await bcrypt.compare(credentials.password, user.password);
            if (!isMatch) return res.status(401).json({ success: false, message: 'Password mismatch' });

            const loginIP = req.ip || req.headers['x-forwarded-for'] || '';
            const loginDevice = req.headers['user-agent'] || '';
            
            await prisma.teacher.update({
                where: { id: user.id },
                data: { lastLogin: new Date(), lastLoginIP: loginIP, lastLoginDevice: loginDevice }
            });

            const token = jwt.sign(
                { 
                    id: user.id, 
                    role: 'teacher', 
                    adminId: user.adminId, 
                    schoolCode: school.schoolCode,
                    allowedFeatures: school.allowedFeatures,
                    networkSettings: school.networkSettings
                }, 
                process.env.JWT_SECRET, 
                { expiresIn: '24h' }
            );
            return res.json({ 
                success: true, token, 
                user: { 
                    _id: user.id, 
                    firstName: user.firstName, 
                    lastName: user.lastName, 
                    username: user.username, 
                    role: 'teacher',
                    allowedFeatures: school.allowedFeatures,
                    networkSettings: school.networkSettings
                } 
            });
        }

        // --- STUDENT LOGIN ---
        else if (role === 'student') {
            let schoolCode = credentials.schoolCode?.toLowerCase().trim();
            const subdomainCode = getSchoolCodeFromSubdomain(req);
            if (subdomainCode) schoolCode = subdomainCode;

            if (!schoolCode) return res.status(400).json({ success: false, message: 'Please login via your school portal link.' });

            const school = await prisma.admin.findFirst({ 
                where: { schoolCode: { equals: schoolCode, mode: 'insensitive' } } 
            });
            if (!school) return res.status(404).json({ success: false, message: 'Invalid school portal.' });

            if (!school.isActive) {
                return res.status(403).json({ success: false, message: 'This school portal is currently deactivated. Please contact the SuperAdmin.' });
            }

            // ✅ trim (matches the dedicated student handler)
            const cleanAdmissionNumber = String(credentials.admissionNumber || '').trim();
            const cleanFirstName = String(credentials.firstName || '').trim();

            user = await prisma.student.findFirst({ 
                where: { 
                    adminId: school.id, 
                    admissionNumber: { equals: cleanAdmissionNumber, mode: 'insensitive' },
                    firstName: { equals: cleanFirstName, mode: 'insensitive' },
                    isDeleted: { not: true }
                } 
            });

            if (!user) return res.status(401).json({ success: false, message: 'Student not found' });

            if (user.owingFees && !user.feesAccessGranted) {
                return res.status(403).json({ success: false, message: 'Access denied. Please contact the school administration regarding your outstanding fees.', code: 'FEES_BLOCKED' });
            }

            const token = jwt.sign(
                { 
                    id: user.id, 
                    role: 'student', 
                    adminId: user.adminId, 
                    schoolCode: school.schoolCode,
                    allowedFeatures: school.allowedFeatures,
                    networkSettings: school.networkSettings
                }, 
                process.env.JWT_SECRET, 
                { expiresIn: '24h' }
            );
            return res.json({ 
                success: true, token, 
                user: { 
                    _id: user.id, 
                    firstName: user.firstName, 
                    lastName: user.lastName, 
                    admissionNumber: user.admissionNumber, 
                    role: 'student', 
                    profileImage: user.profileImage || null,
                    allowedFeatures: school.allowedFeatures,
                    networkSettings: school.networkSettings
                } 
            });
        }

        res.status(401).json({ success: false, message: 'Invalid credentials (Role not recognized)' });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ===================================================================
// *** 2. DEDICATED SUPERADMIN LOGIN ***
// ===================================================================
exports.loginSuperAdmin = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password are required.' });

    try {
        const cleanUsername = String(username).trim();   // ✅ trim
        const superAdmin = await prisma.superAdmin.findFirst({ where: { username: { equals: cleanUsername, mode: 'insensitive' } } });
        if (!superAdmin) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

        const isMatch = await bcrypt.compare(password, superAdmin.password);
        if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

        const payload = { id: superAdmin.id, role: 'superadmin' };
        
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' }, (err, token) => {
            if (err) throw err;
            res.status(200).json({
                success: true,
                token,
                user: { _id: superAdmin.id, username: superAdmin.username, role: 'superadmin' }
            });
        });

    } catch (err) {
        console.error('SuperAdmin login error:', err.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ===================================================================
// *** 3. DEDICATED ADMIN LOGIN ***
// ===================================================================
exports.loginAdmin = async (req, res) => {
    const { username, password, schoolCode: bodyCode } = req.body;

    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password are required.' });

    try {
        let schoolCode = bodyCode?.toLowerCase().trim();
        const subdomainCode = getSchoolCodeFromSubdomain(req);
        if (subdomainCode) schoolCode = subdomainCode;

        if (!schoolCode) return res.status(400).json({ success: false, message: 'Please login via your school portal link.' });

        const cleanUsername = String(username).trim();   // ✅ trim
        const admin = await prisma.admin.findFirst({ 
            where: { 
                username: { equals: cleanUsername, mode: 'insensitive' }, 
                schoolCode: { equals: schoolCode, mode: 'insensitive' } 
            } 
        });
        if (!admin) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

        const isActive = await checkExpiryStatus(admin);
        if (!isActive) return res.status(403).json({ success: false, message: 'Account deactivated due to subscription expiry.' });
        if (!admin.isActive) return res.status(403).json({ success: false, message: 'Account deactivated by SuperAdmin.' });

        const payload = { 
            id: admin.id, 
            role: 'admin', 
            name: admin.name, 
            schoolCode: admin.schoolCode,
            allowedFeatures: admin.allowedFeatures,
            networkSettings: admin.networkSettings
        };
        
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' }, (err, token) => {
            if (err) throw err;
            res.status(200).json({
                success: true,
                token,
                user: {
                    _id: admin.id,
                    name: admin.name,
                    username: admin.username,
                    schoolName: admin.schoolName,
                    role: 'admin',
                    allowedFeatures: admin.allowedFeatures,
                    networkSettings: admin.networkSettings
                }
            });
        });

    } catch (err) {
        console.error('Admin login error:', err.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ===================================================================
// *** 4. DEDICATED TEACHER LOGIN ***
// ===================================================================
exports.loginTeacher = async (req, res) => {
    const { username, password, schoolCode: bodyCode } = req.body;

    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password are required.' });

    try {
        let schoolCode = bodyCode?.toLowerCase().trim();
        const subdomainCode = getSchoolCodeFromSubdomain(req);
        if (subdomainCode) schoolCode = subdomainCode;

        if (!schoolCode) return res.status(400).json({ success: false, message: 'Please login via your school portal link.' });

        // ✅ DEBUG: shows exactly which code is being used (check Vercel → Functions logs)
        console.log(`[TEACHER LOGIN] host=${req.headers.host} bodyCode=${bodyCode} subdomainCode=${subdomainCode} final=${schoolCode}`);

        const school = await prisma.admin.findFirst({ 
            where: { schoolCode: { equals: schoolCode, mode: 'insensitive' } } 
        });
        if (!school) return res.status(404).json({ success: false, message: 'Invalid school portal.' });

        if (!school.isActive) {
            return res.status(403).json({ success: false, message: 'This school portal is currently deactivated. Please contact the SuperAdmin.' });
        }

        const cleanUsername = String(username).trim();   // ✅ trim
        const teacher = await prisma.teacher.findFirst({ where: { username: { equals: cleanUsername, mode: 'insensitive' }, adminId: school.id } });
        if (!teacher) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

        const isMatch = await bcrypt.compare(password, teacher.password);
        if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

        const loginIP = req.ip || req.headers['x-forwarded-for'] || '';
        const loginDevice = req.headers['user-agent'] || '';

        await prisma.teacher.update({
            where: { id: teacher.id },
            data: { lastLogin: new Date(), lastLoginIP: loginIP, lastLoginDevice: loginDevice }
        });

        const payload = { 
            id: teacher.id, 
            role: 'teacher', 
            adminId: teacher.adminId, 
            schoolCode: school.schoolCode,
            allowedFeatures: school.allowedFeatures,
            networkSettings: school.networkSettings
        };
        
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' }, (err, token) => {
            if (err) throw err;
            res.status(200).json({
                success: true,
                token,
                user: {
                    _id: teacher.id,
                    username: teacher.username,
                    firstName: teacher.firstName,
                    lastName: teacher.lastName,
                    role: 'teacher',
                    allowedFeatures: school.allowedFeatures,
                    networkSettings: school.networkSettings
                }
            });
        });

    } catch (err) {
        console.error('Teacher login error:', err.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ===================================================================
// *** 5. DEDICATED STUDENT LOGIN ***
// ===================================================================
exports.loginStudent = async (req, res) => {
    const { admissionNumber, firstName, lastName, schoolCode: bodyCode } = req.body;

    if (!admissionNumber || !firstName) return res.status(400).json({ success: false, message: 'Admission Number and First Name are required.' });

    try {
        let schoolCode = bodyCode?.toLowerCase().trim();
        const subdomainCode = getSchoolCodeFromSubdomain(req);
        if (subdomainCode) schoolCode = subdomainCode;

        if (!schoolCode) return res.status(400).json({ success: false, message: 'Please login via your school portal link.' });

        // ✅ DEBUG: shows exactly which code is being used
        console.log(`[STUDENT LOGIN] host=${req.headers.host} bodyCode=${bodyCode} subdomainCode=${subdomainCode} final=${schoolCode}`);

        const school = await prisma.admin.findFirst({ 
            where: { schoolCode: { equals: schoolCode, mode: 'insensitive' } } 
        });
        if (!school) return res.status(404).json({ success: false, message: 'Invalid school portal.' });

        if (!school.isActive) {
            return res.status(403).json({ success: false, message: 'This school portal is currently deactivated. Please contact the SuperAdmin.' });
        }

        const cleanAdmissionNumber = admissionNumber.trim();
        const cleanFirstName = firstName.trim();
        const cleanLastName = lastName ? lastName.trim() : null;

        const student = await prisma.student.findFirst({
            where: {
                adminId: school.id,
                admissionNumber: { equals: cleanAdmissionNumber, mode: 'insensitive' },
                firstName: { equals: cleanFirstName, mode: 'insensitive' },
                isDeleted: { not: true }
            }
        });

        if (!student) return res.status(401).json({ success: false, message: 'Invalid admission number or first name.' });

        if (cleanLastName && student.lastName && student.lastName.toLowerCase() !== cleanLastName.toLowerCase()) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        if (student.owingFees && !student.feesAccessGranted) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Please contact the school administration regarding your outstanding fees.',
                code: 'FEES_BLOCKED'
            });
        }

        const payload = { 
            id: student.id, 
            role: 'student', 
            adminId: student.adminId, 
            schoolCode: school.schoolCode,
            allowedFeatures: school.allowedFeatures,
            networkSettings: school.networkSettings
        };
        
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' }, (err, token) => {
            if (err) throw err;
            res.status(200).json({
                success: true,
                token,
                user: {
                    _id: student.id,
                    firstName: student.firstName,
                    lastName: student.lastName,
                    admissionNumber: student.admissionNumber,
                    role: 'student',
                    allowedFeatures: school.allowedFeatures,
                    networkSettings: school.networkSettings
                }
            });
        });

    } catch (err) {
        console.error('Student login error:', err.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};