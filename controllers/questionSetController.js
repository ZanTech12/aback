const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to safely get Admin ID
const getAdminId = (req) => req.user.role === 'admin' ? parseInt(req.user.id) : parseInt(req.user.adminId);

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ==========================================================
// ✅ HTML SANITIZER for question text / options / explanations
// Whitelists only safe formatting tags (b, i, u, sub, sup, img…).
// Strips <script>, <style>, inline event handlers (onclick etc.)
// and any <img> that doesn't point at our own /uploads/ folder or
// isn't an inline base64 data-image — so malicious HTML can't
// inject XSS into students' browsers.
// ==========================================================
const sanitizeQuestionHtml = (html) => {
    if (typeof html !== 'string') return html;

    let clean = html;

    // 1. Strip <script> and <style> blocks entirely (with contents)
    clean = clean.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    clean = clean.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

    // 2. Strip ALL inline event handlers (onclick=, onerror=, onload=…)
    clean = clean.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

    // 3. Remove disallowed tags but KEEP their inner text (unwrap)
    const allowed = ['b', 'i', 'u', 'strong', 'em', 'sub', 'sup', 'br', 'p', 'span', 'img', 'div'];
    clean = clean.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, tag) => {
        return allowed.includes(tag.toLowerCase()) ? match : '';
    });

    // 4. ✅ UPDATED: Images — allow our own /uploads/ paths OR inline
    //    compressed base64 data-images (produced by the toolbar's
    //    canvas compression). Everything else is dropped.
    clean = clean.replace(/<img([^>]*)>/gi, (match, attrs) => {
        const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
        const src = srcMatch ? srcMatch[1] : '';
        const isLocalUpload = src.startsWith('/uploads/');
        const isDataImage = /^data:image\/(jpeg|png|gif|webp);base64,/.test(src);
        if (isLocalUpload || isDataImage) {
            return `<img src="${src}" alt="" style="max-width:100%;height:auto;" />`;
        }
        return ''; // drop external/foreign images
    });

    return clean;
};

// Apply the sanitizer to every question in the array
const sanitizeQuestions = (questions) => {
    if (!Array.isArray(questions)) return questions;
    return questions.map((q) => ({
        ...q,
        questionText: sanitizeQuestionHtml(q.questionText),
        options: Array.isArray(q.options)
            ? q.options.map((o) => (typeof o === 'string' ? sanitizeQuestionHtml(o) : o))
            : q.options,
        explanation: typeof q.explanation === 'string' ? sanitizeQuestionHtml(q.explanation) : q.explanation,
    }));
};

// Helper to fetch related Class, Subject, and Teacher for an array of question sets
const populateQuestionSetRelations = async (questionSets) => {
    if (!questionSets || questionSets.length === 0) return [];

    const classIds = [...new Set(questionSets.map(qs => qs.classId).filter(Boolean))];
    const subjectIds = [...new Set(questionSets.map(qs => qs.subjectId).filter(Boolean))];
    const teacherIds = [...new Set(questionSets.map(qs => qs.teacherId).filter(Boolean))];

    const [classes, subjects, teachers] = await Promise.all([
        prisma.class.findMany({ where: { id: { in: classIds } } }),
        prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
        prisma.teacher.findMany({ where: { id: { in: teacherIds } } })
    ]);

    const classMap = new Map(classes.map(c => [c.id, c]));
    const subjectMap = new Map(subjects.map(s => [s.id, s]));
    const teacherMap = new Map(teachers.map(t => [t.id, t]));

    // Map back to object structure to match Mongoose frontend expectations
    return questionSets.map(qs => ({
        ...qs,
        _id: qs.id,
        classId: qs.classId ? { ...classMap.get(qs.classId), _id: qs.classId } : null,
        subjectId: qs.subjectId ? { ...subjectMap.get(qs.subjectId), _id: qs.subjectId } : null,
        teacherId: qs.teacherId ? { ...teacherMap.get(qs.teacherId), _id: qs.teacherId } : null,
    }));
};

