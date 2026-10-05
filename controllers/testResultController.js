const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to populate relations for an array of tests
const populateTestRelations = async (tests) => {
    if (!tests || tests.length === 0) return [];
    const testArray = Array.isArray(tests) ? tests : [tests];

    const classIds = [...new Set(testArray.map(t => t.classId).filter(Boolean))];
    const subjectIds = [...new Set(testArray.map(t => t.subjectId).filter(Boolean))];
    const creatorIds = [...new Set(testArray.map(t => t.createdById).filter(Boolean))];

    const [classes, subjects, teachers] = await Promise.all([
        prisma.class.findMany({ where: { id: { in: classIds } } }),
        prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
        prisma.teacher.findMany({ where: { id: { in: creatorIds } } })
    ]);

    const classMap = new Map(classes.map(c => [c.id, c]));
    const subjectMap = new Map(subjects.map(s => [s.id, s]));
    const teacherMap = new Map(teachers.map(t => [t.id, t]));

    const mapped = testArray.map(t => ({
        ...t,
        _id: t.id, // Map _id for frontend
        classId: t.classId ? { ...classMap.get(t.classId), _id: t.classId } : null,
        subjectId: t.subjectId ? { ...subjectMap.get(t.subjectId), _id: t.subjectId } : null,
        createdBy: t.createdById ? { ...teacherMap.get(t.createdById), _id: t.createdById } : null,
    }));

    return Array.isArray(tests) ? mapped : mapped[0];
};

