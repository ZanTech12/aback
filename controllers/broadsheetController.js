const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to resolve term/session securely with tenant filter
const resolveTermAndSessionSafe = async (req, termId, sessionId) => {
    const tenantFilter = getTenantFilter(req);
    let term = null;
    let session = null;

    if (termId && isValidId(termId)) {
        term = await prisma.term.findFirst({ where: { ...tenantFilter, id: parseInt(termId) } });
    }
    if (!term) {
        term = await prisma.term.findFirst({ where: { ...tenantFilter, status: 'active', isActive: true } });
    }
    if (!term) {
        term = await prisma.term.findFirst({ where: { ...tenantFilter, isActive: true }, orderBy: { startDate: 'desc' } });
    }

    if (sessionId && isValidId(sessionId)) {
        session = await prisma.session.findFirst({ where: { ...tenantFilter, id: parseInt(sessionId) } });
    }
    if (!session && term && term.sessionId) {
        session = await prisma.session.findFirst({ where: { ...tenantFilter, id: term.sessionId } });
    }
    if (!session) {
        session = await prisma.session.findFirst({ where: { ...tenantFilter, isActive: true }, orderBy: { name: 'desc' } });
    }

    return {
        term,
        session,
        termId: term ? term.id : null,
        sessionId: session ? session.id : null,
        termName: term ? term.name : null,
        sessionName: session ? session.name : null
    };
};