exports.getQuestionSets = async (req, res) => {
    try {
        const { classId, subjectId } = req.query;
        const query = { ...getTenantFilter(req), isActive: true };

        if (classId && isValidId(classId)) query.classId = parseInt(classId);
        if (subjectId && isValidId(subjectId)) query.subjectId = parseInt(subjectId);

        let questionSets;
        if (req.user.role === 'teacher') {
            const teacherId = parseInt(req.user.id);
            const teacherAssignments = await prisma.teacherAssignment.findMany({ 
                where: { ...getTenantFilter(req), teacherId, isActive: true } 
            });
            
            const assignmentConditions = teacherAssignments.map(a => ({ classId: a.classId, subjectId: a.subjectId }));
            
            const permissionQuery = {
                ...query,
                OR: [{ teacherId }, ...assignmentConditions]
            };

            if (assignmentConditions.length === 0) {
                permissionQuery.OR = [{ teacherId }];
            }

            questionSets = await prisma.questionSet.findMany({
                where: permissionQuery,
                orderBy: { createdAt: 'desc' }
            });
        } else {
            questionSets = await prisma.questionSet.findMany({
                where: query,
                orderBy: { createdAt: 'desc' }
            });
        }

        const populatedQuestionSets = await populateQuestionSetRelations(questionSets);
        res.json({ success: true, data: populatedQuestionSets });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.createQuestionSet = async (req, res) => {
    try {
        const { title, classId, subjectId, questions, teacherId } = req.body;
        if (!title || !classId || !subjectId || !questions || questions.length === 0) {
            return res.status(400).json({ success: false, message: 'Title, class, subject, and at least one question are required' });
        }

        if (!isValidId(classId) || !isValidId(subjectId)) {
            return res.status(400).json({ success: false, message: 'Invalid class or subject ID format.' });
        }

        const parsedClassId = parseInt(classId);
        const parsedSubjectId = parseInt(subjectId);
        const tenantFilter = getTenantFilter(req);

        let teacherIdToAssign;
        if (req.user.role === 'teacher') {
            teacherIdToAssign = parseInt(req.user.id);
            const hasAssignment = await prisma.teacherAssignment.findFirst({ 
                where: { ...tenantFilter, teacherId: teacherIdToAssign, classId: parsedClassId, subjectId: parsedSubjectId, isActive: true } 
            });
            if (!hasAssignment) return res.status(403).json({ success: false, message: 'Access denied. You are not assigned to this class and subject.' });
        } else {
            // ✅ FIX (patch 1): Validate the teacher actually exists in the Teacher table
            // instead of blindly using the admin's user id (which is not a Teacher row)
            const candidate = teacherId ? parseInt(teacherId) : parseInt(req.user.id);
            const existingTeacher = candidate && !isNaN(candidate)
                ? await prisma.teacher.findFirst({ where: { ...tenantFilter, id: candidate } })
                : null;

            if (existingTeacher) {
                teacherIdToAssign = existingTeacher.id;
            } else {
                // Fall back to the first teacher in the tenant
                const systemTeacher = await prisma.teacher.findFirst({ where: tenantFilter });
                if (!systemTeacher) {
                    return res.status(400).json({ success: false, message: 'No valid teacher found for this question set' });
                }
                teacherIdToAssign = systemTeacher.id;
            }
        }

        const newQuestionSet = await prisma.questionSet.create({
            data: {
                ...tenantFilter,
                title, 
                classId: parsedClassId, 
                subjectId: parsedSubjectId, 
                questions: sanitizeQuestions(questions), // ✅ sanitized before saving (incl. base64 images)
                teacherId: teacherIdToAssign 
            }
        });

        const [populatedQuestionSet] = await populateQuestionSetRelations([newQuestionSet]);

        res.status(201).json({ success: true, data: populatedQuestionSet });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Internal server error' });
    }
};

exports.updateQuestionSet = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const questionSetId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const questionSet = await prisma.questionSet.findFirst({ where: { ...tenantFilter, id: questionSetId } });
        if (!questionSet) return res.status(404).json({ success: false, message: 'Question set not found' });

        const { title, classId, subjectId, questions } = req.body;

        if (req.user.role === 'teacher') {
            const isCreator = questionSet.teacherId === parseInt(req.user.id);
            const hasAssignment = await prisma.teacherAssignment.findFirst({ 
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: questionSet.classId, subjectId: questionSet.subjectId, isActive: true } 
            });
            if (!isCreator && !hasAssignment) return res.status(403).json({ success: false, message: 'Access denied.' });

            // ✅ FIX (patch 2): Prevent a teacher from re-assigning the set to a
            // class+subject pair they are NOT assigned to (permission bypass)
            if (classId !== undefined || subjectId !== undefined) {
                const newClassId = classId !== undefined && isValidId(classId) ? parseInt(classId) : questionSet.classId;
                const newSubjectId = subjectId !== undefined && isValidId(subjectId) ? parseInt(subjectId) : questionSet.subjectId;

                const stillAssigned = await prisma.teacherAssignment.findFirst({
                    where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: newClassId, subjectId: newSubjectId, isActive: true }
                });
                if (!stillAssigned) {
                    return res.status(403).json({ success: false, message: 'You are not assigned to this class and subject.' });
                }
            }
        }

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (classId !== undefined && isValidId(classId)) updateData.classId = parseInt(classId);
        if (subjectId !== undefined && isValidId(subjectId)) updateData.subjectId = parseInt(subjectId);
        if (questions !== undefined) updateData.questions = sanitizeQuestions(questions); // ✅ sanitized before saving (incl. base64 images)

        const updatedQuestionSet = await prisma.questionSet.update({
            where: { id: questionSetId },
            data: updateData
        });

        const [populatedQuestionSet] = await populateQuestionSetRelations([updatedQuestionSet]);

        res.json({ success: true, message: 'Question set updated successfully', data: populatedQuestionSet });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Internal server error' });
    }
};

exports.deleteQuestionSet = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const questionSetId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const questionSet = await prisma.questionSet.findFirst({ where: { ...tenantFilter, id: questionSetId } });
        if (!questionSet) return res.status(404).json({ success: false, message: 'Question set not found' });

        if (req.user.role === 'teacher') {
            const isCreator = questionSet.teacherId === parseInt(req.user.id);
            const hasAssignment = await prisma.teacherAssignment.findFirst({ 
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: questionSet.classId, subjectId: questionSet.subjectId, isActive: true } 
            });
            if (!isCreator && !hasAssignment) return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        await prisma.questionSet.delete({ where: { id: questionSetId } });
        res.json({ success: true, message: 'Question set deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Internal server error' });
    }
};