const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ✅ Safe date conversion
const toDateOrNull = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
};

// Helper to populate relations (teacher fetch uses select — no password hashes)
const populateTestRelations = async (tests) => {
    if (!tests || tests.length === 0) return [];
    const testArray = Array.isArray(tests) ? tests : [tests];

    const classIds = [...new Set(testArray.map(t => t.classId).filter(Boolean))];
    const subjectIds = [...new Set(testArray.map(t => t.subjectId).filter(Boolean))];
    const creatorIds = [...new Set(testArray.map(t => t.createdById).filter(Boolean))];

    const [classes, subjects, teachers] = await Promise.all([
        prisma.class.findMany({ where: { id: { in: classIds } } }),
        prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
        prisma.teacher.findMany({
            where: { id: { in: creatorIds } },
            select: {
                id: true, adminId: true, firstName: true, lastName: true,
                email: true, phone: true, qualification: true, experience: true, subjects: true
            }
        })
    ]);

    const classMap = new Map(classes.map(c => [c.id, c]));
    const subjectMap = new Map(subjects.map(s => [s.id, s]));
    const teacherMap = new Map(teachers.map(t => [t.id, t]));

    const mapped = testArray.map(t => ({
        ...t,
        _id: t.id,
        classId: t.classId ? { ...classMap.get(t.classId), _id: t.classId } : null,
        subjectId: t.subjectId ? { ...subjectMap.get(t.subjectId), _id: t.subjectId } : null,
        createdBy: t.createdById ? { ...teacherMap.get(t.createdById), _id: t.createdById } : null,
    }));

    return Array.isArray(tests) ? mapped : mapped[0];
};

// For admins — createdById must be a real Teacher row id
const resolveCreatorTeacherId = async (req, tenantFilter, requestedTeacherId) => {
    if (req.user.role === 'teacher') return parseInt(req.user.id);
    const candidate = isValidId(requestedTeacherId) ? parseInt(requestedTeacherId) : null;
    let teacherRow = candidate
        ? await prisma.teacher.findFirst({ where: { ...tenantFilter, id: candidate } })
        : null;
    if (!teacherRow) teacherRow = await prisma.teacher.findFirst({ where: tenantFilter });
    return teacherRow ? teacherRow.id : null;
};

