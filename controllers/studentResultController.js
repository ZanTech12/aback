const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to populate Subject and Teacher relations for Assessments
const populateAssessmentRelations = async (assessments) => {
    if (!assessments || assessments.length === 0) return [];
    
    const subjectIds = [...new Set(assessments.map(a => a.subjectId).filter(Boolean))];
    const teacherIds = [...new Set(assessments.map(a => a.teacherId).filter(Boolean))];

    const [subjects, teachers] = await Promise.all([
        prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
        prisma.teacher.findMany({ where: { id: { in: teacherIds } } })
    ]);

    const subjectMap = new Map(subjects.map(s => [s.id, s]));
    const teacherMap = new Map(teachers.map(t => [t.id, t]));

    return assessments.map(a => ({
        ...a,
        subjectId: a.subjectId ? { ...subjectMap.get(a.subjectId), _id: a.subjectId } : null,
        teacherId: a.teacherId ? { ...teacherMap.get(a.teacherId), _id: a.teacherId } : null,
    }));
};

// GET /report-cards/student/:studentId
exports.getStudentReportCard = async (req, res) => {
    try {
        const { studentId } = req.params;
        const { termId, sessionId } = req.query;
        const tenantFilter = getTenantFilter(req);

        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const parsedStudentId = parseInt(studentId);

        if (req.user.role === 'student' && parseInt(req.user.id) !== parsedStudentId) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: parsedStudentId } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        // Fetch class data manually
        let classData = null;
        if (student.classId) {
            classData = await prisma.class.findUnique({ where: { id: student.classId } });
        }

        let term = null;
        if (termId && isValidId(termId)) {
            term = await prisma.term.findFirst({ where: { ...tenantFilter, id: parseInt(termId) } });
        }
        if (!term) term = await prisma.term.findFirst({ where: { ...tenantFilter, status: 'active', isActive: true } });
        if (!term) term = await prisma.term.findFirst({ where: { ...tenantFilter, isActive: true }, orderBy: { startDate: 'desc' } });
        if (!term) return res.status(404).json({ success: false, message: 'No active term found' });

        let session = null;
        if (sessionId && isValidId(sessionId)) {
            session = await prisma.session.findFirst({ where: { ...tenantFilter, id: parseInt(sessionId) } });
        } else if (term.sessionId) {
            session = await prisma.session.findFirst({ where: { ...tenantFilter, id: term.sessionId } });
        }
        if (!session) return res.status(404).json({ success: false, message: 'No session found' });

        const assessments = await prisma.continuousAssessment.findMany({ 
            where: { ...tenantFilter, studentId: parsedStudentId, termId: term.id, sessionId: session.id, status: 'approved' } 
        });
        const populatedAssessments = await populateAssessmentRelations(assessments);

        const principalComment = await prisma.principalComment.findFirst({ 
            where: { ...tenantFilter, studentId: parsedStudentId, termId: term.id, sessionId: session.id } 
        });

        const totalScore = populatedAssessments.reduce((sum, a) => sum + a.totalScore, 0);
        const averageScore = populatedAssessments.length > 0 ? Math.round(totalScore / populatedAssessments.length * 100) / 100 : 0;

        let position = 0, totalInClass = 0;
        if (student.classId) {
            const classStudents = await prisma.student.findMany({ where: { ...tenantFilter, classId: student.classId }, select: { id: true } });
            const classStudentIds = classStudents.map(s => s.id);
            totalInClass = classStudentIds.length;

            const allClassAssessments = await prisma.continuousAssessment.findMany({ 
                where: { ...tenantFilter, studentId: { in: classStudentIds }, termId: term.id, sessionId: session.id, status: 'approved' } 
            });

            const studentAverages = {};
            allClassAssessments.forEach(a => {
                if (!studentAverages[a.studentId]) studentAverages[a.studentId] = { total: 0, count: 0 };
                studentAverages[a.studentId].total += a.totalScore;
                studentAverages[a.studentId].count++;
            });

            const classAverages = Object.entries(studentAverages).map(([id, data]) => ({ studentId: parseInt(id), average: data.count > 0 ? data.total / data.count : 0 }));
            classAverages.sort((a, b) => b.average - a.average);
            position = classAverages.findIndex(a => a.studentId === parsedStudentId) + 1;
        }

        res.json({
            success: true,
            data: {
                student: { _id: student.id, firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber, gender: student.gender, class: classData ? { ...classData, _id: classData.id } : null },
                term: { _id: term.id, name: term.name, startDate: term.startDate, endDate: term.endDate, nextTermBegins: term.nextTermBegins },
                session: { _id: session.id, name: session.name, startDate: session.startDate, endDate: session.endDate },
                subjects: populatedAssessments.map(a => ({ _id: a.id, subject: a.subjectId, teacher: a.teacherId, testScore: a.testScore, noteTakingScore: a.noteTakingScore, assignmentScore: a.assignmentScore, totalCA: a.totalCA, examScore: a.examScore, totalScore: a.totalScore, grade: a.grade, remark: a.remark })),
                statistics: { totalSubjects: populatedAssessments.length, totalScore, averageScore, position, totalInClass },
                principalComment: principalComment ? principalComment.comment : '',
                classTeacherComment: principalComment ? principalComment.classTeacherComment : ''
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET /student/result-access-status
exports.getStudentResultAccessStatus = async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Access denied. Student role required.' });

        const tenantFilter = getTenantFilter(req);
        const studentId = parseInt(req.user.id);

        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: studentId } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        let classData = null;
        if (student.classId) {
            classData = await prisma.class.findUnique({ where: { id: student.classId } });
        }

        const resultStatus = { canAccess: true, studentBlocked: false, classBlocked: false, scheduleActive: false, scheduleStatus: null, scheduleDetails: null, blockReason: null };

        if (student.resultAccessBlocked) {
            resultStatus.canAccess = false; resultStatus.studentBlocked = true; resultStatus.blockReason = student.resultBlockReason;
        }
        if (classData && classData.resultAccessBlocked) {
            resultStatus.canAccess = false; resultStatus.classBlocked = true; resultStatus.blockReason = classData.resultBlockReason;
        }

        const activeTerm = await prisma.term.findFirst({ where: { ...tenantFilter, status: 'active', isActive: true } });
        if (activeTerm) {
            const schedule = await prisma.resultAccessSchedule.findFirst({ where: { ...tenantFilter, termId: activeTerm.id, isActive: true } });
            if (schedule) {
                resultStatus.scheduleActive = true;
                const now = new Date();
                const startTime = new Date(schedule.resultStartTime);
                const deadline = new Date(schedule.resultDeadline);

                let scheduleStatus = 'active';
                let timeRemaining = null;

                if (now < startTime) {
                    scheduleStatus = 'before_start'; resultStatus.canAccess = false;
                    const diff = startTime - now;
                    timeRemaining = { days: Math.floor(diff / (1000 * 60 * 60 * 24)), hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)), minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)) };
                } else if (now > deadline) {
                    scheduleStatus = 'deadline_passed'; resultStatus.canAccess = false;
                    timeRemaining = { daysSinceExpired: Math.floor((now - deadline) / (1000 * 60 * 60 * 24)) };
                } else {
                    const diff = deadline - now;
                    timeRemaining = { days: Math.floor(diff / (1000 * 60 * 60 * 24)), hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)), minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)) };
                }
                resultStatus.scheduleStatus = scheduleStatus;
                resultStatus.scheduleDetails = { resultStartTime: schedule.resultStartTime, resultDeadline: schedule.resultDeadline, message: schedule.message, timeRemaining };
            }
        }
        res.json({ success: true, data: resultStatus });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// POST /student/check-results
