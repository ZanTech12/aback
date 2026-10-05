const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to safely get Admin ID
const getAdminId = (req) => req.user.role === 'admin' ? parseInt(req.user.id) : parseInt(req.user.adminId);

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to fetch related Student, Class, Subject, and Teacher for an array of comments
const populateCommentRelations = async (comments) => {
    if (!comments || comments.length === 0) return [];

    const studentIds = [...new Set(comments.map(c => c.studentId).filter(Boolean))];
    const classIds = [...new Set(comments.map(c => c.classId).filter(Boolean))];
    const subjectIds = [...new Set(comments.map(c => c.subjectId).filter(Boolean))];
    const teacherIds = [...new Set(comments.map(c => c.teacherId).filter(Boolean))];

    const [students, classes, subjects, teachers] = await Promise.all([
        prisma.student.findMany({ where: { id: { in: studentIds } } }),
        prisma.class.findMany({ where: { id: { in: classIds } } }),
        prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
        prisma.teacher.findMany({ where: { id: { in: teacherIds } } })
    ]);

    const studentMap = new Map(students.map(s => [s.id, s]));
    const classMap = new Map(classes.map(c => [c.id, c]));
    const subjectMap = new Map(subjects.map(s => [s.id, s]));
    const teacherMap = new Map(teachers.map(t => [t.id, t]));

    // Map back to object structure to match Mongoose frontend expectations
    return comments.map(c => {
        const student = studentMap.get(c.studentId);
        const classData = classMap.get(c.classId);
        const subjectData = subjectMap.get(c.subjectId);
        const teacherData = teacherMap.get(c.teacherId);

        return {
            ...c,
            studentId: student ? { ...student, _id: student.id } : null,
            classId: classData ? { ...classData, _id: classData.id } : null,
            subjectId: subjectData ? { ...subjectData, _id: subjectData.id } : null,
            teacherId: teacherData ? { ...teacherData, _id: teacherData.id } : null,
        };
    });
};

// GET - Get all teacher comments
exports.getComments = async (req, res) => {
    try {
        const { classId, subjectId, termId, sessionId, status, search, page = 1, limit = 50 } = req.query;
        
        const query = { ...getTenantFilter(req), isActive: true };

        if (req.user.role === 'teacher') query.teacherId = parseInt(req.user.id);
        else if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        if (classId && isValidId(classId)) query.classId = parseInt(classId);
        if (subjectId && isValidId(subjectId)) query.subjectId = parseInt(subjectId);
        if (termId && isValidId(termId)) query.termId = parseInt(termId);
        if (sessionId && isValidId(sessionId)) query.sessionId = parseInt(sessionId);
        if (status) query.status = status;

        const comments = await prisma.teacherComment.findMany({
            where: query,
            orderBy: { updatedAt: 'desc' }
        });

        const populatedComments = await populateCommentRelations(comments);
            
        res.json({ success: true, data: populatedComments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// POST - Create teacher comment
exports.createComment = async (req, res) => {
    try {
        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { studentId, classId, subjectId, termId, sessionId, comment, effortRating, behaviourRating, status } = req.body;
        const tenantFilter = getTenantFilter(req);

        if (!isValidId(studentId) || !isValidId(classId) || !isValidId(subjectId) || !isValidId(termId) || !isValidId(sessionId)) {
            return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        }

        const parsedStudentId = parseInt(studentId);
        const parsedClassId = parseInt(classId);
        const parsedSubjectId = parseInt(subjectId);
        const parsedTermId = parseInt(termId);
        const parsedSessionId = parseInt(sessionId);

        if (req.user.role === 'teacher') {
            const assignment = await prisma.teacherAssignment.findFirst({ 
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: parsedClassId, subjectId: parsedSubjectId, isActive: true } 
            });
            if (!assignment) return res.status(403).json({ success: false, message: 'Access denied. Not assigned to this class/subject.' });
        }

        const existingComment = await prisma.teacherComment.findFirst({ 
            where: { ...tenantFilter, studentId: parsedStudentId, classId: parsedClassId, subjectId: parsedSubjectId, termId: parsedTermId, sessionId: parsedSessionId } 
        });

        if (existingComment) {
            if (existingComment.status === 'approved') return res.status(400).json({ success: false, message: 'Cannot modify approved comment.' });
            
            const updatedComment = await prisma.teacherComment.update({
                where: { id: existingComment.id },
                data: {
                    comment,
                    effortRating: effortRating || '',
                    behaviourRating: behaviourRating || '',
                    status: status === 'submitted' ? 'submitted' : 'draft',
                    submittedAt: status === 'submitted' ? new Date() : null
                }
            });

            const [populatedComment] = await populateCommentRelations([updatedComment]);
            return res.json({ success: true, message: 'Comment updated successfully', data: populatedComment });
        }

        const teacherId = req.user.role === 'teacher' ? parseInt(req.user.id) : parseInt(req.body.teacherId);
        
        const newComment = await prisma.teacherComment.create({ 
            data: {
                ...tenantFilter,
                studentId: parsedStudentId, 
                classId: parsedClassId, 
                subjectId: parsedSubjectId, 
                teacherId, 
                termId: parsedTermId, 
                sessionId: parsedSessionId, 
                comment, 
                effortRating: effortRating || '', 
                behaviourRating: behaviourRating || '', 
                status: status || 'draft', 
                submittedAt: status === 'submitted' ? new Date() : null 
            }
        });

        const [populatedComment] = await populateCommentRelations([newComment]);
        
        res.status(201).json({ success: true, message: 'Comment created successfully', data: populatedComment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// PUT - Approve teacher comment
exports.approveComment = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const commentId = parseInt(req.params.id);

        const comment = await prisma.teacherComment.findFirst({ where: { ...getTenantFilter(req), id: commentId } });
        if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

        const updatedComment = await prisma.teacherComment.update({
            where: { id: commentId },
            data: {
                status: 'approved',
                approvedBy: parseInt(req.user.id),
                approvedAt: new Date()
            }
        });

        res.json({ success: true, message: 'Comment approved', data: updatedComment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// PUT - Unapprove teacher comment
exports.unapproveComment = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const commentId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const updateResult = await prisma.teacherComment.updateMany({
            where: { ...tenantFilter, id: commentId },
            data: { 
                status: 'submitted', 
                approvedBy: null, // Equivalent to $unset
                approvedAt: null 
            }
        });

        if (updateResult.count === 0) return res.status(404).json({ success: false, message: 'Comment not found or failed to unapprove.' });

        const updatedComment = await prisma.teacherComment.findFirst({ where: { ...tenantFilter, id: commentId } });
        res.json({ success: true, message: 'Comment unapproved successfully', data: updatedComment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// POST - Bulk re-approve comments
exports.bulkReapproveComments = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) return res.status(400).json({ success: false, message: 'IDs array is required.' });
        
        const validIds = ids.filter(isValidId).map(id => parseInt(id));
        if (validIds.length === 0) return res.status(400).json({ success: false, message: 'No valid IDs provided.' });

        const result = await prisma.teacherComment.updateMany({
            where: { 
                ...getTenantFilter(req), 
                id: { in: validIds }, 
                status: { not: 'approved' } 
            },
            data: { 
                status: 'approved', 
                approvedBy: parseInt(req.user.id), 
                approvedAt: new Date() 
            }
        });

        res.json({ success: true, message: `Successfully re-approved ${result.count} comments`, data: { approved: result.count } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};