// GET - Class Teacher's assigned classes list
exports.getClassTeacherClasses = async (req, res) => {
    try {
        if (req.user.role !== 'teacher') return res.status(403).json({ success: false, message: 'Access denied.' });

        const { termId, sessionId } = req.query;
        const resolved = await resolveTermAndSessionSafe(req, termId, sessionId);
        if (!resolved.termId || !resolved.sessionId) return res.status(400).json({ success: false, message: 'No valid term or session found.' });

        const tenantFilter = getTenantFilter(req);
        const teacherId = parseInt(req.user.id);

        const classes = await prisma.class.findMany({ 
            where: { ...tenantFilter, teacherId: teacherId, isActive: true }, 
            orderBy: [{ level: 'asc' }, { section: 'asc' }, { name: 'asc' }] 
        });

        if (classes.length === 0) return res.json({ success: true, data: [], message: 'You are not assigned as a class teacher.' });

        const classList = await Promise.all(classes.map(async (cls) => {
            const studentCount = await prisma.student.count({ 
                where: { ...tenantFilter, classId: cls.id, isDeleted: { not: true } } 
            });
            
            const assessmentCount = await prisma.continuousAssessment.count({ 
                where: { ...tenantFilter, classId: cls.id, termId: resolved.termId, sessionId: resolved.sessionId, status: 'approved', isActive: true } 
            });
            
            const commentCount = await prisma.classTeacherComment.count({ 
                where: { ...tenantFilter, classId: cls.id, term: resolved.termName, session: resolved.sessionName, isActive: true } 
            });

            return {
                classId: cls.id, className: cls.name, classLevel: cls.level, classSection: cls.section, classSession: cls.session,
                studentCount, subjectCount: (cls.subjects || []).length, assessmentCount, commentCount,
                hasBroadsheetData: assessmentCount > 0, hasComments: commentCount > 0,
                completionPercentage: studentCount > 0 ? Math.round((commentCount / studentCount) * 100) : 0
            };
        }));

        res.json({ success: true, data: classList, meta: { termId: resolved.termId, termName: resolved.termName, sessionId: resolved.sessionId, sessionName: resolved.sessionName, totalClasses: classList.length } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET - Teacher broadsheet (for assigned subjects)
exports.getTeacherBroadsheet = async (req, res) => {
    try {
        if (req.user.role !== 'teacher') return res.status(403).json({ success: false, message: 'Access denied.' });

        const classId = parseInt(req.params.classId);
        if (isNaN(classId)) return res.status(400).json({ success: false, message: 'Invalid class ID format.' });

        const { termId, sessionId, subjectFilter } = req.query;
        const tenantFilter = getTenantFilter(req);
        const teacherId = parseInt(req.user.id);

        const classData = await prisma.class.findFirst({ where: { ...tenantFilter, id: classId } });
        if (!classData) return res.status(404).json({ success: false, message: 'Class not found.' });

        const isClassTeacher = classData.teacherId === teacherId;
        const teacherAssignments = await prisma.teacherAssignment.findMany({ 
            where: { ...tenantFilter, teacherId: teacherId, classId: classId, isActive: true } 
        });

        if (!isClassTeacher && teacherAssignments.length === 0) return res.status(403).json({ success: false, message: 'Access denied.' });

        const resolved = await resolveTermAndSessionSafe(req, termId, sessionId);
        if (!resolved.termId || !resolved.sessionId) return res.status(400).json({ success: false, message: 'No valid term or session found.' });

        // Fetch subjects for this class
        const classSubjectIds = classData.subjects || [];
        const classSubjects = await prisma.subject.findMany({ where: { id: { in: classSubjectIds } } });

        let subjectsToShow = [];
        if (subjectFilter === 'assigned') {
            const assignedSubjectIds = teacherAssignments.map(a => a.subjectId);
            subjectsToShow = classSubjects.filter(s => assignedSubjectIds.includes(s.id)).map(s => ({ subjectId: s.id, subjectName: s.name, subjectCode: s.code }));
        } else {
            subjectsToShow = classSubjects.map(s => ({ subjectId: s.id, subjectName: s.name, subjectCode: s.code }));
        }

        if (subjectsToShow.length === 0) return res.status(404).json({ success: false, message: 'No subjects found.' });
        subjectsToShow.sort((a, b) => a.subjectName.localeCompare(b.subjectName));
        
        const subjectIds = subjectsToShow.map(s => s.subjectId);
        const students = await prisma.student.findMany({ 
            where: { ...tenantFilter, classId, isDeleted: { not: true } }, 
            select: { id: true, firstName: true, lastName: true, admissionNumber: true, gender: true },
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] 
        });

        const studentIds = students.map(s => s.id);
        const assessments = await prisma.continuousAssessment.findMany({ 
            where: { ...tenantFilter, studentId: { in: studentIds }, classId, subjectId: { in: subjectIds }, termId: resolved.termId, sessionId: resolved.sessionId, status: 'approved', isActive: true } 
        });

        const assessmentMap = {};
        assessments.forEach(a => { assessmentMap[`${a.studentId}::${a.subjectId}`] = a; });

        const broadsheetStudents = [];
        let allTotals = [];

        students.forEach(student => {
            const scores = {}; let studentTotal = 0; let subjectsWithScores = 0;
            subjectsToShow.forEach(subject => {
                const assessment = assessmentMap[`${student.id}::${subject.subjectId}`];
                if (assessment) {
                    scores[subject.subjectId] = { 
                        testScore: assessment.testScore || 0, noteTakingScore: assessment.noteTakingScore || 0, 
                        assignmentScore: assessment.assignmentScore || 0, totalCA: assessment.totalCA || 0, 
                        examScore: assessment.examScore || 0, totalScore: assessment.totalScore || 0, 
                        grade: assessment.grade || '', remark: assessment.remark || '' 
                    };
                    studentTotal += assessment.totalScore || 0; subjectsWithScores++;
                } else { scores[subject.subjectId] = null; }
            });
            const averageScore = subjectsWithScores > 0 ? Math.round((studentTotal / subjectsWithScores) * 100) / 100 : 0;
            broadsheetStudents.push({ 
                studentId: student.id, studentName: `${student.lastName} ${student.firstName}`, 
                firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber, 
                gender: student.gender, scores, totalScore: studentTotal, averageScore, subjectsWithScores, totalSubjects: subjectsToShow.length 
            });
            if (subjectsWithScores > 0) allTotals.push(studentTotal);
        });

        const sortedByTotal = [...broadsheetStudents].sort((a, b) => b.totalScore - a.totalScore);
        sortedByTotal.forEach((student, index) => { student.position = (index > 0 && student.totalScore === sortedByTotal[index - 1].totalScore) ? sortedByTotal[index - 1].position : index + 1; });
        const positionMap = {}; sortedByTotal.forEach(student => { positionMap[student.studentId] = student.position; });
        broadsheetStudents.forEach(student => { student.position = positionMap[student.studentId] || 0; });

        const classTeacher = classData.teacherId ? await prisma.teacher.findUnique({ where: { id: classData.teacherId } }) : null;

        res.json({ success: true, data: { 
            classInfo: { classId: classData.id, className: classData.name, classTeacher: classTeacher ? `${classTeacher.firstName} ${classTeacher.lastName}` : 'Not Assigned', isClassTeacher }, 
            termInfo: { id: resolved.termId, name: resolved.termName }, 
            sessionInfo: { id: resolved.sessionId, name: resolved.sessionName }, 
            subjects: subjectsToShow, students: broadsheetStudents, 
            statistics: { 
                totalStudents: students.length, 
                highestTotal: allTotals.length > 0 ? Math.max(...allTotals) : 0, 
                lowestTotal: allTotals.length > 0 ? Math.min(...allTotals) : 0, 
                classAverage: allTotals.length > 0 ? Math.round((allTotals.reduce((a, b) => a + b, 0) / allTotals.length) * 100) / 100 : 0 
            } 
        }});
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET - Class Teacher Broadsheet (Full class view with fallbacks)
exports.getClassTeacherBroadsheet = async (req, res) => {
    try {
        if (req.user.role !== 'teacher') return res.status(403).json({ success: false, message: 'Access denied.' });

        const classId = parseInt(req.params.classId);
        if (isNaN(classId)) return res.status(400).json({ success: false, message: 'Invalid class ID format.' });

        const tenantFilter = getTenantFilter(req);
        const teacherId = parseInt(req.user.id);

        const classData = await prisma.class.findFirst({ where: { ...tenantFilter, id: classId } });
        if (!classData) return res.status(404).json({ success: false, message: 'Class not found.' });

        const isClassTeacher = classData.teacherId === teacherId;
        if (!isClassTeacher) return res.status(403).json({ success: false, message: 'Access denied. You are not the assigned class teacher.' });

        const resolved = await resolveTermAndSessionSafe(req, req.query.termId, req.query.sessionId);
        if (!resolved.termId || !resolved.sessionId) return res.status(400).json({ success: false, message: 'No valid term or session found.' });

        const classSubjectIds = classData.subjects || [];
        const populatedSubjects = await prisma.subject.findMany({ 
            where: { ...tenantFilter, id: { in: classSubjectIds } }, 
            orderBy: { name: 'asc' } 
        });

        if (populatedSubjects.length === 0) return res.status(404).json({ success: false, message: 'No subjects assigned.' });

        const subjectIds = populatedSubjects.map(s => s.id);
        const students = await prisma.student.findMany({ 
            where: { ...tenantFilter, classId, isDeleted: { not: true } }, 
            select: { id: true, firstName: true, lastName: true, admissionNumber: true, gender: true },
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] 
        });

        if (students.length === 0) return res.json({ success: true, data: { classInfo: null, students: [] }, message: 'No students found.' });

        const studentIds = students.map(s => s.id);

        const [assessments, classTeacherComments, openDaysRecord, attendanceRecords] = await Promise.all([
            prisma.continuousAssessment.findMany({ 
                where: { ...tenantFilter, studentId: { in: studentIds }, classId, subjectId: { in: subjectIds }, termId: resolved.termId, sessionId: resolved.sessionId, status: 'approved', isActive: true } 
            }),
            prisma.classTeacherComment.findMany({ 
                where: { ...tenantFilter, classId, term: resolved.termName, session: resolved.sessionName, isActive: true } 
            }),
            prisma.schoolOpenDays.findFirst({ 
                where: { ...tenantFilter, termId: resolved.termId, sessionId: resolved.sessionId } 
            }),
            prisma.attendance.findMany({ 
                where: { ...tenantFilter, classId, term: resolved.termName, session: resolved.sessionName, isActive: true } 
            })
        ]);

        const assessmentMap = {};
        assessments.forEach(a => { assessmentMap[`${a.studentId}::${a.subjectId}`] = a; });

        const commentMap = {}; classTeacherComments.forEach(c => { commentMap[c.studentId] = c.comment; });
        const schoolOpenDays = openDaysRecord?.timesOpen || 0;
        const attendanceMap = {}; attendanceRecords.forEach(att => { attendanceMap[att.studentId] = att.timesPresent || 0; });

        const broadsheetStudents = [];
        let allTotals = [];
        const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };

        students.forEach(student => {
            const scores = {}; let studentTotal = 0; let subjectsWithScores = 0;
            populatedSubjects.forEach(subject => {
                const assessment = assessmentMap[`${student.id}::${subject.id}`];
                if (assessment) {
                    const totalScore = assessment.totalScore || 0;
                    scores[subject.id] = { 
                        testScore: assessment.testScore || 0, noteTakingScore: assessment.noteTakingScore || 0, 
                        assignmentScore: assessment.assignmentScore || 0, totalCA: assessment.totalCA || 0, 
                        examScore: assessment.examScore || 0, totalScore, grade: assessment.grade || '', remark: assessment.remark || '' 
                    };
                    studentTotal += totalScore; subjectsWithScores++;
                    const gradeKey = (assessment.grade || '').toUpperCase(); if (gradeDistribution.hasOwnProperty(gradeKey)) gradeDistribution[gradeKey]++;
                } else { scores[subject.id] = null; }
            });
            const averageScore = subjectsWithScores > 0 ? Math.round((studentTotal / subjectsWithScores) * 100) / 100 : 0;
            const timesPresent = attendanceMap[student.id] || 0;

            broadsheetStudents.push({ 
                studentId: student.id, studentName: `${student.lastName} ${student.firstName}`, 
                admissionNumber: student.admissionNumber, scores, totalScore: studentTotal, averageScore, subjectsWithScores, 
                attendance: { timesPresent, timesOpen: schoolOpenDays, percentage: schoolOpenDays > 0 ? Math.round((timesPresent / schoolOpenDays) * 100) : 0 }, 
                classTeacherComment: commentMap[student.id] || '' 
            });
            if (subjectsWithScores > 0) allTotals.push(studentTotal);
        });

        const sortedByTotal = [...broadsheetStudents].filter(s => s.subjectsWithScores > 0).sort((a, b) => b.totalScore - a.totalScore);
        sortedByTotal.forEach((student, index) => { student.position = (index > 0 && student.totalScore === sortedByTotal[index - 1].totalScore) ? sortedByTotal[index - 1].position : index + 1; });
        const positionMap = {}; sortedByTotal.forEach(student => { positionMap[student.studentId] = student.position; });
        broadsheetStudents.forEach(student => { student.position = positionMap[student.studentId] || null; });

        const classTeacher = classData.teacherId ? await prisma.teacher.findUnique({ where: { id: classData.teacherId } }) : null;

        res.json({ success: true, data: { 
            classInfo: { classId: classData.id, className: `${classData.name} ${classData.section || ''}`.trim(), classTeacher: classTeacher ? `${classTeacher.firstName} ${classTeacher.lastName}` : null }, 
            termInfo: { id: resolved.termId, name: resolved.termName }, 
            sessionInfo: { id: resolved.sessionId, name: resolved.sessionName }, 
            subjects: populatedSubjects.map(s => ({ subjectId: s.id, subjectName: s.name, subjectCode: s.code })), 
            students: broadsheetStudents, 
            statistics: { 
                totalStudents: students.length, 
                highestTotal: allTotals.length > 0 ? Math.max(...allTotals) : 0, 
                lowestTotal: allTotals.length > 0 ? Math.min(...allTotals) : 0, 
                classAverage: allTotals.length > 0 ? Math.round((allTotals.reduce((a, b) => a + b, 0) / allTotals.length) * 100) / 100 : 0 
            }, 
            gradeDistribution 
        }});
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET - Admin broadsheet classes list
exports.getAdminBroadsheetClasses = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { termId, sessionId } = req.query;
        const resolved = await resolveTermAndSessionSafe(req, termId, sessionId);
        if (!resolved.termId || !resolved.sessionId) return res.status(400).json({ success: false, message: 'No valid term or session found.' });

        const tenantFilter = getTenantFilter(req);
        const classes = await prisma.class.findMany({ 
            where: { ...tenantFilter, isActive: true }, 
            orderBy: [{ level: 'asc' }, { section: 'asc' }, { name: 'asc' }] 
        });

        if (classes.length === 0) return res.json({ success: true, data: [], message: 'No classes found.' });

        const classIds = classes.map(c => c.id);
        const classIdFilter = { in: classIds };

        // Prisma groupBy is much cleaner than Mongo aggregate
        const [studentCounts, approvedAssessmentCounts, commentCounts] = await Promise.all([
            prisma.student.groupBy({ by: ['classId'], where: { ...tenantFilter, classId: classIdFilter, isDeleted: { not: true } }, _count: { id: true } }),
            prisma.continuousAssessment.groupBy({ by: ['classId'], where: { ...tenantFilter, classId: classIdFilter, termId: resolved.termId, sessionId: resolved.sessionId, status: 'approved', isActive: true }, _count: { id: true } }),
            prisma.classTeacherComment.groupBy({ by: ['classId'], where: { ...tenantFilter, classId: classIdFilter, term: resolved.termName, session: resolved.sessionName, isActive: true }, _count: { id: true } })
        ]);

        const studentCountMap = new Map(studentCounts.map(item => [item.classId, item._count.id]));
        const assessmentCountMap = new Map(approvedAssessmentCounts.map(item => [item.classId, item._count.id]));
        const commentCountMap = new Map(commentCounts.map(item => [item.classId, item._count.id]));

        const classList = await Promise.all(classes.map(async (cls) => {
            const studentCount = studentCountMap.get(cls.id) || 0;
            const assessmentCount = assessmentCountMap.get(cls.id) || 0;
            const commentCount = commentCountMap.get(cls.id) || 0;
            const classTeacher = cls.teacherId ? await prisma.teacher.findUnique({ where: { id: cls.teacherId } }) : null;

            return { 
                classId: cls.id, className: `${cls.name} ${cls.section || ''}`.trim(), classLevel: cls.level, 
                classTeacher: classTeacher ? `${classTeacher.firstName} ${classTeacher.lastName}` : 'Not Assigned', 
                subjectCount: (cls.subjects || []).length, studentCount, assessmentCount, commentCount, 
                hasBroadsheetData: assessmentCount > 0, completionPercentage: studentCount > 0 ? Math.round((commentCount / studentCount) * 100) : 0 
            };
        }));

        res.json({ success: true, data: classList, meta: { termId: resolved.termId, termName: resolved.termName, sessionId: resolved.sessionId, sessionName: resolved.sessionName, totalClasses: classList.length } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET - Admin broadsheet detailed view
exports.getAdminBroadsheet = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const classId = parseInt(req.params.classId);
        if (isNaN(classId)) return res.status(400).json({ success: false, message: 'Invalid class ID format.' });

        const tenantFilter = getTenantFilter(req);
        const classData = await prisma.class.findFirst({ where: { ...tenantFilter, id: classId } });
        if (!classData) return res.status(404).json({ success: false, message: 'Class not found.' });

        const resolved = await resolveTermAndSessionSafe(req, req.query.termId, req.query.sessionId);
        if (!resolved.termId || !resolved.sessionId) return res.status(400).json({ success: false, message: 'No valid term or session found.' });

        const classSubjectIds = classData.subjects || [];
        const populatedSubjects = await prisma.subject.findMany({ 
            where: { ...tenantFilter, id: { in: classSubjectIds } }, 
            orderBy: { name: 'asc' } 
        });

        const subjectIds = populatedSubjects.map(s => s.id);
        const students = await prisma.student.findMany({ 
            where: { ...tenantFilter, classId, isDeleted: { not: true } }, 
            select: { id: true, firstName: true, lastName: true, admissionNumber: true, gender: true },
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] 
        });

        const studentIds = students.map(s => s.id);

        const [assessments, classTeacherComments, openDaysRecord, attendanceRecords] = await Promise.all([
            prisma.continuousAssessment.findMany({ 
                where: { ...tenantFilter, studentId: { in: studentIds }, classId, subjectId: { in: subjectIds }, termId: resolved.termId, sessionId: resolved.sessionId, status: 'approved', isActive: true } 
            }),
            prisma.classTeacherComment.findMany({ 
                where: { ...tenantFilter, classId, term: resolved.termName, session: resolved.sessionName, isActive: true } 
            }),
            prisma.schoolOpenDays.findFirst({ 
                where: { ...tenantFilter, termId: resolved.termId, sessionId: resolved.sessionId } 
            }),
            prisma.attendance.findMany({ 
                where: { ...tenantFilter, classId, term: resolved.termName, session: resolved.sessionName, isActive: true } 
            })
        ]);

        const assessmentMap = {};
        assessments.forEach(a => { assessmentMap[`${a.studentId}::${a.subjectId}`] = a; });

        const commentMap = {}; classTeacherComments.forEach(c => { commentMap[c.studentId] = c.comment; });
        const schoolOpenDays = openDaysRecord?.timesOpen || 0;
        const attendanceMap = {}; attendanceRecords.forEach(att => { attendanceMap[att.studentId] = att.timesPresent || 0; });

        const broadsheetStudents = [];
        let allTotals = [];
        const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };

        students.forEach(student => {
            const scores = {}; let studentTotal = 0; let subjectsWithScores = 0;
            populatedSubjects.forEach(subject => {
                const assessment = assessmentMap[`${student.id}::${subject.id}`];
                if (assessment) {
                    scores[subject.id] = { 
                        testScore: assessment.testScore || 0, noteTakingScore: assessment.noteTakingScore || 0, 
                        assignmentScore: assessment.assignmentScore || 0, totalCA: assessment.totalCA || 0, 
                        examScore: assessment.examScore || 0, totalScore: assessment.totalScore || 0, 
                        grade: assessment.grade || '', remark: assessment.remark || '' 
                    };
                    studentTotal += assessment.totalScore || 0; subjectsWithScores++;
                    const gradeKey = (assessment.grade || '').toUpperCase(); if (gradeDistribution.hasOwnProperty(gradeKey)) gradeDistribution[gradeKey]++;
                } else { scores[subject.id] = null; }
            });
            const averageScore = subjectsWithScores > 0 ? Math.round((studentTotal / subjectsWithScores) * 100) / 100 : 0;
            const timesPresent = attendanceMap[student.id] || 0;

            broadsheetStudents.push({ 
                studentId: student.id, studentName: `${student.lastName} ${student.firstName}`, 
                admissionNumber: student.admissionNumber, scores, totalScore: studentTotal, averageScore, subjectsWithScores, 
                attendance: { timesPresent, timesOpen: schoolOpenDays, percentage: schoolOpenDays > 0 ? Math.round((timesPresent / schoolOpenDays) * 100) : 0 }, 
                classTeacherComment: commentMap[student.id] || '' 
            });
            if (subjectsWithScores > 0) allTotals.push(studentTotal);
        });

        const sortedByTotal = [...broadsheetStudents].filter(s => s.subjectsWithScores > 0).sort((a, b) => b.totalScore - a.totalScore);
        sortedByTotal.forEach((student, index) => { student.position = (index > 0 && student.totalScore === sortedByTotal[index - 1].totalScore) ? sortedByTotal[index - 1].position : index + 1; });
        const positionMap = {}; sortedByTotal.forEach(student => { positionMap[student.studentId] = student.position; });
        broadsheetStudents.forEach(student => { student.position = positionMap[student.studentId] || null; });

        const classTeacher = classData.teacherId ? await prisma.teacher.findUnique({ where: { id: classData.teacherId } }) : null;

        res.json({ success: true, data: { 
            classInfo: { classId: classData.id, className: `${classData.name} ${classData.section || ''}`.trim(), classTeacher: classTeacher ? `${classTeacher.firstName} ${classTeacher.lastName}` : null }, 
            termInfo: { id: resolved.termId, name: resolved.termName }, 
            sessionInfo: { id: resolved.sessionId, name: resolved.sessionName }, 
            subjects: populatedSubjects.map(s => ({ subjectId: s.id, subjectName: s.name, subjectCode: s.code })), 
            students: broadsheetStudents, 
            statistics: { 
                totalStudents: students.length, 
                highestTotal: allTotals.length > 0 ? Math.max(...allTotals) : 0, 
                lowestTotal: allTotals.length > 0 ? Math.min(...allTotals) : 0, 
                classAverage: allTotals.length > 0 ? Math.round((allTotals.reduce((a, b) => a + b, 0) / allTotals.length) * 100) / 100 : 0 
            }, 
            gradeDistribution 
        }});
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET - Global Broadsheet Stats for Admin Dashboard
exports.getGlobalBroadsheetStats = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Admin access only' });

        const { termId, sessionId } = req.query;
        const tenantFilter = getTenantFilter(req);

        const resolved = await resolveTermAndSessionSafe(req, termId, sessionId);
        if (!resolved.term || !resolved.session) return res.status(400).json({ success: false, message: 'No active term or session found.' });

        const [assessments, totalStudents] = await Promise.all([
            prisma.continuousAssessment.findMany({ 
                where: { ...tenantFilter, termId: resolved.termId, sessionId: resolved.sessionId, status: 'approved', isActive: true } 
            }),
            prisma.student.count({ where: { ...tenantFilter, isDeleted: { not: true } } })
        ]);

        if (assessments.length === 0) {
            return res.json({ success: true, data: { totalStudents, assessedStudents: 0, notAssessedStudents: totalStudents, passed: 0, failed: 0, averageScore: 0, passRate: 0, highestTotal: 0, lowestTotal: 0 }, termInfo: { id: resolved.termId, name: resolved.termName }, sessionInfo: { id: resolved.sessionId, name: resolved.sessionName } });
        }

        let passMark = 50;
        try {
            const gradingSystem = await prisma.gradingSystem.findFirst({ where: { ...tenantFilter, isDefault: true, isActive: true } });
            if (gradingSystem && gradingSystem.grades && gradingSystem.grades.length > 0) {
                const failGrade = gradingSystem.grades.find(g => g.grade && g.grade.toUpperCase() === 'F');
                if (failGrade) passMark = failGrade.maxScore + 1;
                const passingGrades = gradingSystem.grades.filter(g => g.grade && g.grade.toUpperCase() !== 'F' && g.minScore !== undefined);
                if (passingGrades.length > 0) passMark = Math.min(...passingGrades.map(g => g.minScore));
            }
        } catch (gradeErr) {}

        const studentMap = new Map();
        for (const assessment of assessments) {
            const studentId = assessment.studentId; if (!studentId) continue;
            if (!studentMap.has(studentId)) studentMap.set(studentId, { totalScore: 0, subjectCount: 0 });
            const entry = studentMap.get(studentId);
            entry.totalScore += assessment.totalScore || 0;
            entry.subjectCount += 1;
        }

        let passed = 0, failed = 0, totalAverage = 0, highestTotal = 0, lowestTotal = Infinity;
        for (const [studentId, data] of studentMap) {
            const avg = data.subjectCount > 0 ? data.totalScore / data.subjectCount : 0;
            totalAverage += avg;
            if (avg >= passMark) passed++; else failed++;
            if (avg > highestTotal) highestTotal = avg;
            if (avg < lowestTotal) lowestTotal = avg;
        }

        const totalAssessed = studentMap.size;
        const averageScore = totalAssessed > 0 ? (totalAverage / totalAssessed).toFixed(1) : 0;
        const passRate = totalAssessed > 0 ? ((passed / totalAssessed) * 100).toFixed(1) : 0;
        if (lowestTotal === Infinity) lowestTotal = 0;

        res.json({ success: true, data: { 
            totalStudents, assessedStudents: totalAssessed, notAssessedStudents: totalStudents - totalAssessed, 
            passed, failed, averageScore: parseFloat(averageScore), passRate: parseFloat(passRate), 
            highestTotal: Math.round(highestTotal), lowestTotal: Math.round(lowestTotal), 
            _debug: { passMark, totalAssessmentsFound: assessments.length, uniqueStudentsInAssessments: studentMap.size } 
        }, termInfo: { id: resolved.termId, name: resolved.termName }, sessionInfo: { id: resolved.sessionId, name: resolved.sessionName } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch global broadsheet statistics', error: error.message });
    }
};