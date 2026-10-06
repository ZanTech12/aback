const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to safely get Admin ID
const getAdminId = (req) => {
    if (req.user.role === 'admin') return parseInt(req.user.id);
    if (req.user.role === 'teacher' || req.user.role === 'student') return parseInt(req.user.adminId);
    // Superadmins must pass adminId in the body/query to create an assignment for a specific school
    if (req.user.role === 'superadmin' && req.body.adminId) return parseInt(req.body.adminId);
    return null;
};

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to fetch related Teacher, Class, and Subject for an array of assignments
const populateAssignmentRelations = async (assignments, adminId) => {
    if (!assignments || assignments.length === 0) return [];

    const teacherIds = [...new Set(assignments.map(a => a.teacherId).filter(Boolean))];
    const classIds = [...new Set(assignments.map(a => a.classId).filter(Boolean))];
    const subjectIds = [...new Set(assignments.map(a => a.subjectId).filter(Boolean))];

    const [teachers, classes, subjects] = await Promise.all([
        prisma.teacher.findMany({ where: { id: { in: teacherIds }, ...(adminId ? { adminId } : {}) } }),
        prisma.class.findMany({ where: { id: { in: classIds }, ...(adminId ? { adminId } : {}) } }),
        prisma.subject.findMany({ where: { id: { in: subjectIds }, ...(adminId ? { adminId } : {}) } })
    ]);

    const teacherMap = new Map(teachers.map(t => [t.id, t]));
    const classMap = new Map(classes.map(c => [c.id, c]));
    const subjectMap = new Map(subjects.map(s => [s.id, s]));

    return assignments.map(a => ({
        ...a,
        teacher_id: a.teacherId ? { ...teacherMap.get(a.teacherId), _id: a.teacherId } : null,
        class_id: a.classId ? { ...classMap.get(a.classId), _id: a.classId } : null,
        subject_id: a.subjectId ? { ...subjectMap.get(a.subjectId), _id: a.subjectId } : null,
    }));
};