exports.checkResultsPublic = async (req, res) => {
    try {
        if (res.headersSent) return;

        const { admissionNumber, firstName, termId, sessionId } = req.body;
        if (!admissionNumber || !firstName) return res.status(400).json({ success: false, message: 'Admission Number and First Name are required.' });

        const adminId = req.body.adminId || (req.checkedStudent && req.checkedStudent.adminId);
        const publicTenantFilter = adminId ? { adminId: parseInt(adminId) } : {};

        let student = req.checkedStudent;
        if (!student) {
            student = await prisma.student.findFirst({
                where: {
                    ...publicTenantFilter,
                    admissionNumber: { equals: admissionNumber.trim(), mode: 'insensitive' },
                    firstName: { equals: firstName.trim(), mode: 'insensitive' },
                    isDeleted: { not: true }
                }
            });
        }

        if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

        const verifiedTenantFilter = { adminId: student.adminId };
        const parsedStudentId = student.id;

        let classData = null;
        if (student.classId) {
            classData = await prisma.class.findUnique({ where: { id: student.classId } });
        }

        let term = await prisma.term.findFirst({ where: { ...verifiedTenantFilter, status: 'active', isActive: true } });
        if (!term) term = await prisma.term.findFirst({ where: { ...verifiedTenantFilter, isActive: true }, orderBy: { startDate: 'desc' } });
        if (termId && isValidId(termId)) { 
            const specifiedTerm = await prisma.term.findFirst({ where: { ...verifiedTenantFilter, id: parseInt(termId) } }); 
            if (specifiedTerm) term = specifiedTerm; 
        }
        if (!term) return res.status(404).json({ success: false, message: 'No active term found' });

        let session = null;
        if (term.sessionId) session = await prisma.session.findFirst({ where: { ...verifiedTenantFilter, id: term.sessionId } });
        if (sessionId && isValidId(sessionId)) { 
            const foundSession = await prisma.session.findFirst({ where: { ...verifiedTenantFilter, id: parseInt(sessionId) } }); 
            if (foundSession) session = foundSession; 
        }
        if (!session) return res.status(404).json({ success: false, message: 'No valid session found.' });

        const assessments = await prisma.continuousAssessment.findMany({ 
            where: { ...verifiedTenantFilter, studentId: parsedStudentId, termId: term.id, sessionId: session.id, status: 'approved' } 
        });
        const populatedAssessments = await populateAssessmentRelations(assessments);

        const principalComment = await prisma.principalComment.findFirst({ 
            where: { ...verifiedTenantFilter, studentId: parsedStudentId, termId: term.id, sessionId: session.id } 
        });

        let classTeacherComment = '';
        if (student.classId && term.name && session.name) {
            const ctComment = await prisma.classTeacherComment.findFirst({ 
                where: { ...verifiedTenantFilter, studentId: parsedStudentId, classId: student.classId, term: term.name, session: session.name, isActive: true } 
            });
            if (ctComment) classTeacherComment = ctComment.comment;
        }

        let timesPresent = 0, timesOpen = 0;
        const attendance = await prisma.attendance.findFirst({ 
            where: { ...verifiedTenantFilter, studentId: parsedStudentId, term: term.name, session: session.name } 
        });
        if (attendance) timesPresent = attendance.timesPresent || 0;
        
        const schoolOpenDays = await prisma.schoolOpenDays.findFirst({ 
            where: { ...verifiedTenantFilter, termId: term.id, sessionId: session.id } 
        });
        if (schoolOpenDays) timesOpen = schoolOpenDays.timesOpen || 0;

        const totalScore = populatedAssessments.reduce((sum, a) => sum + a.totalScore, 0);
        const averageScore = populatedAssessments.length > 0 ? Math.round(totalScore / populatedAssessments.length * 100) / 100 : 0;

        let position = 0, totalInClass = 0;
        if (student.classId) {
            const classStudents = await prisma.student.findMany({ where: { ...verifiedTenantFilter, classId: student.classId }, select: { id: true } });
            const classStudentIds = classStudents.map(s => s.id);
            totalInClass = classStudents.length;
            const allClassAssessments = await prisma.continuousAssessment.findMany({ 
                where: { ...verifiedTenantFilter, studentId: { in: classStudentIds }, termId: term.id, sessionId: session.id, status: 'approved' } 
            });

            const studentAverages = {};
            allClassAssessments.forEach(a => {
                if (!studentAverages[a.studentId]) studentAverages[a.studentId] = { total: 0, count: 0 };
                studentAverages[a.studentId].total += a.totalScore;
                studentAverages[a.studentId].count++;
            });

            const classAverages = Object.entries(studentAverages).map(([id, data]) => ({ studentId: parseInt(id), average: data.count > 0 ? data.total / data.count : 0 }));
            classAverages.sort((a, b) => b.average - a.average);
            position = classAverages.findIndex(a => a.studentId === parsedStudentId) + 1;
        }

        res.json({
            success: true,
            data: {
                student: { firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber, gender: student.gender, class: classData ? { ...classData, _id: classData.id } : null },
                term: { _id: term.id, name: term.name, startDate: term.startDate, endDate: term.endDate, nextTermBegins: term.nextTermBegins },
                session: { _id: session.id, name: session.name },
                subjects: populatedAssessments.map(a => ({ subject: a.subjectId, teacher: a.teacherId, testScore: a.testScore, noteTakingScore: a.noteTakingScore, assignmentScore: a.assignmentScore, totalCA: a.totalCA, examScore: a.examScore, totalScore: a.totalScore, grade: a.grade, remark: a.remark })),
                statistics: { totalSubjects: populatedAssessments.length, totalScore, averageScore, position, totalInClass },
                attendance: { timesPresent, timesOpen, percentage: timesOpen > 0 ? Math.round((timesPresent / timesOpen) * 100) : 0 },
                principalComment: principalComment ? principalComment.comment : '',
                classTeacherComment: classTeacherComment,
                resultSchedule: req.resultSchedule || null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET /report-cards/class/:classId
exports.getClassReportCards = async (req, res) => {
    try {
        const { classId } = req.params;
        const { termId, sessionId } = req.query;
        const tenantFilter = getTenantFilter(req);

        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        if (!isValidId(classId)) return res.status(400).json({ success: false, message: 'Invalid Class ID format.' });

        const parsedClassId = parseInt(classId);

        const classData = await prisma.class.findFirst({ where: { ...tenantFilter, id: parsedClassId } });
        if (!classData) return res.status(404).json({ success: false, message: 'Class not found' });

        // Fetch subjects manually for classData
        const classSubjectIds = classData.subjects || [];
        const subjects = await prisma.subject.findMany({ where: { id: { in: classSubjectIds } } });
        const populatedClassData = { ...classData, subjects };

        let term = termId && isValidId(termId) 
            ? await prisma.term.findFirst({ where: { ...tenantFilter, id: parseInt(termId) } }) 
            : await prisma.term.findFirst({ where: { ...tenantFilter, status: 'active', isActive: true } });
            
        if (!term) term = await prisma.term.findFirst({ where: { ...tenantFilter, isActive: true }, orderBy: { startDate: 'desc' } });
        if (!term) return res.status(404).json({ success: false, message: 'No term found' });

        let session = null;
        if (term.sessionId) session = await prisma.session.findFirst({ where: { ...tenantFilter, id: term.sessionId } });
        if (sessionId && isValidId(sessionId)) { 
            const foundSession = await prisma.session.findFirst({ where: { ...tenantFilter, id: parseInt(sessionId) } }); 
            if (foundSession) session = foundSession; 
        }
        if (!session) return res.status(404).json({ success: false, message: 'No valid session found.' });

        const students = await prisma.student.findMany({ 
            where: { ...tenantFilter, classId: parsedClassId, isDeleted: { not: true } }, 
            select: { id: true, firstName: true, lastName: true, admissionNumber: true, gender: true },
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] 
        });

        const assessments = await prisma.continuousAssessment.findMany({ 
            where: { ...tenantFilter, classId: parsedClassId, termId: term.id, sessionId: session.id, status: 'approved' } 
        });
        const populatedAssessments = await populateAssessmentRelations(assessments);

        const studentAssessments = {};
        students.forEach(student => {
            studentAssessments[student.id] = { student, subjects: [], totalScore: 0, subjectCount: 0 };
        });

        populatedAssessments.forEach(a => {
            const studentId = a.studentId;
            if (!studentAssessments[studentId]) {
                // In case a student changed class but still has an assessment linked to this class/term
                studentAssessments[studentId] = { student: { id: studentId, firstName: 'Unknown', lastName: '', admissionNumber: '' }, subjects: [], totalScore: 0, subjectCount: 0 };
            }
            studentAssessments[studentId].subjects.push(a);
            studentAssessments[studentId].totalScore += a.totalScore;
            studentAssessments[studentId].subjectCount++;
        });

        const results = Object.values(studentAssessments).map(data => ({ 
            ...data, 
            averageScore: data.subjectCount > 0 ? Math.round(data.totalScore / data.subjectCount * 100) / 100 : 0 
        }));
        
        results.sort((a, b) => b.averageScore - a.averageScore);
        results.forEach((result, index) => { result.position = index + 1; });

        res.json({ success: true, data: { class: populatedClassData, term, session, students: results, totalStudents: students.length, assessedStudents: results.filter(r => r.subjectCount > 0).length } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};