exports.createTestResult = async (req, res) => {
    try {
        const { studentId, testId, score, totalQuestions, percentage, timeTaken } = req.body;
        
        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const parsedStudentId = parseInt(studentId);

        const student = await prisma.student.findFirst({ where: { ...getTenantFilter(req), id: parsedStudentId } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const testResults = student.testResults || [];
        testResults.push({ testId, score, totalQuestions, percentage, timeTaken, date: new Date() });
        
        await prisma.student.update({
            where: { id: parsedStudentId },
            data: { testResults }
        });

        res.json({ success: true, message: 'Test results saved successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getTestResults = async (req, res) => {
    try {
        const { testId, classId, subjectId, studentId, page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const tenantFilter = getTenantFilter(req);

        // Fetch students that have testResults
        const students = await prisma.student.findMany({ 
            where: { ...tenantFilter, NOT: { testResults: { equals: [] } } } 
        });

        const classIds = [...new Set(students.map(s => s.classId).filter(Boolean))];
        const classes = await prisma.class.findMany({ where: { id: { in: classIds } } });
        const classMap = new Map(classes.map(c => [c.id, c]));

        let allResults = [];
        students.forEach(student => {
            const testResults = student.testResults || [];
            testResults.forEach(result => {
                if (testId && String(result.testId) !== String(testId)) return;
                
                const classData = student.classId ? classMap.get(student.classId) : null;
                allResults.push({
                    studentId: student.id, 
                    studentName: `${student.firstName} ${student.lastName}`,
                    admissionNumber: student.admissionNumber, 
                    classId: student.classId,
                    className: classData ? classData.name : 'Unassigned', 
                    ...result 
                });
            });
        });

        const testIds = [...new Set(allResults.map(r => parseInt(r.testId)).filter(isValidId))];
        
        const tests = await prisma.test.findMany({ where: { ...tenantFilter, id: { in: testIds } } });
        const populatedTests = await populateTestRelations(tests);
        const testMap = {};
        populatedTests.forEach(test => { testMap[test.id] = test; });

        let filteredResults = allResults.filter(result => {
            const test = testMap[parseInt(result.testId)];
            if (!test) return false;
            if (classId && (!test.classId || test.classId._id !== parseInt(classId))) return false;
            if (subjectId && (!test.subjectId || test.subjectId._id !== parseInt(subjectId))) return false;
            
            result.testTitle = test.title;
            result.subjectId = test.subjectId ? test.subjectId._id : null;
            result.subjectName = test.subjectId ? test.subjectId.name : 'Unknown Subject';
            result.testClassId = test.classId ? test.classId._id : null;
            result.testClassName = test.classId ? test.classId.name : 'Unknown Class';
            result.resultsPublished = test.resultsPublished;
            return true;
        });

        filteredResults.sort((a, b) => new Date(b.date) - new Date(a.date));
        const total = filteredResults.length;
        const paginatedResults = filteredResults.slice(skip, skip + parseInt(limit));

        res.json({ success: true, data: paginatedResults, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getTestResultsByTest = async (req, res) => {
    try {
        const { testId } = req.params;
        if (!isValidId(testId)) return res.status(400).json({ success: false, message: 'Invalid test ID format.' });
        const parsedTestId = parseInt(testId);
        
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: parsedTestId } });
        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        // ✅ REPLACE with:
const populatedTest = await populateTestRelations(test);

        if (req.user.role === 'teacher') {
            const isAssigned = await prisma.teacherAssignment.findFirst({ 
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: test.classId, subjectId: test.subjectId, isActive: true } 
            });
            const isCreator = test.createdById === parseInt(req.user.id);
            if (!isAssigned && !isCreator) return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const students = await prisma.student.findMany({ 
            where: { ...tenantFilter, classId: test.classId, isDeleted: { not: true } } 
        });
        
        const results = [];
        let totalScore = 0, passedCount = 0, scores = [];

        students.forEach(student => {
            const testResults = student.testResults || [];
            const result = testResults.find(r => parseInt(r.testId) === parsedTestId);
            if (result) {
                totalScore += result.percentage; scores.push(result.percentage);
                if (result.passed) passedCount++;
                results.push({ 
                    studentId: student.id, studentName: `${student.firstName} ${student.lastName}`, 
                    admissionNumber: student.admissionNumber, score: result.score, totalQuestions: result.totalQuestions, 
                    percentage: result.percentage, passed: result.passed, dateTaken: result.date, timeTaken: result.timeTaken 
                });
            } else {
                results.push({ 
                    studentId: student.id, studentName: `${student.firstName} ${student.lastName}`, 
                    admissionNumber: student.admissionNumber, score: 0, totalQuestions: 0, percentage: 0, 
                    passed: false, dateTaken: null, timeTaken: 0, notTaken: true 
                });
            }
        });

        const averageScore = scores.length > 0 ? totalScore / scores.length : 0;
        const passRate = scores.length > 0 ? (passedCount / scores.length) * 100 : 0;
        
        const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
        scores.forEach(score => {
            if (score >= 90) gradeDistribution.A++; else if (score >= 80) gradeDistribution.B++;
            else if (score >= 70) gradeDistribution.C++; else if (score >= 60) gradeDistribution.D++;
            else gradeDistribution.F++;
        });

        res.json({ success: true, data: { 
            test: { testId: populatedTest.id, title: populatedTest.title, class: populatedTest.classId, subject: populatedTest.subjectId, passMark: test.passMark, resultsPublished: test.resultsPublished }, 
            results, 
            statistics: { 
                totalStudents: students.length, takenCount: scores.length, notTakenCount: students.length - scores.length, 
                averageScore: Math.round(averageScore * 100) / 100, passRate: Math.round(passRate * 100) / 100, 
                highestScore: scores.length > 0 ? Math.max(...scores) : 0, lowestScore: scores.length > 0 ? Math.min(...scores) : 0, 
                gradeDistribution 
            } 
        }});
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getTestResultsByClass = async (req, res) => {
    try {
        const { classId } = req.params;
        const { subjectId } = req.query;
        if (!isValidId(classId)) return res.status(400).json({ success: false, message: 'Invalid class ID format.' });
        const parsedClassId = parseInt(classId);
        
        const tenantFilter = getTenantFilter(req);

        const classData = await prisma.class.findFirst({ where: { ...tenantFilter, id: parsedClassId } });
        if (!classData) return res.status(404).json({ success: false, message: 'Class not found' });

        if (req.user.role === 'teacher' && (!classData.teacherId || classData.teacherId !== parseInt(req.user.id))) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const testQuery = { ...tenantFilter, classId: parsedClassId };
        if (subjectId && isValidId(subjectId)) testQuery.subjectId = parseInt(subjectId);
        
        const tests = await prisma.test.findMany({ where: testQuery, orderBy: { startDate: 'desc' } });
        const populatedTests = await populateTestRelations(tests);
        
        const students = await prisma.student.findMany({ 
            where: { ...tenantFilter, classId: parsedClassId, isDeleted: { not: true } } 
        });

        const studentResultsByTest = {};
        populatedTests.forEach(test => {
            studentResultsByTest[test.id] = { 
                testId: test.id, testTitle: test.title, 
                subjectId: test.subjectId ? test.subjectId._id : null, 
                subjectName: test.subjectId ? test.subjectId.name : 'Unknown', 
                resultsPublished: test.resultsPublished, results: [] 
            };
        });

        students.forEach(student => {
            const testResults = student.testResults || [];
            testResults.forEach(result => {
                const testId = parseInt(result.testId);
                if (studentResultsByTest[testId]) {
                    studentResultsByTest[testId].results.push({ 
                        studentId: student.id, studentName: `${student.firstName} ${student.lastName}`, 
                        admissionNumber: student.admissionNumber, score: result.score, percentage: result.percentage, passed: result.passed 
                    });
                }
            });
        });

        res.json({ success: true, data: { class: { ...classData, _id: classData.id }, testResults: Object.values(studentResultsByTest) } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getTestResultsByStudent = async (req, res) => {
    try {
        const { studentId } = req.params;
        if (req.user.role === 'student' && parseInt(req.user.id) !== parseInt(studentId)) return res.status(403).json({ success: false, message: 'Access denied.' });
        
        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const parsedStudentId = parseInt(studentId);
        
        const tenantFilter = getTenantFilter(req);

        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: parsedStudentId } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        let classData = null;
        if (student.classId) {
            classData = await prisma.class.findUnique({ where: { id: student.classId } });
        }

        const testResults = student.testResults || [];
        const testIds = testResults.map(r => parseInt(r.testId)).filter(isValidId);
        
        const tests = await prisma.test.findMany({ where: { ...tenantFilter, id: { in: testIds } } });
        const populatedTests = await populateTestRelations(tests);
        const testMap = {}; 
        populatedTests.forEach(test => { testMap[test.id] = test; });

        const results = testResults.map(result => {
            const test = testMap[parseInt(result.testId)];
            return { 
                testId: result.testId, testTitle: test ? test.title : 'Unknown Test', 
                subjectName: test && test.subjectId ? test.subjectId.name : 'Unknown', 
                className: test && test.classId ? test.classId.name : 'Unknown', 
                score: result.score, percentage: result.percentage, passed: result.passed, dateTaken: result.date 
            };
        });

        res.json({ success: true, data: { 
            student: { studentId: student.id, firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber, class: classData ? { ...classData, _id: classData.id } : null }, 
            results 
        }});
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.exportTestResults = async (req, res) => {
    try {
        const { testId } = req.params;
        if (!isValidId(testId)) return res.status(400).json({ success: false, message: 'Invalid test ID format.' });
        const parsedTestId = parseInt(testId);
        
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: parsedTestId } });
        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        if (req.user.role === 'teacher' && (!test.createdById || test.createdById !== parseInt(req.user.id))) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const students = await prisma.student.findMany({ 
            where: { ...tenantFilter, classId: test.classId, isDeleted: { not: true } } 
        });
        
        const results = students.map(student => {
            const testResults = student.testResults || [];
            const result = testResults.find(r => parseInt(r.testId) === parsedTestId);
            return result ? { 
                'Admission Number': student.admissionNumber, 'Student Name': `${student.firstName} ${student.lastName}`, 
                'Score': result.score, 'Percentage': `${result.percentage}%`, 'Passed': result.passed ? 'Yes' : 'No' 
            } : { 
                'Admission Number': student.admissionNumber, 'Student Name': `${student.firstName} ${student.lastName}`, 
                'Score': 0, 'Percentage': '0%', 'Passed': 'No' 
            };
        });

        const csv = [Object.keys(results[0]).join(','), ...results.map(r => Object.values(r).map(v => `"${v}"`).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${test.title.replace(/[^a-z0-9]/gi, '_')}_results.csv"`);
        res.send(csv);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.deleteTestResult = async (req, res) => {
    try {
        const { studentId, testId } = req.params;
        if (!isValidId(studentId) || !isValidId(testId)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        
        const parsedStudentId = parseInt(studentId);
        const parsedTestId = parseInt(testId);
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({ where: { ...tenantFilter, id: parsedTestId } });
        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        if (req.user.role === 'teacher' && (!test.createdById || test.createdById !== parseInt(req.user.id))) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: parsedStudentId } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const testResults = student.testResults || [];
        const testResultIndex = testResults.findIndex(result => parseInt(result.testId) === parsedTestId);
        if (testResultIndex === -1) return res.status(404).json({ success: false, message: 'Test result not found' });

        testResults.splice(testResultIndex, 1);
        
        await prisma.student.update({
            where: { id: parsedStudentId },
            data: { testResults }
        });
        
        res.json({ success: true, message: 'Test result deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.deleteAllStudentResults = async (req, res) => {
    try {
        const { studentId } = req.params;
        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const parsedStudentId = parseInt(studentId);
        
        const student = await prisma.student.findFirst({ where: { ...getTenantFilter(req), id: parsedStudentId } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const testResults = student.testResults || [];
        const resultsCount = testResults.length;
        if (resultsCount === 0) return res.status(404).json({ success: false, message: 'No test results found' });

        await prisma.student.update({
            where: { id: parsedStudentId },
            data: { testResults: [] }
        });
        
        res.json({ success: true, message: `Deleted ${resultsCount} test results` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.deleteAllSystemResults = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        const tenantFilter = getTenantFilter(req);

        const students = await prisma.student.findMany({ where: tenantFilter });
        let totalResultsToDelete = 0;
        students.forEach(student => { totalResultsToDelete += (student.testResults || []).length; });

        if (totalResultsToDelete === 0) return res.status(404).json({ success: false, message: 'No test results found' });

        await prisma.student.updateMany({ 
            where: tenantFilter, 
            data: { testResults: [] } 
        });
        
        res.json({ success: true, message: `Deleted ${totalResultsToDelete} test results from the system` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};