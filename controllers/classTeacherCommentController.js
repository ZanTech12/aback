const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to safely get Admin ID
const getAdminId = (req) => req.user.role === 'admin' ? parseInt(req.user.id) : parseInt(req.user.adminId);

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to fetch related Student, Class, and Teacher for an array of comments
const populateCommentRelations = async (comments) => {
    if (!comments || comments.length === 0) return [];

    const studentIds = [...new Set(comments.map(c => c.studentId).filter(Boolean))];
    const classIds = [...new Set(comments.map(c => c.classId).filter(Boolean))];
    const teacherIds = [...new Set(comments.map(c => c.teacherId).filter(Boolean))];

    const [students, classes, teachers] = await Promise.all([
        prisma.student.findMany({ where: { id: { in: studentIds } } }),
        prisma.class.findMany({ where: { id: { in: classIds } } }),
        prisma.teacher.findMany({ where: { id: { in: teacherIds } } })
    ]);

    const studentMap = new Map(students.map(s => [s.id, s]));
    const classMap = new Map(classes.map(c => [c.id, c]));
    const teacherMap = new Map(teachers.map(t => [t.id, t]));

    // Map back to snake_case to match Mongoose frontend expectations
    return comments.map(c => {
        const student = studentMap.get(c.studentId);
        const classData = classMap.get(c.classId);
        const teacher = teacherMap.get(c.teacherId);

        return {
            ...c,
            student_id: student ? { ...student, _id: student.id } : null,
            class_id: classData ? { ...classData, _id: classData.id } : null,
            teacher_id: teacher ? { ...teacher, _id: teacher.id } : null,
        };
    });
};

