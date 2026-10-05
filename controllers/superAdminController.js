const bcrypt = require('bcryptjs');
const crypto = require('crypto'); // ✅ ADDED for token generation
const prisma = require('../config/db');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ✅ RESTORED: Generate School Code from Full Name (for multi-tenant routing)
const generateSchoolCode = async (schoolName) => {
    if (!schoolName) return null;
    const baseSlug = schoolName.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    
    let schoolCode = baseSlug;
    let counter = 1;
    let existingSchool = await prisma.admin.findFirst({ where: { schoolCode } });
    
    while (existingSchool) {
        schoolCode = `${baseSlug}${counter}`;
        existingSchool = await prisma.admin.findFirst({ where: { schoolCode } });
        counter++;
    }
    return schoolCode;
};

// Get all School Admins (SuperAdmin only)
exports.getAllAdmins = async (req, res) => {
    try {
        if (req.user.role !== 'superadmin') return res.status(403).json({ success: false, message: 'Access denied. Super Admin role required.' });

        const admins = await prisma.admin.findMany();
        const responseData = admins.map(a => {
            const adminObj = { ...a, _id: a.id };
            delete adminObj.password;
            return adminObj;
        });
        
        res.json({ success: true, data: responseData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ===================================================================
// *** NEW: GENERATE REGISTRATION TOKEN (SuperAdmin only) ***
// ===================================================================
exports.generateAdminToken = async (req, res) => {
    try {
        if (req.user.role !== 'superadmin') return res.status(403).json({ success: false, message: 'Access denied. Super Admin role required.' });

        const { schoolName, studentLimit, expiryDate, allowedFeatures } = req.body;
        
        // 1. Generate a secure random 32-character hex string
        const token = crypto.randomBytes(16).toString('hex');

        // 2. Save token to database
        const newToken = await prisma.adminToken.create({
            data: {
                token,
                schoolName: schoolName || null,
                studentLimit: Number(studentLimit) || 0,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                allowedFeatures: allowedFeatures || null // ✅ ADDED: Save feature permissions
            }
        });

        // 3. Construct the registration link safely
        let origin = req.headers.origin || req.headers.referer || `${req.protocol}://${req.get('host')}`;
        const registrationUrl = `${origin}/register?token=${token}`;

        res.status(201).json({ 
            success: true, 
            data: { 
                token, 
                registrationUrl,
                schoolName: schoolName || 'Not Specified'
            }, 
            message: 'Registration token generated successfully. Send the link to the school admin.' 
        });
    } catch (error) {
        console.error('Generate Token error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ===================================================================
// *** NEW: REGISTER ADMIN USING TOKEN (Public Route - No Auth) ***
// ===================================================================
exports.registerAdminWithToken = async (req, res) => {
    try {
        const { token, username, password, name, schoolName } = req.body;

        // 1. Find token in database
        const tokenRecord = await prisma.adminToken.findUnique({ where: { token } });
        if (!tokenRecord) {
            return res.status(404).json({ success: false, message: 'Invalid registration token.' });
        }
        if (tokenRecord.isUsed) {
            return res.status(400).json({ success: false, message: 'This registration token has already been used.' });
        }

        // 2. Check if username is already taken
        const existingAdmin = await prisma.admin.findUnique({ where: { username } });
        if (existingAdmin) {
            return res.status(400).json({ success: false, message: 'Username already exists. Please choose another.' });
        }

        // 3. Hash the password chosen by the admin
        const hashedPassword = await bcrypt.hash(password, 10);

        // 4. Use schoolName from token if provided by SuperAdmin, otherwise use from form
        const finalSchoolName = tokenRecord.schoolName || schoolName;
        if (!finalSchoolName) {
            return res.status(400).json({ success: false, message: 'School Name is required.' });
        }

        // ✅ AUTOMATICALLY GENERATE THE SCHOOL CODE HERE
        const schoolCode = await generateSchoolCode(finalSchoolName);

        // 5. Create the Admin account
        const newAdmin = await prisma.admin.create({
            data: {
                username,
                password: hashedPassword,
                name,
                schoolName: finalSchoolName,
                schoolCode, // ✅ Saves "brainfieldcollege" to the database
                studentLimit: tokenRecord.studentLimit,
                expiryDate: tokenRecord.expiryDate, // Carry over expiry set by SuperAdmin
                isActive: true,
                // ✅ ADDED: Inherit allowed features from token, or default to all true
                allowedFeatures: tokenRecord.allowedFeatures || { 
                    admin: { all: true }, 
                    teacher: { all: true }, 
                    student: { all: true } 
                }
            }
        });

        // 6. Mark the token as used so it can't be reused
        await prisma.adminToken.update({
            where: { id: tokenRecord.id },
            data: { isUsed: true }
        });

        res.status(201).json({ 
            success: true, 
            message: 'School Admin account created successfully. You can now login.', 
            data: { 
                username: newAdmin.username 
            }
        });
    } catch (error) {
        console.error('Register Admin error:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Username already exists.' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update School Admin (SuperAdmin only)
exports.updateAdmin = async (req, res) => {
    try {
        if (req.user.role !== 'superadmin') return res.status(403).json({ success: false, message: 'Access denied. Super Admin role required.' });

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid admin ID format.' });
        const adminId = parseInt(req.params.id);

        const { name, schoolName, studentLimit, expiryDate, password, username, allowedFeatures } = req.body;
        
        const updateData = {};
        if (name) updateData.name = name;
        if (schoolName) updateData.schoolName = schoolName;
        if (studentLimit !== undefined) {
            let parsedLimit = Number(studentLimit);
            if (!Number.isNaN(parsedLimit)) updateData.studentLimit = parsedLimit;
        }
        if (username) updateData.username = username;
        if (expiryDate) updateData.expiryDate = new Date(expiryDate);

        // ✅ ADDED: Allow updating allowed features
        if (allowedFeatures) {
            updateData.allowedFeatures = allowedFeatures;
        }

        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateData.password = hashedPassword;
        }

        const updatedAdmin = await prisma.admin.update({
            where: { id: adminId },
            data: updateData
        });

        const adminResponse = { ...updatedAdmin, _id: updatedAdmin.id };
        delete adminResponse.password;

        res.json({ success: true, data: adminResponse, message: 'School Admin updated successfully' });
    } catch (error) {
        console.error('Update Admin error:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, message: 'Admin not found.' });
        }
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Username already exists. Please choose another.' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// Activate/Deactivate School Admin (SuperAdmin only)
exports.toggleAdminStatus = async (req, res) => {
    try {
        if (req.user.role !== 'superadmin') return res.status(403).json({ success: false, message: 'Access denied. Super Admin role required.' });

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid admin ID format.' });
        const adminId = parseInt(req.params.id);

        const admin = await prisma.admin.findUnique({ where: { id: adminId } });
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });

        const updatedAdmin = await prisma.admin.update({
            where: { id: adminId },
            data: { 
                isActive: !admin.isActive,
                deactivatedAt: !admin.isActive ? new Date() : null
            }
        });
        
        const message = updatedAdmin.isActive ? 'School Admin activated successfully' : 'School Admin deactivated successfully';
        res.json({ success: true, data: { isActive: updatedAdmin.isActive }, message });
    } catch (error) {
        console.error('Toggle Admin error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete School Admin (SuperAdmin only)
exports.deleteAdmin = async (req, res) => {
    try {
        if (req.user.role !== 'superadmin') return res.status(403).json({ success: false, message: 'Access denied. Super Admin role required.' });

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid admin ID format.' });
        const adminId = parseInt(req.params.id);

        // ✅ ADDED: Transaction to delete all related data first
        await prisma.$transaction([
            prisma.resultPin.deleteMany({ where: { adminId } }),
            prisma.teacherAssignment.deleteMany({ where: { adminId } }),
            prisma.schoolOpenDays.deleteMany({ where: { adminId } }),
            prisma.resultAccessSchedule.deleteMany({ where: { adminId } }),
            prisma.principalComment.deleteMany({ where: { adminId } }),
            prisma.teacherComment.deleteMany({ where: { adminId } }),
            prisma.classTeacherComment.deleteMany({ where: { adminId } }),
            prisma.gradingSystem.deleteMany({ where: { adminId } }),
            prisma.continuousAssessment.deleteMany({ where: { adminId } }),
            prisma.attendance.deleteMany({ where: { adminId } }),
            prisma.studentSubmission.deleteMany({ where: { adminId } }),
            prisma.questionSet.deleteMany({ where: { adminId } }),
            prisma.question.deleteMany({ where: { adminId } }),
            prisma.test.deleteMany({ where: { adminId } }),
            prisma.term.deleteMany({ where: { adminId } }),
            prisma.session.deleteMany({ where: { adminId } }),
            prisma.subject.deleteMany({ where: { adminId } }),
            prisma.class.deleteMany({ where: { adminId } }),
            prisma.student.deleteMany({ where: { adminId } }),
            prisma.teacher.deleteMany({ where: { adminId } }),
            prisma.siteInformation.deleteMany({ where: { adminId } }),
            
            // Finally, delete the Admin
            prisma.admin.delete({ where: { id: adminId } })
        ]);

        res.json({ success: true, message: 'School Admin and all associated data deleted successfully' });
    } catch (error) {
        console.error('Delete Admin error:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};