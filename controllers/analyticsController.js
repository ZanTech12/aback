const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

exports.getClassesResults = async (req, res) => {
    try {
        const tenantFilter = getTenantFilter(req);
        
        // 1. Fetch active classes
        const classes = await prisma.class.findMany({ 
            where: { ...tenantFilter, isActive: true } 
        });

        if (classes.length === 0) return res.json({ success: true, data: [] });

        // 2. Gather all subject and student IDs from the integer arrays on the classes
        const allSubjectIds = [...new Set(classes.flatMap(c => c.subjects))];
        const allStudentIds = [...new Set(classes.flatMap(c => c.students))];

        // 3. Fetch the actual subjects and students in parallel
        const [subjects, students] = await Promise.all([
            prisma.subject.findMany({ where: { id: { in: allSubjectIds }, isActive: true } }),
            prisma.student.findMany({ where: { id: { in: allStudentIds }, isActive: true, isDeleted: { not: true } } })
        ]);

        // 4. Create Maps for fast lookup
        const subjectMap = new Map(subjects.map(s => [s.id, s]));
        const studentMap = new Map(students.map(s => [s.id, s]));

        // 5. Process each class
        const results = await Promise.all(classes.map(async (classData) => {
            // Filter the global lists to only include students/subjects for THIS class
            const classStudents = classData.students.map(id => studentMap.get(id)).filter(Boolean);
            const classSubjects = classData.subjects.map(id => subjectMap.get(id)).filter(Boolean);

            const classResult = { 
                classId: classData.id, 
                className: classData.name, 
                totalStudents: classStudents.length, 
                subjects: [] 
            };

            for (const subject of classSubjects) {
                const tests = await prisma.test.findMany({ 
                    where: { ...tenantFilter, classId: classData.id, subjectId: subject.id, isActive: true } 
                });
                
                // Create a Set of stringified test IDs for safe comparison with JSON data
                const testIdStrings = new Set(tests.map(t => String(t.id)));
                
                let scores = []; 
                let passedCount = 0;

                for (const student of classStudents) {
                    // testResults is a JSON field. Default to empty array if null.
                    const studentResults = student.testResults || [];
                    const studentTests = studentResults.filter(r => testIdStrings.has(String(r.testId)));
                    
                    if (studentTests.length > 0) {
                        const avg = studentTests.reduce((sum, t) => sum + t.percentage, 0) / studentTests.length;
                        scores.push(avg);
                        passedCount += studentTests.filter(t => t.passed).length;
                    }
                }

                classResult.subjects.push({
                    subjectId: subject.id, 
                    subjectName: subject.name,
                    statistics: {
                        averageScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
                        passRate: scores.length > 0 ? Math.round((passedCount / scores.length) * 100) : 0,
                        highestScore: scores.length > 0 ? Math.max(...scores) : 0,
                        lowestScore: scores.length > 0 ? Math.min(...scores) : 0
                    }
                });
            }
            return classResult;
        }));

        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getStudentPerformance = async (req, res) => {
    try {
        const { studentId } = req.params;
        
        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const parsedStudentId = parseInt(studentId);

        if (req.user.role === 'student' && parseInt(req.user.id) !== parsedStudentId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // 1. Fetch student
        const student = await prisma.student.findFirst({ 
            where: { ...getTenantFilter(req), id: parsedStudentId } 
        });
            
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        // 2. Fetch class data if exists
        let classData = null;
        if (student.classId) {
            classData = await prisma.class.findUnique({ where: { id: student.classId } });
        }

        // 3. Extract test IDs from the student's JSON testResults
        const testResults = student.testResults || [];
        const testIds = [...new Set(testResults.map(r => parseInt(r.testId)).filter(isValidId))];

        // 4. Fetch the actual Tests, and then their Subjects
        const tests = await prisma.test.findMany({ where: { id: { in: testIds } } });
        const subjectIds = [...new Set(tests.map(t => t.subjectId))];
        const subjects = await prisma.subject.findMany({ where: { id: { in: subjectIds } } });

        const testMap = new Map(tests.map(t => [t.id, t]));
        const subjectMap = new Map(subjects.map(s => [s.id, s]));

        // 5. Group performance by subject
        const subjectPerformance = {};

        testResults.forEach(result => {
            const testId = parseInt(result.testId);
            const test = testMap.get(testId);
            
            if (test && test.subjectId) {
                const subjectId = test.subjectId;
                if (!subjectPerformance[subjectId]) {
                    const subjectData = subjectMap.get(subjectId);
                    subjectPerformance[subjectId] = { 
                        subjectName: subjectData?.name || 'Unknown', 
                        tests: [], 
                        summary: {} 
                    };
                }
                subjectPerformance[subjectId].tests.push({ 
                    testTitle: test.title, 
                    percentage: result.percentage, 
                    passed: result.passed 
                });
            }
        });

        // 6. Calculate summaries
        Object.keys(subjectPerformance).forEach(sId => {
            const subj = subjectPerformance[sId];
            const scores = subj.tests.map(t => t.percentage);
            subj.summary = {
                totalTests: subj.tests.length,
                averageScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
                passRate: scores.length > 0 ? Math.round((subj.tests.filter(t => t.passed).length / scores.length) * 100) : 0
            };
        });

        res.json({ 
            success: true, 
            data: { 
                student: { 
                    studentId: student.id, 
                    firstName: student.firstName, 
                    lastName: student.lastName, 
                    class: classData ? { name: classData.name, level: classData.level, section: classData.section } : null 
                }, 
                subjectPerformance: Object.values(subjectPerformance) 
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};