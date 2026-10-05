const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ===================================================================
// *** COUNT ENDPOINTS ***
// ===================================================================
exports.getTeachersCount = async (req, res) => {
    try {
        const count = await prisma.teacher.count({ where: getTenantFilter(req) });
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getStudentsCount = async (req, res) => {
    try {
        const count = await prisma.student.count({ 
            where: { ...getTenantFilter(req), isDeleted: { not: true } } 
        });
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getClassesCount = async (req, res) => {
    try {
        const count = await prisma.class.count({ 
            where: { ...getTenantFilter(req), isActive: true } 
        });
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getSubjectsCount = async (req, res) => {
    try {
        const count = await prisma.subject.count({ where: getTenantFilter(req) });
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getQuestionsCount = async (req, res) => {
    try {
        const count = await prisma.question.count({ where: getTenantFilter(req) });
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getTestsCount = async (req, res) => {
    try {
        const count = await prisma.test.count({ 
            where: { ...getTenantFilter(req), isActive: true } 
        });
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ===================================================================
// *** DASHBOARD STATS ***
// ===================================================================
exports.getDashboardStats = async (req, res) => {
    try {
        const tenantFilter = getTenantFilter(req);

        if (['admin', 'superadmin', 'teacher'].includes(req.user.role)) {
            const [
                teachersCount,
                studentsCount,
                classesCount,
                subjectsCount,
                questionsCount,
                testsCount
            ] = await Promise.all([
                prisma.teacher.count({ where: tenantFilter }),
                prisma.student.count({ where: { ...tenantFilter, isDeleted: { not: true } } }),
                prisma.class.count({ where: { ...tenantFilter, isActive: true } }),
                prisma.subject.count({ where: tenantFilter }),
                prisma.question.count({ where: tenantFilter }),
                prisma.test.count({ where: { ...tenantFilter, isActive: true } })
            ]);

            return res.json({
                success: true,
                data: {
                    teachers: teachersCount,
                    students: studentsCount,
                    classes: classesCount,
                    subjects: subjectsCount,
                    questions: questionsCount,
                    tests: testsCount
                }
            });
        }

        if (req.user.role === 'student') {
            if (!isValidId(req.user.id)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });
            
            const student = await prisma.student.findFirst({ 
                where: { ...tenantFilter, id: parseInt(req.user.id), isDeleted: { not: true } } 
            });
            
            if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

            const now = new Date();
            const availableTestsCount = await prisma.test.count({
                where: {
                    ...tenantFilter,
                    classId: student.classId || 0, // Fallback to 0 if null
                    isActive: true,
                    startDate: { lte: now },
                    endDate: { gte: now }
                }
            });

            const takenTestsCount = student.testResults ? student.testResults.length : 0;

            return res.json({
                success: true,
                data: {
                    availableTests: availableTestsCount,
                    takenTests: takenTestsCount,
                }
            });
        }

        res.json({ success: true, data: {} });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** LAST TEACHER LOGINS ***
// ===================================================================
exports.getTeacherLogins = async (req, res) => {
    try {
        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const teachers = await prisma.teacher.findMany({
            where: {
                ...getTenantFilter(req),
                NOT: { lastLogin: null } // Equivalent to $ne: null
            },
            orderBy: { lastLogin: 'desc' },
            take: 10
        });

        const formattedLogins = teachers.map(teacher => ({
            _id: teacher.id,
            name: `${teacher.firstName} ${teacher.lastName}`,
            firstName: teacher.firstName,
            lastName: teacher.lastName,
            email: teacher.email,
            lastLogin: teacher.lastLogin,
            device: teacher.lastLoginDevice || '',
            ip: teacher.lastLoginIP || ''
        }));

        res.json({ success: true, data: formattedLogins });

    } catch (error) {
        console.error('[TEACHER LOGINS] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** STUDENT DASHBOARD ***
// ===================================================================
exports.getStudentDashboard = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({ success: false, message: 'Access denied. Student role required.' });
        }

        if (!isValidId(req.user.id)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

        const tenantFilter = getTenantFilter(req);

        const student = await prisma.student.findFirst({ 
            where: { ...tenantFilter, id: parseInt(req.user.id), isDeleted: { not: true } } 
        });
        
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        // Fetch class data manually (replaces .populate('classId'))
        let classData = null;
        if (student.classId) {
            classData = await prisma.class.findUnique({ where: { id: student.classId } });
        }

        const now = new Date();
        const availableTests = await prisma.test.findMany({
            where: {
                ...tenantFilter,
                classId: student.classId || 0,
                isActive: true,
                startDate: { lte: now },
                endDate: { gte: now }
            },
            orderBy: { startDate: 'asc' }
        });

        // Fetch subjects for available tests (replaces .populate('subjectId'))
        const availableTestSubjectIds = availableTests.map(t => t.subjectId);
        const availableTestSubjects = await prisma.subject.findMany({ 
            where: { id: { in: availableTestSubjectIds } } 
        });
        const subjectMap = new Map(availableTestSubjects.map(s => [s.id, s]));

        const formattedAvailableTests = availableTests.map(t => ({
            ...t,
            subjectId: subjectMap.get(t.subjectId) || null
        }));

        // Process recent results from JSON array
        const testResults = student.testResults || [];
        const recentResults = [...testResults].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

        // Fetch tests for recent results
        const recentTestIds = recentResults.map(r => parseInt(r.testId)).filter(isValidId);
        const recentTests = await prisma.test.findMany({ where: { id: { in: recentTestIds } } });
        const recentTestMap = new Map(recentTests.map(t => [t.id, t]));

        // Fetch subjects for recent tests
        const recentTestSubjectIds = recentTests.map(t => t.subjectId);
        const recentSubjects = await prisma.subject.findMany({ where: { id: { in: recentTestSubjectIds } } });
        const recentSubjectMap = new Map(recentSubjects.map(s => [s.id, s]));

        const detailedResults = recentResults.map(result => {
            const test = recentTestMap.get(parseInt(result.testId));
            return {
                ...result,
                testTitle: test ? test.title : 'Unknown Test',
                subjectName: test && test.subjectId ? (recentSubjectMap.get(test.subjectId)?.name || 'Unknown Subject') : 'Unknown Subject'
            };
        });

        const totalTests = testResults.length;
        const averageScore = totalTests > 0
            ? Math.round(testResults.reduce((sum, result) => sum + result.percentage, 0) / totalTests)
            : 0;

        res.json({
            success: true,
            data: {
                student: {
                    _id: student.id,
                    firstName: student.firstName,
                    lastName: student.lastName,
                    admissionNumber: student.admissionNumber,
                    class: classData ? { ...classData, _id: classData.id } : null
                },
                availableTests: formattedAvailableTests,
                recentResults: detailedResults,
                stats: {
                    totalTests,
                    averageScore
                }
            }
        });
    } catch (error) {
        console.error('Error fetching student dashboard:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};