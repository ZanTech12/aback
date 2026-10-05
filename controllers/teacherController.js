const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to fetch related Subjects for an array of teachers
const populateTeacherSubjects = async (teachers) => {
    if (!teachers || teachers.length === 0) return [];

    const subjectIds = [...new Set(teachers.flatMap(t => t.subjects || []))];
    const subjects = await prisma.subject.findMany({ where: { id: { in: subjectIds } } });
    
    const subjectMap = new Map(subjects.map(s => [s.id, s]));

    return teachers.map(t => ({
        ...t,
        subjects: (t.subjects || []).map(id => subjectMap.get(id)).filter(Boolean),
    }));
};

// ===================================================================
// *** GET ALL TEACHERS ***
// ===================================================================
exports.getTeachers = async (req, res) => {
    try {
        const teachers = await prisma.teacher.findMany({ 
            where: getTenantFilter(req) 
        });

        const populatedTeachers = await populateTeacherSubjects(teachers);
        
        // Map _id for frontend consistency
        const responseData = populatedTeachers.map(t => ({ ...t, _id: t.id }));

        res.json({ success: true, data: responseData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ===================================================================
// *** CREATE TEACHER ***
// ===================================================================
exports.createTeacher = async (req, res) => {
    try {
        const { password, subjects, experience, ...teacherData } = req.body;
        
        if (!password) {
            return res.status(400).json({ success: false, message: 'Password is required' });
        }

        // ✅ FIX: Resolve the correct adminId and verify it exists
        let adminId;
        if (req.user.role === 'admin') {
            adminId = req.user.id;
        } else if (req.user.role === 'superadmin' && req.body.adminId) {
            adminId = req.body.adminId;
        } else if (req.user.adminId) {
            adminId = req.user.adminId;
        } else {
            return res.status(400).json({ success: false, message: 'Admin ID is required to create a teacher.' });
        }

        const parsedAdminId = parseInt(adminId);
        if (isNaN(parsedAdminId)) {
            return res.status(400).json({ success: false, message: 'Invalid Admin ID format.' });
        }

        // ✅ DEBUG: Log the resolved IDs
        console.log(`[CREATE TEACHER] Resolved adminId: ${parsedAdminId}, User Role: ${req.user.role}, req.user.id: ${req.user.id}`);

        // ✅ VERIFY: Check if the Admin actually exists in the database
        const adminExists = await prisma.admin.findUnique({ where: { id: parsedAdminId } });
        if (!adminExists) {
            return res.status(404).json({ success: false, message: `Admin account with ID ${parsedAdminId} was not found in the database. Please log out and log back in.` });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Ensure experience is saved as an integer
        const parsedExperience = experience ? parseInt(experience) : 0;
        
        const newTeacher = await prisma.teacher.create({
            data: {
                ...teacherData,
                password: hashedPassword,
                adminId: parsedAdminId, // ✅ Use the verified ID
                experience: isNaN(parsedExperience) ? 0 : parsedExperience,
                subjects: subjects ? subjects.map(id => parseInt(id)) : []
            }
        });

        const [populatedTeacher] = await populateTeacherSubjects([newTeacher]);
        
        res.status(201).json({ success: true, data: { ...populatedTeacher, _id: populatedTeacher.id } });
    } catch (error) {
        console.error('Error creating teacher:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Email or username already exists for this school.' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// ===================================================================
// *** UPDATE TEACHER ***
// ===================================================================
exports.updateTeacher = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid teacher ID format.' });
        const teacherId = parseInt(req.params.id);

        const { password, subjects, experience, ...updateData } = req.body;

        if (password && password.trim() !== '') {
            const salt = await bcrypt.genSalt(10);
            updateData.password = await bcrypt.hash(password, salt);
        }

        if (subjects) {
            updateData.subjects = subjects.map(id => parseInt(id));
        }

        // Ensure experience is updated as an integer
        if (experience !== undefined) {
            const parsedExperience = experience ? parseInt(experience) : 0;
            updateData.experience = isNaN(parsedExperience) ? 0 : parsedExperience;
        }

        // Verify ownership before updating
        const teacher = await prisma.teacher.findFirst({ where: { ...getTenantFilter(req), id: teacherId } });
        if (!teacher) {
            return res.status(404).json({ success: false, message: 'Teacher not found' });
        }

        const updatedTeacher = await prisma.teacher.update({
            where: { id: teacherId },
            data: updateData
        });

        const [populatedTeacher] = await populateTeacherSubjects([updatedTeacher]);

        res.json({ success: true, data: { ...populatedTeacher, _id: populatedTeacher.id } });
    } catch (error) {
        console.error('Error updating teacher:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Email or username already exists.' });
        }
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ===================================================================
// *** DELETE TEACHER ***
// ===================================================================
exports.deleteTeacher = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid teacher ID format.' });
        const teacherId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const teacher = await prisma.teacher.findFirst({ where: { ...tenantFilter, id: teacherId } });
        if (!teacher) {
            return res.status(404).json({ success: false, message: 'Teacher not found' });
        }

        // 1. Delete all assigned subjects (TeacherAssignment records) within the same school
        const assignmentDeleteResult = await prisma.teacherAssignment.deleteMany({ 
            where: { ...tenantFilter, teacherId: teacherId } 
        });

        // 2. CA entries are NOT deleted - they remain in the system to preserve student scores
        // 3. Delete the teacher document
        await prisma.teacher.delete({ where: { id: teacherId } });

        console.log(`[DELETE TEACHER] Deleted teacher ${teacher.firstName} ${teacher.lastName}. Removed ${assignmentDeleteResult.count} subject assignment(s). CA entries preserved.`);

        res.json({ 
            success: true, 
            message: 'Teacher deleted successfully. Their assigned subjects have been removed, but all CA entries remain intact.' 
        });

    } catch (error) {
        console.error('Error deleting teacher:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};