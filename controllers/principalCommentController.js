const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

const getCommentForPercentage = (percentage, templates) => {
    const defaultTemplates = [
        { min: 90, max: 100, comment: 'An outstanding and brilliant performance.' },
        { min: 80, max: 89, comment: 'A very commendable performance.' },
        { min: 70, max: 79, comment: 'A good performance that shows understanding.' },
        { min: 60, max: 69, comment: 'A fair performance. Needs more effort.' },
        { min: 50, max: 59, comment: 'An average performance. Needs significant improvement.' },
        { min: 40, max: 49, comment: 'Below average performance. Requires extra attention.' },
        { min: 0, max: 39, comment: 'Very poor performance. Urgent intervention is needed.' }
    ];
    const activeTemplates = (templates && templates.length > 0) ? templates : defaultTemplates;
    return activeTemplates.find(t => percentage >= t.min && percentage <= t.max)?.comment || 'Performance needs review.';
};

// Updated helper to accept tenantFilter
const calculateStudentPercentage = async (studentId, termId, sessionId, tenantFilter) => {
    const caRecords = await prisma.continuousAssessment.findMany({ 
        where: { ...tenantFilter, studentId, termId, sessionId, status: 'approved' } 
    });
    
    if (caRecords && caRecords.length > 0) {
        return Math.round(caRecords.reduce((sum, ca) => sum + (ca.totalScore || 0), 0) / caRecords.length);
    }
    
    const student = await prisma.student.findUnique({ 
        where: { id: studentId }, 
        select: { testResults: true } 
    });
    
    if (student && student.testResults && student.testResults.length > 0) {
        return Math.round(student.testResults.reduce((sum, r) => sum + (r.percentage || 0), 0) / student.testResults.length);
    }
    return 0;
};

// Helper to populate relations
const populateCommentRelations = async (comments) => {
    if (!comments || comments.length === 0) return [];

    const studentIds = [...new Set(comments.map(c => c.studentId).filter(Boolean))];
    const termIds = [...new Set(comments.map(c => c.termId).filter(Boolean))];
    const sessionIds = [...new Set(comments.map(c => c.sessionId).filter(Boolean))];

    const [students, terms, sessions] = await Promise.all([
        prisma.student.findMany({ where: { id: { in: studentIds } } }),
        prisma.term.findMany({ where: { id: { in: termIds } } }),
        prisma.session.findMany({ where: { id: { in: sessionIds } } })
    ]);

    const studentMap = new Map(students.map(s => [s.id, s]));
    const termMap = new Map(terms.map(t => [t.id, t]));
    const sessionMap = new Map(sessions.map(s => [s.id, s]));

    return comments.map(c => ({
        ...c,
        studentId: c.studentId ? { ...studentMap.get(c.studentId), _id: c.studentId } : null,
        termId: c.termId ? { ...termMap.get(c.termId), _id: c.termId } : null,
        sessionId: c.sessionId ? { ...sessionMap.get(c.sessionId), _id: c.sessionId } : null,
    }));
};