exports.getComments = async (req, res) => {
    try {
        const { classId, class_id, term, session, studentId, student_id, teacherId, teacher_id } = req.query;
        const query = { ...getTenantFilter(req), isActive: true };

        if ((classId || class_id) && isValidId(classId || class_id)) query.classId = parseInt(classId || class_id);
        if ((studentId || student_id) && isValidId(studentId || student_id)) query.studentId = parseInt(studentId || student_id);
        if ((teacherId || teacher_id) && isValidId(teacherId || teacher_id)) query.teacherId = parseInt(teacherId || teacher_id);
        
        if (term) query.term = term;
        if (session) query.session = session;

        if (req.user.role === 'teacher') query.teacherId = parseInt(req.user.id);

        const comments = await prisma.classTeacherComment.findMany({
            where: query,
            orderBy: { updatedAt: 'desc' }
        });

        const populatedComments = await populateCommentRelations(comments);

        res.json({ success: true, data: populatedComments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getCommentsByClass = async (req, res) => {
    try {
        const { classId } = req.params;
        const { term, session } = req.query;

        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        if (!isValidId(classId)) return res.status(400).json({ success: false, message: 'Invalid class ID format.' });
        const parsedClassId = parseInt(classId);

        const query = { ...getTenantFilter(req), classId: parsedClassId, isActive: true };
        if (req.user.role === 'teacher') query.teacherId = parseInt(req.user.id);
        if (term) query.term = term;
        if (session) query.session = session;

        const comments = await prisma.classTeacherComment.findMany({ where: query });

        let populatedComments = await populateCommentRelations(comments);

        // Sort manually by student lastName, then firstName
        populatedComments.sort((a, b) => {
            const sA = a.student_id?.lastName || '';
            const sB = b.student_id?.lastName || '';
            if (sA !== sB) return sA.localeCompare(sB);
            const fA = a.student_id?.firstName || '';
            const fB = b.student_id?.firstName || '';
            return fA.localeCompare(fB);
        });

        res.json({ success: true, data: populatedComments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getCommentsByStudent = async (req, res) => {
    try {
        const { studentId } = req.params;
        const { class_id, term, session } = req.query;
        
        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const parsedStudentId = parseInt(studentId);

        const query = { ...getTenantFilter(req), studentId: parsedStudentId, isActive: true };

        if (class_id && isValidId(class_id)) query.classId = parseInt(class_id);
        if (term) query.term = term;
        if (session) query.session = session;
        if (req.user.role === 'teacher') query.teacherId = parseInt(req.user.id);

        const comments = await prisma.classTeacherComment.findMany({
            where: query,
            orderBy: { createdAt: 'desc' }
        });

        const populatedComments = await populateCommentRelations(comments);

        res.json({ success: true, data: populatedComments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.createComment = async (req, res) => {
    try {
        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const { student_id, class_id, teacher_id, comment, term, session } = req.body;

        if (!student_id || !class_id || !comment || !term || !session) {
            return res.status(400).json({ success: false, message: 'Student, Class, Comment, Term, and Session are required.' });
        }

        if (!isValidId(student_id) || !isValidId(class_id)) {
            return res.status(400).json({ success: false, message: 'Invalid student or class ID format.' });
        }

        const parsedStudentId = parseInt(student_id);
        const parsedClassId = parseInt(class_id);
        const finalTeacherId = (teacher_id && isValidId(teacher_id)) ? parseInt(teacher_id) : parseInt(req.user.id);
        const adminId = getAdminId(req);

        if (req.user.role === 'teacher') {
            const classData = await prisma.class.findFirst({ where: { ...getTenantFilter(req), id: parsedClassId } });
            if (!classData) return res.status(404).json({ success: false, message: 'Class not found.' });
            if (classData.teacherId !== parseInt(req.user.id)) {
                return res.status(403).json({ success: false, message: 'Access denied. You are not the class teacher for this class.' });
            }
        }

        const student = await prisma.student.findFirst({ 
            where: { ...getTenantFilter(req), id: parsedStudentId, classId: parsedClassId } 
        });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found or not enrolled in this class.' });

        // Prisma upsert handles both create and update safely
        const savedComment = await prisma.classTeacherComment.upsert({
            where: { 
                adminId_studentId_classId_term_session: { 
                    adminId, studentId: parsedStudentId, classId: parsedClassId, term, session 
                } 
            },
            update: { 
                comment, 
                teacherId: finalTeacherId 
            },
            create: { 
                adminId, 
                studentId: parsedStudentId, 
                classId: parsedClassId, 
                teacherId: finalTeacherId, 
                comment, 
                term, 
                session 
            }
        });

        const [populatedComment] = await populateCommentRelations([savedComment]);
        const isUpdate = populatedComment.createdAt && populatedComment.updatedAt && populatedComment.createdAt.getTime() !== populatedComment.updatedAt.getTime();

        res.status(isUpdate ? 200 : 201).json({ 
            success: true, 
            message: `Comment ${isUpdate ? 'updated' : 'created'} successfully`, 
            data: populatedComment 
        });
    } catch (error) {
        if (error.code === 'P2002') return res.status(400).json({ success: false, message: 'Comment already exists for this student in this term and session.' });
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.updateComment = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid comment ID format.' });
        const commentId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const comment = await prisma.classTeacherComment.findFirst({ where: { ...tenantFilter, id: commentId } });
        if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

        if (req.user.role === 'teacher' && comment.teacherId !== parseInt(req.user.id)) {
            return res.status(403).json({ success: false, message: 'You can only update your own comments.' });
        }

        const { comment: newComment, term, session } = req.body;
        const dataToUpdate = {};
        if (newComment !== undefined) dataToUpdate.comment = newComment;
        if (term !== undefined) dataToUpdate.term = term;
        if (session !== undefined) dataToUpdate.session = session;

        const updatedComment = await prisma.classTeacherComment.update({
            where: { id: commentId },
            data: dataToUpdate
        });

        const [populatedComment] = await populateCommentRelations([updatedComment]);

        res.json({ success: true, message: 'Comment updated successfully', data: populatedComment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.deleteComment = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid comment ID format.' });
        const commentId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const comment = await prisma.classTeacherComment.findFirst({ where: { ...tenantFilter, id: commentId } });
        if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

        if (req.user.role === 'teacher' && comment.teacherId !== parseInt(req.user.id)) {
            return res.status(403).json({ success: false, message: 'You can only delete your own comments.' });
        }

        await prisma.classTeacherComment.update({
            where: { id: commentId },
            data: { isActive: false }
        });

        res.json({ success: true, message: 'Comment deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};