exports.getAssignments = async (req, res) => {
    try {
        const query = { ...getTenantFilter(req), isActive: true };
        
        if (req.user.role === 'teacher') {
            query.teacherId = parseInt(req.user.id);
        } else if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const teacherIdParam = req.query.teacherId || req.query.teacher_id;
        const classIdParam = req.query.classId || req.query.class_id;
        const subjectIdParam = req.query.subjectId || req.query.subject_id;

        if (teacherIdParam && isValidId(teacherIdParam)) query.teacherId = parseInt(teacherIdParam);
        if (classIdParam && isValidId(classIdParam)) query.classId = parseInt(classIdParam);
        if (subjectIdParam && isValidId(subjectIdParam)) query.subjectId = parseInt(subjectIdParam);

        const assignments = await prisma.teacherAssignment.findMany({
            where: query,
            orderBy: { createdAt: 'desc' }
        });

        const adminId = getAdminId(req);
        const populatedAssignments = await populateAssignmentRelations(assignments, adminId);

        const tenantFilter = getTenantFilter(req);

        const formattedAssignments = await Promise.all(populatedAssignments.map(async (assignment) => {
            const questionCount = await prisma.question.count({ 
                where: { ...tenantFilter, teacherId: assignment.teacherId, subjectId: assignment.subjectId, classId: assignment.classId } 
            });
            const testCount = await prisma.test.count({ 
                where: { ...tenantFilter, classId: assignment.classId, subjectId: assignment.subjectId, createdById: assignment.teacherId, isActive: true } 
            });

            return {
                id: assignment.id,
                teacher_id: assignment.teacher_id, teacherId: assignment.teacher_id,
                teacher_name: assignment.teacher_id ? `${assignment.teacher_id.firstName} ${assignment.teacher_id.lastName}` : 'Unknown',
                teacher_email: assignment.teacher_id ? assignment.teacher_id.email : '',
                teacher_username: assignment.teacher_id ? assignment.teacher_id.username : '',
                class_id: assignment.class_id, classId: assignment.class_id,
                class_name: assignment.class_id ? `${assignment.class_id.name} ${assignment.class_id.section || ''}`.trim() : 'Unknown',
                class_level: assignment.class_id ? assignment.class_id.level : '',
                subject_id: assignment.subject_id, subjectId: assignment.subject_id,
                subject_name: assignment.subject_id ? assignment.subject_id.name : 'Unknown',
                subject_code: assignment.subject_id ? assignment.subject_id.code : '',
                question_count: questionCount, test_count: testCount,
                is_active: assignment.isActive, created_at: assignment.createdAt, updated_at: assignment.updatedAt
            };
        }));

        res.json({ success: true, data: formattedAssignments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getAssignmentCount = async (req, res) => {
    try {
        const query = { ...getTenantFilter(req), isActive: true };
        if (req.user.role === 'teacher') query.teacherId = parseInt(req.user.id);
        else if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const teacherIdParam = req.query.teacherId || req.query.teacher_id;
        const classIdParam = req.query.classId || req.query.class_id;
        const subjectIdParam = req.query.subjectId || req.query.subject_id;

        if (teacherIdParam && isValidId(teacherIdParam)) query.teacherId = parseInt(teacherIdParam);
        if (classIdParam && isValidId(classIdParam)) query.classId = parseInt(classIdParam);
        if (subjectIdParam && isValidId(subjectIdParam)) query.subjectId = parseInt(subjectIdParam);

        const count = await prisma.teacherAssignment.count({ where: query });
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAssignmentById = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const assignmentId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const assignment = await prisma.teacherAssignment.findFirst({ where: { ...tenantFilter, id: assignmentId } });

        if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });

        const adminId = getAdminId(req);
        const [populatedAssignmentArr] = await populateAssignmentRelations([assignment], adminId);
        const populatedAssignment = populatedAssignmentArr;

        if (req.user.role === 'teacher' && populatedAssignment.teacher_id?._id !== parseInt(req.user.id)) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const questionCount = await prisma.question.count({ 
            where: { ...tenantFilter, teacherId: assignment.teacherId, subjectId: assignment.subjectId, classId: assignment.classId } 
        });
        const testCount = await prisma.test.count({ 
            where: { ...tenantFilter, classId: assignment.classId, subjectId: assignment.subjectId, createdById: assignment.teacherId, isActive: true } 
        });

        const formattedAssignment = {
            id: assignment.id,
            teacher_id: populatedAssignment.teacher_id, teacherId: populatedAssignment.teacher_id,
            teacher_name: populatedAssignment.teacher_id ? `${populatedAssignment.teacher_id.firstName} ${populatedAssignment.teacher_id.lastName}` : 'Unknown',
            class_id: populatedAssignment.class_id, classId: populatedAssignment.class_id,
            class_name: populatedAssignment.class_id ? `${populatedAssignment.class_id.name} ${populatedAssignment.class_id.section || ''}`.trim() : 'Unknown',
            subject_id: populatedAssignment.subject_id, subjectId: populatedAssignment.subject_id,
            subject_name: populatedAssignment.subject_id ? populatedAssignment.subject_id.name : 'Unknown',
            question_count: questionCount, test_count: testCount,
            is_active: assignment.isActive
        };

        res.json({ success: true, data: formattedAssignment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getAssignmentsByTeacher = async (req, res) => {
    try {
        if (req.user.role === 'teacher' && parseInt(req.user.id) !== parseInt(req.params.teacherId)) return res.status(403).json({ success: false, message: 'Access denied.' });
        if (!isValidId(req.params.teacherId)) return res.status(400).json({ success: false, message: 'Invalid teacher ID format.' });

        const teacherId = parseInt(req.params.teacherId);
        const tenantFilter = getTenantFilter(req);

        const assignments = await prisma.teacherAssignment.findMany({ 
            where: { ...tenantFilter, teacherId, isActive: true },
            orderBy: { createdAt: 'desc' }
        });

        const adminId = getAdminId(req);
        const populatedAssignments = await populateAssignmentRelations(assignments, adminId);

        const formattedAssignments = await Promise.all(populatedAssignments.map(async (assignment) => {
            const questionCount = await prisma.question.count({ 
                where: { ...tenantFilter, teacherId: assignment.teacherId, subjectId: assignment.subjectId, classId: assignment.classId } 
            });
            const testCount = await prisma.test.count({ 
                where: { ...tenantFilter, classId: assignment.classId, subjectId: assignment.subjectId, createdById: assignment.teacherId, isActive: true } 
            });
            return {
                id: assignment.id,
                teacher_id: assignment.teacher_id, teacherId: assignment.teacher_id,
                teacher_name: assignment.teacher_id ? `${assignment.teacher_id.firstName} ${assignment.teacher_id.lastName}` : 'Unknown',
                class_id: assignment.class_id, classId: assignment.class_id,
                class_name: assignment.class_id ? `${assignment.class_id.name} ${assignment.class_id.section || ''}`.trim() : 'Unknown',
                subject_id: assignment.subject_id, subjectId: assignment.subject_id,
                subject_name: assignment.subject_id ? assignment.subject_id.name : 'Unknown',
                question_count: questionCount, test_count: testCount
            };
        }));

        res.json({ success: true, data: formattedAssignments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getAssignmentsByClass = async (req, res) => {
    try {
        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        if (!isValidId(req.params.classId)) return res.status(400).json({ success: false, message: 'Invalid class ID format.' });

        const classId = parseInt(req.params.classId);
        const tenantFilter = getTenantFilter(req);

        const assignments = await prisma.teacherAssignment.findMany({ 
            where: { ...tenantFilter, classId, isActive: true },
            orderBy: { createdAt: 'desc' }
        });

        const adminId = getAdminId(req);
        const populatedAssignments = await populateAssignmentRelations(assignments, adminId);

        const formattedAssignments = await Promise.all(populatedAssignments.map(async (assignment) => {
            const questionCount = await prisma.question.count({ 
                where: { ...tenantFilter, teacherId: assignment.teacherId, subjectId: assignment.subjectId, classId: assignment.classId } 
            });
            return {
                id: assignment.id,
                teacher_id: assignment.teacher_id, teacherId: assignment.teacher_id,
                teacher_name: assignment.teacher_id ? `${assignment.teacher_id.firstName} ${assignment.teacher_id.lastName}` : 'Unknown',
                class_id: assignment.class_id, classId: assignment.class_id,
                class_name: assignment.class_id ? `${assignment.class_id.name} ${assignment.class_id.section || ''}`.trim() : 'Unknown',
                subject_id: assignment.subject_id, subjectId: assignment.subject_id,
                subject_name: assignment.subject_id ? assignment.subject_id.name : 'Unknown',
                question_count: questionCount
            };
        }));

        res.json({ success: true, data: formattedAssignments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.createAssignment = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const teacher_id = req.body.teacher_id || req.body.teacherId;
        const class_id = req.body.class_id || req.body.classId;
        const subject_id = req.body.subject_id || req.body.subjectId;

        if (!teacher_id || !class_id || !subject_id) return res.status(400).json({ success: false, message: 'Teacher, Class, and Subject are required.' });

        if (!isValidId(teacher_id) || !isValidId(class_id) || !isValidId(subject_id)) {
            return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        }

        const parsedTeacherId = parseInt(teacher_id);
        const parsedClassId = parseInt(class_id);
        const parsedSubjectId = parseInt(subject_id);

        const adminId = getAdminId(req);

        // If SuperAdmin didn't pass adminId in body, they can't create an assignment
        if (!adminId || isNaN(adminId)) {
            return res.status(400).json({ success: false, message: 'Admin ID is required to create an assignment.' });
        }

        const [teacherExists, classExists, subjectExists] = await Promise.all([
            prisma.teacher.findFirst({ where: { adminId, id: parsedTeacherId } }), 
            prisma.class.findFirst({ where: { adminId, id: parsedClassId } }), 
            prisma.subject.findFirst({ where: { adminId, id: parsedSubjectId } })
        ]);
        
        if (!teacherExists) return res.status(404).json({ success: false, message: 'Teacher not found.' });
        if (!classExists) return res.status(404).json({ success: false, message: 'Class not found.' });
        if (!subjectExists) return res.status(404).json({ success: false, message: 'Subject not found.' });
        if (!classExists.isActive) return res.status(400).json({ success: false, message: 'Cannot assign to an inactive class.' });

        const newAssignment = await prisma.teacherAssignment.create({
            data: { 
                adminId, 
                teacherId: parsedTeacherId, 
                classId: parsedClassId, 
                subjectId: parsedSubjectId 
            }
        });

        const [populatedAssignment] = await populateAssignmentRelations([newAssignment], adminId);

        res.status(201).json({ success: true, message: 'Assignment created successfully', data: populatedAssignment });
    } catch (error) {
        if (error.code === 'P2002') return res.status(409).json({ success: false, message: 'This teacher is already assigned to this class and subject.' });
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.updateAssignment = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const assignmentId = parseInt(req.params.id);

        const assignment = await prisma.teacherAssignment.findFirst({ where: { ...getTenantFilter(req), id: assignmentId } });
        if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });

        const dataToUpdate = {};
        
        const teacher_id = req.body.teacher_id !== undefined ? (req.body.teacher_id || req.body.teacherId) : undefined;
        const class_id = req.body.class_id !== undefined ? (req.body.class_id || req.body.classId) : undefined;
        const subject_id = req.body.subject_id !== undefined ? (req.body.subject_id || req.body.subjectId) : undefined;
        const isActive = req.body.isActive !== undefined ? req.body.isActive : (req.body.is_active !== undefined ? req.body.is_active : undefined);

        if (teacher_id && isValidId(teacher_id)) dataToUpdate.teacherId = parseInt(teacher_id);
        if (class_id && isValidId(class_id)) dataToUpdate.classId = parseInt(class_id);
        if (subject_id && isValidId(subject_id)) dataToUpdate.subjectId = parseInt(subject_id);
        if (typeof isActive === 'boolean') dataToUpdate.isActive = isActive;

        const updatedAssignment = await prisma.teacherAssignment.update({
            where: { id: assignmentId },
            data: dataToUpdate
        });

        const adminId = getAdminId(req);
        const [populatedAssignment] = await populateAssignmentRelations([updatedAssignment], adminId);

        res.json({ success: true, message: 'Assignment updated successfully', data: populatedAssignment });
    } catch (error) {
        if (error.code === 'P2002') return res.status(409).json({ success: false, message: 'This teacher is already assigned to this class and subject.' });
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.deleteAssignment = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const assignmentId = parseInt(req.params.id);

        const assignment = await prisma.teacherAssignment.findFirst({ where: { ...getTenantFilter(req), id: assignmentId } });
        if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });

        await prisma.teacherAssignment.update({
            where: { id: assignmentId },
            data: { isActive: false }
        });

        res.json({ success: true, message: 'Assignment deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.permanentDeleteAssignment = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const assignmentId = parseInt(req.params.id);

        try {
            await prisma.teacherAssignment.delete({ where: { id: assignmentId } });
        } catch (err) {
            if (err.code === 'P2025') return res.status(404).json({ success: false, message: 'Assignment not found.' });
            throw err;
        }

        res.json({ success: true, message: 'Assignment permanently deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.bulkCreateAssignments = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        let { assignments } = req.body;
        if (!assignments || !Array.isArray(assignments) || assignments.length === 0) return res.status(400).json({ success: false, message: 'Assignments array is required and must not be empty.' });

        const adminId = getAdminId(req);
        if (!adminId || isNaN(adminId)) {
            return res.status(400).json({ success: false, message: 'Admin ID is required to create assignments.' });
        }

        const formattedAssignments = assignments.map(a => ({ 
            adminId, 
            teacherId: a.teacher_id ? parseInt(a.teacher_id) : parseInt(a.teacherId), 
            classId: a.class_id ? parseInt(a.class_id) : parseInt(a.classId), 
            subjectId: a.subject_id ? parseInt(a.subject_id) : parseInt(a.subjectId) 
        })).filter(a => isValidId(a.teacherId) && isValidId(a.classId) && isValidId(a.subjectId));

        const createdAssignments = [];
        const duplicateErrors = [];

        for (const assignmentData of formattedAssignments) {
            try {
                const assignment = await prisma.teacherAssignment.create({ data: assignmentData });
                createdAssignments.push(assignment);
            } catch (error) {
                if (error.code === 'P2002') {
                    duplicateErrors.push({ ...assignmentData, message: 'Duplicate assignment.' });
                } else {
                    throw error;
                }
            }
        }

        res.status(201).json({ success: true, message: `Created ${createdAssignments.length} assignments (${duplicateErrors.length} duplicates skipped).` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};