exports.getPrincipalComments = async (req, res) => {
    try {
        const { termId, sessionId, studentId, classId } = req.query;
        
        const query = { ...getTenantFilter(req) };
        if (termId && isValidId(termId)) query.termId = parseInt(termId);
        if (sessionId && isValidId(sessionId)) query.sessionId = parseInt(sessionId);
        if (studentId && isValidId(studentId)) query.studentId = parseInt(studentId);

        const comments = await prisma.principalComment.findMany({
            where: query,
            orderBy: { createdAt: 'desc' }
        });

        const populatedComments = await populateCommentRelations(comments);

        let filteredComments = populatedComments;
        if (classId && isValidId(classId)) {
            const parsedClassId = parseInt(classId);
            filteredComments = populatedComments.filter(c => c.studentId?.classId === parsedClassId);
        }
        
        res.json({ success: true, data: filteredComments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.createPrincipalComment = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        
        const { studentId, termId, sessionId, comment, classTeacherComment, percentage } = req.body;
        const tenantFilter = getTenantFilter(req);

        if (!isValidId(studentId) || !isValidId(termId) || !isValidId(sessionId)) {
            return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        }

        const parsedStudentId = parseInt(studentId);
        const parsedTermId = parseInt(termId);
        const parsedSessionId = parseInt(sessionId);

        const savedComment = await prisma.principalComment.upsert({
            where: { 
                adminId_studentId_termId_sessionId: { 
                    adminId: tenantFilter.adminId, studentId: parsedStudentId, termId: parsedTermId, sessionId: parsedSessionId 
                } 
            },
            update: { 
                comment,
                classTeacherComment: classTeacherComment !== undefined ? classTeacherComment : undefined,
                percentage: percentage !== undefined ? percentage : undefined
            },
            create: { 
                ...tenantFilter,
                studentId: parsedStudentId, 
                termId: parsedTermId, 
                sessionId: parsedSessionId, 
                comment, 
                classTeacherComment: classTeacherComment || '', 
                percentage: percentage || 0 
            }
        });

        const [populatedComment] = await populateCommentRelations([savedComment]);

        res.status(201).json({ success: true, message: 'Comment saved successfully', data: populatedComment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.generatePrincipalComments = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        
        const { termId, sessionId, classId, commentTemplates } = req.body;
        const tenantFilter = getTenantFilter(req);

        if (!isValidId(termId) || !isValidId(sessionId)) {
            return res.status(400).json({ success: false, message: 'Invalid Term or Session ID format.' });
        }

        const parsedTermId = parseInt(termId);
        const parsedSessionId = parseInt(sessionId);

        const term = await prisma.term.findFirst({ where: { ...tenantFilter, id: parsedTermId } });
        const session = await prisma.session.findFirst({ where: { ...tenantFilter, id: parsedSessionId } });
        const termName = term?.name;
        const sessionName = session?.name;

        const studentQuery = { ...tenantFilter, isDeleted: { not: true } };
        if (classId && isValidId(classId)) studentQuery.classId = parseInt(classId);
        
        const students = await prisma.student.findMany({ where: studentQuery });

        const generatedComments = [];
        for (const student of students) {
            const percentage = await calculateStudentPercentage(student.id, parsedTermId, parsedSessionId, tenantFilter);
            const comment = getCommentForPercentage(percentage, commentTemplates);

            let classTeacherComment = '';
            if (student.classId && termName && sessionName) {
                const ctComment = await prisma.classTeacherComment.findFirst({ 
                    where: { ...tenantFilter, studentId: student.id, classId: student.classId, term: termName, session: sessionName, isActive: true } 
                });
                if (ctComment) classTeacherComment = ctComment.comment;
            }

            const savedComment = await prisma.principalComment.upsert({
                where: { 
                    adminId_studentId_termId_sessionId: { 
                        adminId: tenantFilter.adminId, studentId: student.id, termId: parsedTermId, sessionId: parsedSessionId 
                    } 
                },
                update: { 
                    comment, 
                    percentage,
                    classTeacherComment: classTeacherComment || undefined,
                    isActive: true 
                },
                create: { 
                    ...tenantFilter,
                    studentId: student.id, 
                    termId: parsedTermId, 
                    sessionId: parsedSessionId, 
                    classId: student.classId, 
                    comment, 
                    percentage, 
                    classTeacherComment 
                }
            });
            generatedComments.push(savedComment);
        }

        res.json({ success: true, data: generatedComments, message: `Generated comments for ${generatedComments.length} students` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.updatePrincipalComment = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const commentId = parseInt(req.params.id);

        const { comment } = req.body;
        
        // Verify ownership before updating
        const existing = await prisma.principalComment.findFirst({ 
            where: { ...getTenantFilter(req), id: commentId } 
        });
        
        if (!existing) return res.status(404).json({ success: false, message: 'Comment not found' });

        const updatedComment = await prisma.principalComment.update({
            where: { id: commentId },
            data: { comment }
        });

        res.json({ success: true, data: updatedComment, message: 'Comment updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update comment' });
    }
};

exports.deletePrincipalComment = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const commentId = parseInt(req.params.id);

        // Verify ownership before deleting
        const existing = await prisma.principalComment.findFirst({ 
            where: { ...getTenantFilter(req), id: commentId } 
        });

        if (!existing) return res.status(404).json({ success: false, message: 'Comment not found' });

        await prisma.principalComment.delete({ where: { id: commentId } });
        
        res.json({ success: true, message: 'Comment deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};