// ==================== CREATE ====================
exports.createTest = async (req, res) => {
    try {
        const { title, classId, subjectId, duration, startDate, endDate, passMark, instructions, questions, teacherId } = req.body;
        const tenantFilter = getTenantFilter(req);

        if (!title || !String(title).trim()) return res.status(400).json({ success: false, message: 'Title is required' });
        if (!isValidId(classId) || !isValidId(subjectId)) return res.status(400).json({ success: false, message: 'Invalid class or subject ID format.' });

        const start = toDateOrNull(startDate);
        const end = toDateOrNull(endDate);
        if (!start || !end) return res.status(400).json({ success: false, message: 'Valid start and end dates are required' });
        if (end <= start) return res.status(400).json({ success: false, message: 'End date must be after the start date' });

        const parsedClassId = parseInt(classId);
        const parsedSubjectId = parseInt(subjectId);

        if (req.user.role === 'teacher') {
            const hasAssignment = await prisma.teacherAssignment.findFirst({
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: parsedClassId, subjectId: parsedSubjectId, isActive: true }
            });
            if (!hasAssignment) return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const creatorTeacherId = await resolveCreatorTeacherId(req, tenantFilter, teacherId);
        if (!creatorTeacherId) return res.status(400).json({ success: false, message: 'No valid teacher found to attribute this test to' });

        const createData = {
            ...tenantFilter,
            title: String(title).trim(),
            classId: parsedClassId,
            subjectId: parsedSubjectId,
            duration: isValidId(duration) ? parseInt(duration) : 60,
            startDate: start,
            endDate: end,
            passMark: isValidId(passMark) ? parseInt(passMark) : 50,
            questions: Array.isArray(questions) ? questions : [],
            createdById: creatorTeacherId,
        };
        if (typeof instructions === 'string') createData.instructions = instructions;

        const newTest = await prisma.test.create({ data: createData });
        const populatedTest = await populateTestRelations(newTest);
        res.status(201).json({ success: true, message: 'Test created successfully', data: populatedTest });
    } catch (error) {
        console.error('createTest error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ==================== READ ====================
exports.getTests = async (req, res) => {
    try {
        const { classId, subjectId } = req.query;
        const query = { ...getTenantFilter(req), isActive: true };
        if (classId && isValidId(classId)) query.classId = parseInt(classId);
        if (subjectId && isValidId(subjectId)) query.subjectId = parseInt(subjectId);

        let tests;
        if (req.user.role === 'teacher') {
            const teacherId = parseInt(req.user.id);
            const assignments = await prisma.teacherAssignment.findMany({
                where: { ...getTenantFilter(req), teacherId, isActive: true }
            });
            const orConditions = assignments.map(a => ({ classId: a.classId, subjectId: a.subjectId }));
            tests = await prisma.test.findMany({ where: { ...query, OR: [{ createdById: teacherId }, ...orConditions] }, orderBy: { createdAt: 'desc' } });
        } else {
            tests = await prisma.test.findMany({ where: query, orderBy: { createdAt: 'desc' } });
        }
        res.json({ success: true, data: await populateTestRelations(tests) });
    } catch (error) {
        console.error('getTests error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getAllTests = async (req, res) => {
    try {
        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin or Teacher role required.' });
        }
        const tenantFilter = getTenantFilter(req);

        if (req.user.role === 'teacher') {
            const assignments = await prisma.teacherAssignment.findMany({ where: { ...tenantFilter, teacherId: parseInt(req.user.id), isActive: true } });
            const orConditions = assignments.map(a => ({ classId: a.classId, subjectId: a.subjectId }));
            const query = { ...tenantFilter, isActive: true, OR: [{ createdById: parseInt(req.user.id) }, ...orConditions] };
            if (orConditions.length === 0) query.OR = [{ createdById: parseInt(req.user.id) }];
            const tests = await prisma.test.findMany({ where: query, orderBy: { createdAt: 'desc' } });
            return res.json({ success: true, data: await populateTestRelations(tests) });
        }

        const tests = await prisma.test.findMany({ where: tenantFilter, orderBy: { createdAt: 'desc' } });
        res.json({ success: true, data: await populateTestRelations(tests) });
    } catch (error) {
        console.error('getAllTests error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getTestsByTeacher = async (req, res) => {
    try {
        if (req.user.role === 'teacher' && parseInt(req.user.id) !== parseInt(req.params.teacherId)) {
            return res.status(403).json({ success: false, message: 'Not authorized to view these tests' });
        }
        if (!isValidId(req.params.teacherId)) return res.status(400).json({ success: false, message: 'Invalid teacher ID format.' });
        const teacherId = parseInt(req.params.teacherId);
        const tenantFilter = getTenantFilter(req);

        const assignments = await prisma.teacherAssignment.findMany({ where: { ...tenantFilter, teacherId, isActive: true } });
        const orConditions = assignments.map(a => ({ classId: a.classId, subjectId: a.subjectId }));
        const query = { ...tenantFilter, isActive: true, OR: [{ createdById: teacherId }, ...orConditions] };
        if (orConditions.length === 0) query.OR = [{ createdById: teacherId }];

        const tests = await prisma.test.findMany({ where: query, orderBy: { createdAt: 'desc' } });
        res.json({ success: true, data: await populateTestRelations(tests) });
    } catch (error) {
        console.error('getTestsByTeacher error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getTestById = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid test ID format.' });
        const testId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: testId } });
        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        if (req.user.role === 'teacher') {
            const isAssigned = await prisma.teacherAssignment.findFirst({
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: test.classId, subjectId: test.subjectId, isActive: true }
            });
            const isCreator = test.createdById === parseInt(req.user.id);
            if (!isAssigned && !isCreator) return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        res.json({ success: true, data: await populateTestRelations(test) });
    } catch (error) {
        console.error('getTestById error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ==================== UPDATE / DELETE ====================
exports.updateTest = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid test ID format.' });
        const testId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: testId } });
        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        const { title, classId, subjectId, duration, startDate, endDate, passMark, instructions, questions } = req.body;

        if (req.user.role === 'teacher') {
            const isAssigned = await prisma.teacherAssignment.findFirst({
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: test.classId, subjectId: test.subjectId, isActive: true }
            });
            const isCreator = test.createdById === parseInt(req.user.id);
            if (!isAssigned && !isCreator) return res.status(403).json({ success: false, message: 'Access denied.' });

            if (classId !== undefined || subjectId !== undefined) {
                const newClassId = isValidId(classId) ? parseInt(classId) : test.classId;
                const newSubjectId = isValidId(subjectId) ? parseInt(subjectId) : test.subjectId;
                const stillAssigned = await prisma.teacherAssignment.findFirst({
                    where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: newClassId, subjectId: newSubjectId, isActive: true }
                });
                if (!stillAssigned) return res.status(403).json({ success: false, message: 'You are not assigned to this class and subject' });
            }
        }

        const updateData = {};
        if (title !== undefined) updateData.title = String(title).trim();
        if (isValidId(classId)) updateData.classId = parseInt(classId);
        if (isValidId(subjectId)) updateData.subjectId = parseInt(subjectId);
        if (isValidId(duration)) updateData.duration = parseInt(duration);
        if (isValidId(passMark)) updateData.passMark = parseInt(passMark);
        if (startDate !== undefined) { const s = toDateOrNull(startDate); if (!s) return res.status(400).json({ success: false, message: 'Invalid start date format' }); updateData.startDate = s; }
        if (endDate !== undefined) { const e = toDateOrNull(endDate); if (!e) return res.status(400).json({ success: false, message: 'Invalid end date format' }); updateData.endDate = e; }
        if (Array.isArray(questions)) updateData.questions = questions;
        if (typeof instructions === 'string') updateData.instructions = instructions;

        if (Object.keys(updateData).length === 0) return res.status(400).json({ success: false, message: 'No valid fields provided to update' });

        const updated = await prisma.test.update({ where: { id: testId }, data: updateData });
        res.json({ success: true, message: 'Test updated successfully', data: await populateTestRelations(updated) });
    } catch (error) {
        console.error('updateTest error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.deleteTest = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid test ID format.' });
        const testId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: testId } });
        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        if (req.user.role === 'teacher') {
            const isAssigned = await prisma.teacherAssignment.findFirst({
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: test.classId, subjectId: test.subjectId, isActive: true }
            });
            const isCreator = test.createdById === parseInt(req.user.id);
            if (!isAssigned && !isCreator) return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        await prisma.test.update({ where: { id: testId }, data: { isActive: false } });
        res.json({ success: true, message: 'Test deleted successfully' });
    } catch (error) {
        console.error('deleteTest error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ==================== PUBLISH / UNPUBLISH ====================
exports.publishResults = async (req, res) => {
    try {
        if (!isValidId(req.params.testId)) return res.status(400).json({ success: false, message: 'Invalid test ID format.' });
        const testId = parseInt(req.params.testId);
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: testId } });
        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        if (req.user.role === 'teacher') {
            const isAssigned = await prisma.teacherAssignment.findFirst({
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: test.classId, subjectId: test.subjectId, isActive: true }
            });
            const isCreator = test.createdById === parseInt(req.user.id);
            if (!isAssigned && !isCreator) return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const updated = await prisma.test.update({ where: { id: testId }, data: { resultsPublished: true, publishedAt: new Date() } });
        res.json({ success: true, message: 'Test results have been published successfully.', data: { testId: updated.id, testTitle: updated.title, resultsPublished: updated.resultsPublished, publishedAt: updated.publishedAt } });
    } catch (error) {
        console.error('publishResults error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.unpublishResults = async (req, res) => {
    try {
        if (!isValidId(req.params.testId)) return res.status(400).json({ success: false, message: 'Invalid test ID format.' });
        const testId = parseInt(req.params.testId);
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: testId } });
        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        if (req.user.role === 'teacher') {
            const isAssigned = await prisma.teacherAssignment.findFirst({
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: test.classId, subjectId: test.subjectId, isActive: true }
            });
            const isCreator = test.createdById === parseInt(req.user.id);
            if (!isAssigned && !isCreator) return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const updated = await prisma.test.update({ where: { id: testId }, data: { resultsPublished: false, publishedAt: null } });
        res.json({ success: true, message: 'Test results have been unpublished successfully.', data: { testId: updated.id, testTitle: updated.title, resultsPublished: updated.resultsPublished } });
    } catch (error) {
        console.error('unpublishResults error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ==================== STUDENT TEST ROUTES ====================

exports.getStudentTests = async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Access denied. Student role required.' });
        const tenantFilter = getTenantFilter(req);
        if (!isValidId(req.user.id)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });
        const studentId = parseInt(req.user.id);

        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: studentId, isDeleted: { not: true } } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
        if (!student.classId) return res.status(404).json({ success: false, message: 'Student class not found' });

        const now = new Date();
        const tests = await prisma.test.findMany({
            where: { ...tenantFilter, classId: student.classId, isActive: true, startDate: { lte: now }, endDate: { gte: now } },
            select: { id: true, title: true, classId: true, subjectId: true, createdById: true, duration: true, startDate: true, endDate: true, passMark: true, instructions: true, resultsPublished: true },
            orderBy: { startDate: 'asc' }
        });

        const populatedTests = await populateTestRelations(tests);
        const testResults = (student.testResults && Array.isArray(student.testResults)) ? student.testResults : [];
        const processedTests = populatedTests.map(test => {
            const hasTakenTest = testResults.some(result => parseInt(result.testId) === test.id);
            return { ...test, hasTakenTest, canTake: !hasTakenTest };
        });
        res.json({ success: true, data: processedTests });
    } catch (error) {
        console.error('getStudentTests error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getStudentTestById = async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Access denied. Student role required.' });
        const tenantFilter = getTenantFilter(req);
        if (!isValidId(req.user.id) || !isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const studentId = parseInt(req.user.id);
        const testId = parseInt(req.params.id);

        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: studentId, isDeleted: { not: true } } });
        if (!student || !student.classId) return res.status(404).json({ success: false, message: 'Student class not found' });

        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: testId } });
        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        const now = new Date();
        if (test.classId !== student.classId || !test.isActive || test.startDate > now || test.endDate < now) {
            return res.status(403).json({ success: false, message: 'Test is not available' });
        }

        const testResults = (student.testResults && Array.isArray(student.testResults)) ? student.testResults : [];
        if (testResults.some(r => parseInt(r.testId) === testId)) {
            return res.status(403).json({ success: false, message: 'You have already taken this test' });
        }

        if (!test.questions || test.questions.length === 0) {
            const questionSet = await prisma.questionSet.findFirst({ where: { ...tenantFilter, classId: test.classId, subjectId: test.subjectId, isActive: true } });
            if (questionSet && questionSet.questions && questionSet.questions.length > 0) {
                await prisma.test.update({ where: { id: testId }, data: { questions: questionSet.questions } });
                test.questions = questionSet.questions;
            } else {
                return res.status(403).json({ success: false, message: 'This test has no questions available. Please contact your teacher.' });
            }
        }

        const populatedTest = await populateTestRelations(test);
        res.json({ success: true, data: populatedTest });
    } catch (error) {
        console.error('getStudentTestById error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.submitTest = async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Access denied. Student role required.' });
        const tenantFilter = getTenantFilter(req);
        const { answers } = req.body;
        if (!answers || !Array.isArray(answers)) return res.status(400).json({ success: false, message: 'Answers are required' });
        if (!isValidId(req.user.id) || !isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const studentId = parseInt(req.user.id);
        const testId = parseInt(req.params.id);

        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: studentId, isDeleted: { not: true } } });
        if (!student || !student.classId) return res.status(404).json({ success: false, message: 'Student not found' });

        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: testId } });
        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        const now = new Date();
        if (test.classId !== student.classId || !test.isActive || test.startDate > now || test.endDate < now) {
            return res.status(403).json({ success: false, message: 'Test is not available' });
        }

        const testResults = (student.testResults && Array.isArray(student.testResults)) ? student.testResults : [];
        if (testResults.some(r => parseInt(r.testId) === testId)) {
            return res.status(403).json({ success: false, message: 'You have already taken this test' });
        }

        let score = 0;
        const testQuestions = test.questions || [];
        const totalQuestions = testQuestions.length;
        for (let i = 0; i < testQuestions.length; i++) {
            if (answers[i] === testQuestions[i].correctAnswer) score++;
        }
        const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
        const passed = percentage >= test.passMark;

        testResults.push({ testId, score, totalQuestions, percentage, passed, date: new Date() });
        await prisma.student.update({ where: { id: studentId }, data: { testResults } });

        res.json({ success: true, message: 'Test submitted successfully', data: { score, totalQuestions, percentage, passed } });
    } catch (error) {
        console.error('submitTest error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};