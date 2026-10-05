const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ===================================================================
// *** GET /debug/ca-entries - Check Continuous Assessment Entries ***
// ===================================================================
exports.getCAEntries = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Admin only.' });
        }

        const { teacherId, classId, subjectId, status } = req.query;
        const tenantFilter = getTenantFilter(req);

        // Get all terms and sessions for context
        const allTerms = await prisma.term.findMany({ 
            where: { ...tenantFilter, isActive: true }, 
            orderBy: { startDate: 'desc' } 
        });
        
        const allSessions = await prisma.session.findMany({ 
            where: { ...tenantFilter, isActive: true }, 
            orderBy: { name: 'desc' } 
        });
        
        const activeTerm = await prisma.term.findFirst({ 
            where: { ...tenantFilter, status: 'active', isActive: true } 
        });

        // Build query
        const query = { ...tenantFilter };
        if (teacherId && isValidId(teacherId)) query.teacherId = parseInt(teacherId);
        if (classId && isValidId(classId)) query.classId = parseInt(classId);
        if (subjectId && isValidId(subjectId)) query.subjectId = parseInt(subjectId);
        if (status) query.status = status;

        // Fetch all matching CA records to group in JS (fast and reliable for diagnostics)
        const caRecords = await prisma.continuousAssessment.findMany({
            where: query,
            orderBy: { updatedAt: 'desc' }
        });

        // Group by termId, sessionId, status
        const groupedMap = new Map();

        for (const ca of caRecords) {
            const key = `${ca.termId}-${ca.sessionId}-${ca.status}`;
            if (!groupedMap.has(key)) {
                groupedMap.set(key, {
                    termId: ca.termId,
                    sessionId: ca.sessionId,
                    status: ca.status,
                    count: 0,
                    uniqueSubjects: new Set(),
                    uniqueStudents: new Set(),
                    latestCreated: ca.createdAt,
                    latestUpdated: ca.updatedAt
                });
            }
            const entry = groupedMap.get(key);
            entry.count++;
            entry.uniqueSubjects.add(ca.subjectId);
            entry.uniqueStudents.add(ca.studentId);
            if (ca.createdAt > entry.latestCreated) entry.latestCreated = ca.createdAt;
            if (ca.updatedAt > entry.latestUpdated) entry.latestUpdated = ca.updatedAt;
        }

        // Enrich with term/session names
        const termIds = [...new Set([...groupedMap.values()].map(e => e.termId).filter(Boolean))];
        const sessionIds = [...new Set([...groupedMap.values()].map(e => e.sessionId).filter(Boolean))];
        
        const [terms, sessions] = await Promise.all([
            prisma.term.findMany({ where: { id: { in: termIds } } }),
            prisma.session.findMany({ where: { id: { in: sessionIds } } })
        ]);

        const termMap = new Map(terms.map(t => [t.id, t]));
        const sessionMap = new Map(sessions.map(s => [s.id, s]));

        const enrichedEntries = [...groupedMap.values()].map(entry => ({
            termId: entry.termId,
            sessionId: entry.sessionId,
            status: entry.status,
            termName: termMap.get(entry.termId)?.name || 'Unknown/Deleted',
            termStatus: termMap.get(entry.termId)?.status || 'N/A',
            sessionName: sessionMap.get(entry.sessionId)?.name || 'Unknown/Deleted',
            count: entry.count,
            uniqueSubjects: entry.uniqueSubjects.size,
            uniqueStudents: entry.uniqueStudents.size,
            latestCreated: entry.latestCreated,
            latestUpdated: entry.latestUpdated
        })).sort((a, b) => new Date(b.latestUpdated) - new Date(a.latestUpdated));

        // Get total counts by status
        const statusCountsAgg = await prisma.continuousAssessment.groupBy({
            by: ['status'],
            where: query,
            _count: { id: true }
        });

        const statusCounts = statusCountsAgg.reduce((acc, item) => {
            acc[item.status] = item._count.id;
            return acc;
        }, {});

        res.json({
            success: true,
            data: {
                activeTerm: activeTerm ? { id: activeTerm.id, name: activeTerm.name, status: activeTerm.status } : null,
                allTerms: allTerms.map(t => ({ ...t, _id: t.id })), // Map _id for frontend consistency
                allSessions: allSessions.map(s => ({ ...s, _id: s.id })),
                entriesByTermSession: enrichedEntries,
                statusCounts
            }
        });
    } catch (error) {
        console.error('[DEBUG CA ENTRIES] Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ===================================================================
// *** POST /student/tests/:testId/add-questions - Force Add Questions ***
// ===================================================================
exports.addQuestionsToTest = async (req, res) => {
    try {
        const { questions } = req.body;

        if (!questions || !Array.isArray(questions) || questions.length === 0) {
            return res.status(400).json({ success: false, message: 'A valid array of questions must be provided.' });
        }

        if (!isValidId(req.params.testId)) return res.status(400).json({ success: false, message: 'Invalid test ID format.' });
        const testId = parseInt(req.params.testId);

        const test = await prisma.test.findFirst({ 
            where: { ...getTenantFilter(req), id: testId } 
        });
        
        if (!test) return res.status(404).json({ success: false, message: 'Test not found.' });

        // In Prisma, we fetch the existing JSON array, merge, and save back
        const existingQuestions = test.questions || [];
        const updatedQuestions = [...existingQuestions, ...questions];

        const updatedTest = await prisma.test.update({
            where: { id: testId },
            data: { questions: updatedQuestions }
        });

        console.log(`[STUDENT ADD-QUESTIONS] Added ${questions.length} questions to test ${updatedTest.title}`);

        res.status(200).json({
            success: true,
            message: 'Questions added successfully.',
            data: updatedTest
        });
    } catch (error) {
        console.error('[STUDENT ADD-QUESTIONS] Error:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

// ===================================================================
// *** GET /diagnose/test-questions/:testId - Diagnose Test Questions ***
// ===================================================================
exports.diagnoseTestQuestions = async (req, res) => {
    try {
        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin or Teacher role required.' });
        }

        if (!isValidId(req.params.testId)) return res.status(400).json({ success: false, message: 'Invalid test ID format.' });
        const testId = parseInt(req.params.testId);
        const tenantFilter = getTenantFilter(req);
        
        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: testId } });

        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        const availableQuestions = await prisma.question.findMany({
            where: {
                ...tenantFilter,
                classId: test.classId,
                subjectId: test.subjectId
            }
        });

        // test.questions is a JSON array. We compare by questionText since JSON array items don't have DB IDs.
        const testQuestions = test.questions || [];
        const unlinkedQuestions = availableQuestions.filter(q =>
            !testQuestions.some(tq => tq.questionText === q.questionText)
        );

        const diagnosis = {
            testId: test.id,
            testTitle: test.title,
            linkedQuestionsCount: testQuestions.length,
            availableQuestionsCount: availableQuestions.length,
            unlinkedQuestionsCount: unlinkedQuestions.length,
            classId: test.classId,
            subjectId: test.subjectId,
            unlinkedQuestions: unlinkedQuestions.map(q => ({
                id: q.id,
                questionText: q.questionText.substring(0, 100) + '...'
            }))
        };

        res.json({ success: true, message: 'Diagnosis complete', data: diagnosis });
    } catch (error) {
        console.error('[DIAGNOSE-TEST-QUESTIONS] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** GET /diagnose/student-tests - Diagnose Student Test Availability ***
// ===================================================================
exports.diagnoseStudentTests = async (req, res) => {
    try {
        if (req.user.role !== 'student' || process.env.NODE_ENV === 'production') {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const tenantFilter = getTenantFilter(req);
        const studentId = parseInt(req.user.id);
        
        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: studentId } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

        let studentClass = null;
        if (student.classId) {
            studentClass = await prisma.class.findFirst({ where: { ...tenantFilter, id: student.classId } });
        }

        const now = new Date();
        const potentialTests = await prisma.test.findMany({
            where: {
                ...tenantFilter,
                isActive: true,
                startDate: { lte: now },
                endDate: { gte: now }
            }
        });

        // Fetch relations for tests
        const classIds = [...new Set(potentialTests.map(t => t.classId).filter(Boolean))];
        const subjectIds = [...new Set(potentialTests.map(t => t.subjectId).filter(Boolean))];
        const creatorIds = [...new Set(potentialTests.map(t => t.createdById).filter(Boolean))];

        const [classes, subjects, teachers] = await Promise.all([
            prisma.class.findMany({ where: { id: { in: classIds } } }),
            prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
            prisma.teacher.findMany({ where: { id: { in: creatorIds } } })
        ]);

        const classMap = new Map(classes.map(c => [c.id, c]));
        const subjectMap = new Map(subjects.map(s => [s.id, s]));
        const teacherMap = new Map(teachers.map(t => [t.id, t]));

        // Attach relations manually
        const populatedTests = potentialTests.map(t => ({
            ...t,
            classId: t.classId ? classMap.get(t.classId) || null : null,
            subjectId: t.subjectId ? subjectMap.get(t.subjectId) || null : null,
            createdById: t.createdById ? teacherMap.get(t.createdById) || null : null,
        }));

        const analysis = {
            studentId: student.id,
            studentName: `${student.firstName} ${student.lastName}`,
            studentClassId: student.classId,
            studentClassName: studentClass ? studentClass.name : 'Not Assigned',
            totalActiveTests: populatedTests.length,
            matchingTests: [],
            nonMatchingTests: []
        };

        for (const test of populatedTests) {
            const testClassId = test.classId?.id;
            if (test.classId && student.classId && testClassId === student.classId) {
                analysis.matchingTests.push({
                    testId: test.id,
                    testTitle: test.title,
                    classId: testClassId,
                    className: test.classId.name
                });
            } else {
                analysis.nonMatchingTests.push({
                    testId: test.id,
                    testTitle: test.title,
                    testClassId: testClassId || 'NULL',
                    testClassName: test.classId ? test.classId.name : 'No Class Assigned'
                });
            }
        }

        res.json({
            success: true,
            message: 'Diagnosis complete.',
            data: analysis
        });
    } catch (error) {
        console.error('[DIAGNOSIS] Error during diagnosis:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};