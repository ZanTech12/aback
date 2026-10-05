const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to fetch related Class and Subject for an array of tests
const populateTestRelations = async (tests) => {
    if (!tests || tests.length === 0) return [];

    const classIds = [...new Set(tests.map(t => t.classId).filter(Boolean))];
    const subjectIds = [...new Set(tests.map(t => t.subjectId).filter(Boolean))];

    const [classes, subjects] = await Promise.all([
        prisma.class.findMany({ where: { id: { in: classIds } } }),
        prisma.subject.findMany({ where: { id: { in: subjectIds } } })
    ]);

    const classMap = new Map(classes.map(c => [c.id, c]));
    const subjectMap = new Map(subjects.map(s => [s.id, s]));

    return tests.map(t => ({
        ...t,
        classId: t.classId ? { ...classMap.get(t.classId), _id: t.classId } : null,
        subjectId: t.subjectId ? { ...subjectMap.get(t.subjectId), _id: t.subjectId } : null,
    }));
};

exports.getStudentTestResults = async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Access denied. Student role required.' });

        if (!isValidId(req.user.id)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });
        const studentId = parseInt(req.user.id);

        const student = await prisma.student.findFirst({ 
            where: { ...getTenantFilter(req), id: studentId, isDeleted: { not: true } }, 
            select: { testResults: true } 
        });
        
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const testResults = student.testResults || [];
        if (testResults.length === 0) return res.json({ success: true, data: [] });

        // Extract integer IDs from the JSON array
        const studentTestIds = testResults.map(r => parseInt(r.testId)).filter(isValidId);
        
        const publishedTests = await prisma.test.findMany({ 
            where: { ...getTenantFilter(req), id: { in: studentTestIds }, resultsPublished: true } 
        });

        if (publishedTests.length === 0) return res.json({ success: true, data: [] });

        const populatedTests = await populateTestRelations(publishedTests);
        const publishedTestData = new Map(populatedTests.map(test => [test.id, test]));
        
        const detailedResults = testResults
            .filter(result => publishedTestData.has(parseInt(result.testId)))
            .map(result => ({ 
                ...result, 
                test: publishedTestData.get(parseInt(result.testId)) 
            }));

        res.json({ success: true, data: detailedResults, resultSchedule: req.resultSchedule || null });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getStudentTestSchedule = async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Access denied. Student role required.' });

        if (!isValidId(req.user.id)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });
        const studentId = parseInt(req.user.id);

        const student = await prisma.student.findFirst({ 
            where: { ...getTenantFilter(req), id: studentId, isDeleted: { not: true } } 
        });
        
        if (!student || !student.classId) return res.status(404).json({ success: false, message: 'Student class not found' });

        const allTests = await prisma.test.findMany({ 
            where: { ...getTenantFilter(req), classId: student.classId }, 
            orderBy: { startDate: 'asc' } 
        });

        const populatedTests = await populateTestRelations(allTests);
        const now = new Date();
        const testResults = student.testResults || [];
        
        const processedTests = populatedTests.map(test => {
            const startDate = new Date(test.startDate);
            const endDate = new Date(test.endDate);
            let status, statusText, timeRemaining = '';

            if (now < startDate) {
                status = 'upcoming'; statusText = 'Upcoming';
                const diff = startDate - now;
                const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                timeRemaining = days > 0 ? `Starts in ${days} day(s)` : `Starts in ${hours} hour(s)`;
            } else if (now >= startDate && now <= endDate) {
                status = 'active'; statusText = 'Available Now';
                const diff = endDate - now;
                const hours = Math.floor(diff / (1000 * 60 * 60));
                timeRemaining = `${hours} hour(s) remaining`;
            } else {
                status = 'expired'; statusText = 'Expired';
                timeRemaining = 'Ended';
            }

            // Compare testId inside JSON array safely
            const hasTakenTest = testResults.some(result => parseInt(result.testId) === test.id);
            return { 
                ...test, 
                _id: test.id, // Map _id for frontend
                status, statusText, timeRemaining, hasTakenTest, 
                canTake: status === 'active' && !hasTakenTest 
            };
        });

        res.json({ success: true, data: processedTests });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getStudentAllTests = async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Access denied. Student role required.' });

        if (!isValidId(req.user.id)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });
        const studentId = parseInt(req.user.id);

        const student = await prisma.student.findFirst({ 
            where: { ...getTenantFilter(req), id: studentId, isDeleted: { not: true } } 
        });
        
        if (!student || !student.classId) return res.status(404).json({ success: false, message: 'Student class not found' });

        const tests = await prisma.test.findMany({ 
            where: { ...getTenantFilter(req), classId: student.classId }, 
            orderBy: { startDate: 'asc' } 
        });

        const populatedTests = await populateTestRelations(tests);
        const now = new Date();
        const testResults = student.testResults || [];
        
        const processedTests = populatedTests.map(test => {
            const startDate = new Date(test.startDate);
            const endDate = new Date(test.endDate);
            let status = now < startDate ? 'upcoming' : (now <= endDate ? 'active' : 'expired');
            const hasTakenTest = testResults.some(result => parseInt(result.testId) === test.id);
            return { 
                ...test, 
                _id: test.id, // Map _id for frontend
                status, hasTakenTest 
            };
        });

        res.json({ success: true, data: processedTests });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};