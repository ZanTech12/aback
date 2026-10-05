const prisma = require('../config/db');
const { resolveTermAndSession, getTenantFilter } = require('../utils/helpers');

// Helper to safely get Admin ID
const getAdminId = (req) => req.user.role === 'admin' ? parseInt(req.user.id) : parseInt(req.user.adminId);

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to calculate grade
const calculateGrade = async (score, adminId) => {
    const gradingSystem = await prisma.gradingSystem.findFirst({ 
        where: { adminId, isDefault: true, isActive: true } 
    }) || await prisma.gradingSystem.findFirst({ 
        where: { adminId, isActive: true } 
    });

    if (!gradingSystem) {
        if (score >= 70) return { grade: 'A', remark: 'Excellent' };
        if (score >= 60) return { grade: 'B', remark: 'Very Good' };
        if (score >= 50) return { grade: 'C', remark: 'Good' };
        if (score >= 40) return { grade: 'D', remark: 'Fair' };
        return { grade: 'F', remark: 'Poor' };
    }
    const grades = gradingSystem.grades || [];
    const gradeEntry = grades.find(g => score >= g.minScore && score <= g.maxScore);
    return gradeEntry ? { grade: gradeEntry.grade, remark: gradeEntry.remark || '' } : { grade: 'F', remark: 'Poor' };
};

// Helper to fetch and attach relations for assessments
const populateAssessmentRelations = async (assessments) => {
    if (!assessments || assessments.length === 0) return [];
    
    const studentIds = [...new Set(assessments.map(a => a.studentId).filter(Boolean))];
    const classIds = [...new Set(assessments.map(a => a.classId).filter(Boolean))];
    const subjectIds = [...new Set(assessments.map(a => a.subjectId).filter(Boolean))];
    const termIds = [...new Set(assessments.map(a => a.termId).filter(Boolean))];
    const sessionIds = [...new Set(assessments.map(a => a.sessionId).filter(Boolean))];
    const teacherIds = [...new Set(assessments.map(a => a.teacherId).filter(Boolean))];
    const approverIds = [...new Set(assessments.map(a => a.approvedBy).filter(Boolean))];

    const [students, classes, subjects, terms, sessions, teachers, approvers] = await Promise.all([
        prisma.student.findMany({ where: { id: { in: studentIds } } }),
        prisma.class.findMany({ where: { id: { in: classIds } } }),
        prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
        prisma.term.findMany({ where: { id: { in: termIds } } }),
        prisma.session.findMany({ where: { id: { in: sessionIds } } }),
        prisma.teacher.findMany({ where: { id: { in: teacherIds } } }),
        prisma.admin.findMany({ where: { id: { in: approverIds } } })
    ]);

    const mapById = (arr) => new Map(arr.map(item => [item.id, item]));
    const studentMap = mapById(students);
    const classMap = mapById(classes);
    const subjectMap = mapById(subjects);
    const termMap = mapById(terms);
    const sessionMap = mapById(sessions);
    const teacherMap = mapById(teachers);
    const approverMap = mapById(approvers);

    return assessments.map(a => ({
        ...a,
        studentId: a.studentId ? { ...studentMap.get(a.studentId), _id: a.studentId } : null,
        classId: a.classId ? { ...classMap.get(a.classId), _id: a.classId } : null,
        subjectId: a.subjectId ? { ...subjectMap.get(a.subjectId), _id: a.subjectId } : null,
        termId: a.termId ? { ...termMap.get(a.termId), _id: a.termId } : null,
        sessionId: a.sessionId ? { ...sessionMap.get(a.sessionId), _id: a.sessionId } : null,
        teacherId: a.teacherId ? { ...teacherMap.get(a.teacherId), _id: a.teacherId } : null,
        approvedBy: a.approvedBy ? { ...approverMap.get(a.approvedBy), _id: a.approvedBy, name: approverMap.get(a.approvedBy)?.name || 'Admin' } : null,
    }));
};

// Middleware to verify admin/superadmin role
exports.requireAdmin = (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
    }
    next();
};

// GET - Admin view of a student's complete scores across all terms
exports.getStudentAllSubjectScores = async (req, res) => {
    try {
        const { studentId } = req.params;
        const { termId, sessionId } = req.query;
        const tenantFilter = getTenantFilter(req);

        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const parsedStudentId = parseInt(studentId);

        const student = await prisma.student.findFirst({ 
            where: { ...tenantFilter, id: parsedStudentId, isDeleted: { not: true } } 
        });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

        const query = { ...tenantFilter, studentId: parsedStudentId, isActive: true };
        if (termId && isValidId(termId)) query.termId = parseInt(termId);
        if (sessionId && isValidId(sessionId)) query.sessionId = parseInt(sessionId);

        const assessments = await prisma.continuousAssessment.findMany({
            where: query,
            orderBy: { updatedAt: 'desc' }
        });

        const populatedAssessments = await populateAssessmentRelations(assessments);

        const groupedByTermSession = {};
        populatedAssessments.forEach(a => {
            const termKey = a.termId?._id?.toString() || 'unknown';
            const sessionKey = a.sessionId?._id?.toString() || 'unknown';
            const groupKey = `${termKey}::${sessionKey}`;

            if (!groupedByTermSession[groupKey]) {
                groupedByTermSession[groupKey] = { 
                    termId: a.termId?._id, termName: a.termId?.name || 'Unknown', 
                    sessionId: a.sessionId?._id, sessionName: a.sessionId?.name || 'Unknown', 
                    subjects: [], totalScore: 0, subjectCount: 0 
                };
            }

            groupedByTermSession[groupKey].subjects.push({
                id: a._id, classId: a.classId?._id, className: a.classId ? `${a.classId.name} ${a.classId.section || ''}`.trim() : 'N/A',
                subjectId: a.subjectId?._id, subjectName: a.subjectId?.name || 'Unknown', subjectCode: a.subjectId?.code || '',
                teacherName: a.teacherId ? `${a.teacherId.firstName} ${a.teacherId.lastName}` : 'N/A',
                testScore: a.testScore || 0, noteTakingScore: a.noteTakingScore || 0, assignmentScore: a.assignmentScore || 0,
                totalCA: a.totalCA || 0, examScore: a.examScore || 0, totalScore: a.totalScore || 0, grade: a.grade || '', status: a.status
            });

            if (a.totalScore > 0) {
                groupedByTermSession[groupKey].totalScore += a.totalScore;
                groupedByTermSession[groupKey].subjectCount++;
            }
        });

        Object.values(groupedByTermSession).forEach(group => {
            group.averageScore = group.subjectCount > 0 ? Math.round((group.totalScore / group.subjectCount) * 100) / 100 : 0;
        });

        const sortedGroups = Object.values(groupedByTermSession).sort((a, b) => {
            if (a.sessionName !== b.sessionName) return b.sessionName.localeCompare(a.sessionName);
            return b.termName.localeCompare(a.termName);
        });

        res.json({ success: true, data: { student: { _id: student.id, firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber, currentClassId: student.classId }, termSessions: sortedGroups, totalAssessments: assessments.length } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET - Get all students with their classes and scores
exports.getStudentsClassesScores = async (req, res) => {
    try {
        const { termId, sessionId, classId, subjectId, status, page = 1, limit = 50, search } = req.query;

        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const tenantFilter = getTenantFilter(req);
        const resolved = await resolveTermAndSession(termId, sessionId, req);
        const query = { ...tenantFilter, isActive: true };

        if (resolved.termId) query.termId = resolved.termId;
        if (resolved.sessionId) query.sessionId = resolved.sessionId;
        if (status) query.status = status;

        if (req.user.role === 'teacher') {
            const teacherAssignments = await prisma.teacherAssignment.findMany({ 
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), isActive: true } 
            });
            
            if (teacherAssignments.length === 0) {
                return res.json({ success: true, data: [], pagination: { page: 1, limit: parseInt(limit), total: 0, pages: 0 }, message: 'No assignments found.' });
            }
            
            const assignedClassIds = [...new Set(teacherAssignments.map(a => a.classId))];
            const assignedSubjectIds = [...new Set(teacherAssignments.map(a => a.subjectId))];

            // If teacher filtered by classId, ensure they are assigned to it
            if (classId && isValidId(classId)) {
                if (!assignedClassIds.includes(parseInt(classId))) {
                    return res.json({ success: true, data: [], pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, pages: 0 }, message: 'Not assigned to this class.' });
                }
                query.classId = parseInt(classId);
            } else {
                // If no classId filter, restrict to assigned classes
                query.classId = { in: assignedClassIds };
            }

            // If teacher filtered by subjectId, ensure they are assigned to it
            if (subjectId && isValidId(subjectId)) {
                if (!assignedSubjectIds.includes(parseInt(subjectId))) {
                    return res.json({ success: true, data: [], pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, pages: 0 }, message: 'Not assigned to this subject.' });
                }
                query.subjectId = parseInt(subjectId);
            } else {
                // If no subjectId filter, restrict to assigned subjects
                query.subjectId = { in: assignedSubjectIds };
            }
        } else {
            // Admin & SuperAdmin can filter freely
            if (classId && isValidId(classId)) query.classId = parseInt(classId);
            if (subjectId && isValidId(subjectId)) query.subjectId = parseInt(subjectId);
        }

        if (search) {
            const students = await prisma.student.findMany({ 
                where: {
                    ...tenantFilter,
                    isDeleted: { not: true },
                    OR: [
                        { firstName: { contains: search, mode: 'insensitive' } }, 
                        { lastName: { contains: search, mode: 'insensitive' } }, 
                        { admissionNumber: { contains: search, mode: 'insensitive' } }
                    ] 
                },
                select: { id: true }
            });
            
            if (students.length > 0) {
                query.studentId = { in: students.map(s => s.id) };
            } else {
                return res.json({ success: true, data: [], pagination: { page: 1, limit: parseInt(limit), total: 0, pages: 0 }, message: 'No students match.' });
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const [assessments, total] = await Promise.all([
            prisma.continuousAssessment.findMany({
                where: query,
                orderBy: { updatedAt: 'desc' },
                skip,
                take
            }),
            prisma.continuousAssessment.count({ where: query })
        ]);

        const populatedAssessments = await populateAssessmentRelations(assessments);
        
        // Manual sort for student lastName, then firstName, then subjectName
        populatedAssessments.sort((a, b) => {
            const sA = a.studentId?.lastName || '';
            const sB = b.studentId?.lastName || '';
            if (sA !== sB) return sA.localeCompare(sB);
            const fA = a.studentId?.firstName || '';
            const fB = b.studentId?.firstName || '';
            if (fA !== fB) return fA.localeCompare(fB);
            const subA = a.subjectId?.name || '';
            const subB = b.subjectId?.name || '';
            return subA.localeCompare(subB);
        });

        const formattedData = populatedAssessments.map(a => ({
            id: a._id,
            student: { id: a.studentId?._id, firstName: a.studentId?.firstName, lastName: a.studentId?.lastName, fullName: a.studentId ? `${a.studentId.lastName} ${a.studentId.firstName}` : 'Unknown', admissionNumber: a.studentId?.admissionNumber, gender: a.studentId?.gender },
            class: { id: a.classId?._id, name: a.classId?.name, level: a.classId?.level, section: a.classId?.section, session: a.classId?.session, fullName: a.classId ? `${a.classId.name} ${a.classId.section || ''}`.trim() : 'N/A' },
            subject: { id: a.subjectId?._id, name: a.subjectId?.name, code: a.subjectId?.code },
            teacher: { id: a.teacherId?._id, name: a.teacherId ? `${a.teacherId.firstName} ${a.teacherId.lastName}` : 'N/A' },
            term: { id: a.termId?._id, name: a.termId?.name }, session: { id: a.sessionId?._id, name: a.sessionId?.name },
            scores: { testScore: a.testScore || 0, noteTakingScore: a.noteTakingScore || 0, assignmentScore: a.assignmentScore || 0, totalCA: a.totalCA || 0, examScore: a.examScore || 0, totalScore: a.totalScore || 0 },
            grade: a.grade || '', remark: a.remark || '', status: a.status || 'draft', approvedBy: a.approvedBy?.name || null, approvedAt: a.approvedAt, updatedAt: a.updatedAt, createdAt: a.createdAt
        }));

        const scoredRecords = assessments.filter(a => a.totalScore > 0);
        const summary = {
            totalRecords: total, scoredRecords: scoredRecords.length,
            averageScore: scoredRecords.length > 0 ? Math.round((scoredRecords.reduce((sum, a) => sum + a.totalScore, 0) / scoredRecords.length) * 100) / 100 : 0,
            highestScore: scoredRecords.length > 0 ? Math.max(...scoredRecords.map(a => a.totalScore)) : 0,
            lowestScore: scoredRecords.length > 0 ? Math.min(...scoredRecords.map(a => a.totalScore)) : 0,
            statusBreakdown: { draft: assessments.filter(a => a.status === 'draft').length, submitted: assessments.filter(a => a.status === 'submitted').length, approved: assessments.filter(a => a.status === 'approved').length }
        };

        res.json({ success: true, data: formattedData, summary, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) }, meta: { termName: resolved.termName, sessionName: resolved.sessionName, termId: resolved.termId, sessionId: resolved.sessionId } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET - Get a single student's complete classes and scores
exports.getSingleStudentClassesScores = async (req, res) => {
    try {
        const { studentId } = req.params;
        const { termId, sessionId, classId, subjectId, status } = req.query;
        const tenantFilter = getTenantFilter(req);

        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const parsedStudentId = parseInt(studentId);

        if (req.user.role === 'student' && parseInt(req.user.id) !== parsedStudentId) return res.status(403).json({ success: false, message: 'Access denied.' });

        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: parsedStudentId, isDeleted: { not: true } } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

        let classData = null;
        if (student.classId) {
            classData = await prisma.class.findUnique({ where: { id: student.classId } });
        }

        const resolved = await resolveTermAndSession(termId, sessionId, req);
        if (!resolved.termId || !resolved.sessionId) return res.status(400).json({ success: false, message: 'No valid term or session found.' });

        const query = { ...tenantFilter, studentId: parsedStudentId, termId: resolved.termId, sessionId: resolved.sessionId, isActive: true };
        if (classId && isValidId(classId)) query.classId = parseInt(classId);
        if (subjectId && isValidId(subjectId)) query.subjectId = parseInt(subjectId);
        if (status && req.user.role !== 'student') query.status = status;
        if (req.user.role === 'student') query.status = 'approved';

        const assessments = await prisma.continuousAssessment.findMany({ where: query });
        const populatedAssessments = await populateAssessmentRelations(assessments);

        // Manual sort by subject name
        populatedAssessments.sort((a, b) => {
            const sA = a.subjectId?.name || '';
            const sB = b.subjectId?.name || '';
            return sA.localeCompare(sB);
        });

        const classSubjects = classData?.subjects || [];
        const populatedSubjects = await prisma.subject.findMany({ 
            where: { ...tenantFilter, id: { in: classSubjects } },
            orderBy: { name: 'asc' }
        });

        const subjectsWithScores = populatedSubjects.map(subject => {
            const assessment = assessments.find(a => a.subjectId === subject.id);
            const populatedAssessment = populatedAssessments.find(pa => pa.subjectId?._id === subject.id);
            return {
                subjectId: subject.id, subjectName: subject.name, subjectCode: subject.code, hasScore: !!assessment,
                assessment: assessment ? { 
                    id: assessment.id, testScore: assessment.testScore || 0, noteTakingScore: assessment.noteTakingScore || 0, 
                    assignmentScore: assessment.assignmentScore || 0, totalCA: assessment.totalCA || 0, examScore: assessment.examScore || 0, 
                    totalScore: assessment.totalScore || 0, grade: assessment.grade || '', remark: assessment.remark || '', status: assessment.status, 
                    teacherName: populatedAssessment?.teacherId ? `${populatedAssessment.teacherId.firstName} ${populatedAssessment.teacherId.lastName}` : 'N/A', 
                    approvedBy: populatedAssessment?.approvedBy?.name || null, updatedAt: assessment.updatedAt 
                } : null
            };
        });

        const otherClassScores = populatedAssessments.filter(a => !classData || !a.classId || a.classId._id !== student.classId).map(a => ({ 
            id: a._id, classId: a.classId?._id, className: a.classId ? `${a.classId.name} ${a.classId.section || ''}`.trim() : 'N/A', 
            subjectId: a.subjectId?._id, subjectName: a.subjectId?.name || 'Unknown', subjectCode: a.subjectId?.code || '', 
            testScore: a.testScore || 0, noteTakingScore: a.noteTakingScore || 0, assignmentScore: a.assignmentScore || 0, totalCA: a.totalCA || 0, 
            examScore: a.examScore || 0, totalScore: a.totalScore || 0, grade: a.grade || '', status: a.status 
        }));

        const scoredAssessments = assessments.filter(a => a.totalScore > 0);
        const totalScore = scoredAssessments.reduce((sum, a) => sum + a.totalScore, 0);
        const averageScore = scoredAssessments.length > 0 ? Math.round((totalScore / scoredAssessments.length) * 100) / 100 : 0;

        res.json({ success: true, data: { 
            student: { _id: student.id, firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber, gender: student.gender, 
                class: classData ? { id: classData.id, name: classData.name, level: classData.level, section: classData.section, session: classData.session, fullName: `${classData.name} ${classData.section || ''}`.trim() } : null 
            }, 
            term: { id: resolved.termId, name: resolved.termName }, session: { id: resolved.sessionId, name: resolved.sessionName }, 
            subjects: subjectsWithScores, otherClassScores, 
            summary: { 
                totalSubjects: populatedSubjects.length, subjectsWithScores: scoredAssessments.length, subjectsWithoutScores: populatedSubjects.length - scoredAssessments.length, 
                totalScore, averageScore, highestScore: scoredAssessments.length > 0 ? Math.max(...scoredAssessments.map(a => a.totalScore)) : 0, 
                lowestScore: scoredAssessments.length > 0 ? Math.min(...scoredAssessments.map(a => a.totalScore)) : 0 
            } 
        }});
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// POST - Create a new score record for a student
exports.createStudentClassesScores = async (req, res) => {
    try {
        const { studentId, classId, subjectId, termId, sessionId, teacherId, testScore, noteTakingScore, assignmentScore, examScore, status } = req.body;

        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        if (!studentId || !classId || !subjectId || !termId || !sessionId) return res.status(400).json({ success: false, message: 'Missing required fields.' });

        if (!isValidId(studentId) || !isValidId(classId) || !isValidId(subjectId) || !isValidId(termId) || !isValidId(sessionId)) {
            return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        }

        const tenantFilter = getTenantFilter(req);
        const adminId = getAdminId(req);

        const parsedStudentId = parseInt(studentId);
        const parsedClassId = parseInt(classId);
        const parsedSubjectId = parseInt(subjectId);
        const parsedTermId = parseInt(termId);
        const parsedSessionId = parseInt(sessionId);

        if (req.user.role === 'teacher') {
            const assignment = await prisma.teacherAssignment.findFirst({ 
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: parsedClassId, subjectId: parsedSubjectId, isActive: true } 
            });
            if (!assignment) return res.status(403).json({ success: false, message: 'Access denied. Not assigned to this class/subject.' });
        }

        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: parsedStudentId, classId: parsedClassId, isDeleted: { not: true } } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found or not enrolled in this class.' });

        const validateScore = (score, max) => score === undefined || score === null ? 0 : Math.min(Math.max(Number(score) || 0, 0), max);
        const finalTestScore = validateScore(testScore, 20);
        const finalNoteScore = validateScore(noteTakingScore, 10);
        const finalAssignScore = validateScore(assignmentScore, 10);
        const finalExamScore = validateScore(examScore, 60);

        const totalCA = finalTestScore + finalNoteScore + finalAssignScore;
        const totalScore = totalCA + finalExamScore;
        const { grade, remark } = await calculateGrade(totalScore, adminId);

        const existing = await prisma.continuousAssessment.findFirst({ 
            where: { ...tenantFilter, studentId: parsedStudentId, classId: parsedClassId, subjectId: parsedSubjectId, termId: parsedTermId, sessionId: parsedSessionId } 
        });
        if (existing) return res.status(400).json({ success: false, message: 'Score record already exists. Use PUT to update instead.', existingId: existing.id });

        const finalTeacherId = teacherId ? parseInt(teacherId) : parseInt(req.user.id);
        const finalStatus = status || 'draft';

        const dataPayload = {
            ...tenantFilter,
            studentId: parsedStudentId, classId: parsedClassId, subjectId: parsedSubjectId, termId: parsedTermId, sessionId: parsedSessionId, 
            teacherId: finalTeacherId, testScore: finalTestScore, noteTakingScore: finalNoteScore, assignmentScore: finalAssignScore, 
            totalCA, examScore: finalExamScore, totalScore, grade, remark, status: finalStatus 
        };

        if (finalStatus === 'approved' && ['admin', 'superadmin'].includes(req.user.role)) {
            dataPayload.approvedBy = parseInt(req.user.id);
            dataPayload.approvedAt = new Date();
        }

        const newAssessment = await prisma.continuousAssessment.create({ data: dataPayload });
        const [populatedAssessment] = await populateAssessmentRelations([newAssessment]);

        res.status(201).json({ success: true, message: 'Score record created successfully.', data: populatedAssessment });
    } catch (error) {
        if (error.code === 'P2002') return res.status(400).json({ success: false, message: 'Score record already exists.' });
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// PUT - Update/Edit a student's score record
exports.updateStudentClassesScores = async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const { testScore, noteTakingScore, assignmentScore, examScore, status } = req.body;
        const tenantFilter = getTenantFilter(req);
        const adminId = getAdminId(req);

        if (!isValidId(assessmentId)) return res.status(400).json({ success: false, message: 'Invalid assessment ID format.' });
        const parsedAssessmentId = parseInt(assessmentId);

        const assessment = await prisma.continuousAssessment.findFirst({ where: { ...tenantFilter, id: parsedAssessmentId } });
        if (!assessment) return res.status(404).json({ success: false, message: 'Score record not found.' });
        if (!assessment.isActive) return res.status(400).json({ success: false, message: 'Record deactivated.' });

        if (req.user.role === 'teacher') {
            if (assessment.teacherId !== parseInt(req.user.id)) return res.status(403).json({ success: false, message: 'Access denied.' });
            if (assessment.status === 'approved') return res.status(400).json({ success: false, message: 'Cannot edit approved records.' });
            const assignment = await prisma.teacherAssignment.findFirst({ 
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: assessment.classId, subjectId: assessment.subjectId, isActive: true } 
            });
            if (!assignment) return res.status(403).json({ success: false, message: 'Access denied. No longer assigned.' });
        }

        const validateScore = (score, max) => score === undefined || score === null ? null : Math.min(Math.max(Number(score) || 0, 0), max);
        const testResult = validateScore(testScore, 20);
        const noteResult = validateScore(noteTakingScore, 10);
        const assignResult = validateScore(assignmentScore, 10);
        const examResult = validateScore(examScore, 60);

        const dataToUpdate = {};
        if (testResult !== null) dataToUpdate.testScore = testResult;
        if (noteResult !== null) dataToUpdate.noteTakingScore = noteResult;
        if (assignResult !== null) dataToUpdate.assignmentScore = assignResult;
        if (examResult !== null) dataToUpdate.examScore = examResult;

        const fTest = dataToUpdate.testScore !== undefined ? dataToUpdate.testScore : assessment.testScore;
        const fNote = dataToUpdate.noteTakingScore !== undefined ? dataToUpdate.noteTakingScore : assessment.noteTakingScore;
        const fAssign = dataToUpdate.assignmentScore !== undefined ? dataToUpdate.assignmentScore : assessment.assignmentScore;
        const fExam = dataToUpdate.examScore !== undefined ? dataToUpdate.examScore : assessment.examScore;

        dataToUpdate.totalCA = fTest + fNote + fAssign;
        dataToUpdate.totalScore = dataToUpdate.totalCA + fExam;
        
        const { grade, remark } = await calculateGrade(dataToUpdate.totalScore, adminId);
        dataToUpdate.grade = grade;
        dataToUpdate.remark = remark;

        if (status === 'approved' && ['admin', 'superadmin'].includes(req.user.role)) {
            dataToUpdate.status = 'approved';
            dataToUpdate.approvedBy = parseInt(req.user.id);
            dataToUpdate.approvedAt = new Date();
        } else if (status === 'submitted') {
            dataToUpdate.status = 'submitted';
            dataToUpdate.submittedAt = new Date();
            // Clear approval fields if moving back to submitted
            dataToUpdate.approvedBy = null;
            dataToUpdate.approvedAt = null;
        } else if (status === 'draft') {
            dataToUpdate.status = 'draft';
            dataToUpdate.approvedBy = null;
            dataToUpdate.approvedAt = null;
        }

        const updatedAssessment = await prisma.continuousAssessment.update({
            where: { id: parsedAssessmentId },
            data: dataToUpdate
        });

        const [populatedAssessment] = await populateAssessmentRelations([updatedAssessment]);

        res.json({ success: true, message: 'Score record updated successfully.', data: populatedAssessment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// DELETE - Delete a student's score record
exports.deleteStudentClassesScores = async (req, res) => {
    try {
        const { assessmentId } = req.params;
        if (!isValidId(assessmentId)) return res.status(400).json({ success: false, message: 'Invalid assessment ID format.' });
        const parsedAssessmentId = parseInt(assessmentId);

        const assessment = await prisma.continuousAssessment.findFirst({ where: { ...getTenantFilter(req), id: parsedAssessmentId } });
        if (!assessment) return res.status(404).json({ success: false, message: 'Score record not found.' });

        if (req.user.role === 'teacher') {
            if (assessment.teacherId !== parseInt(req.user.id)) return res.status(403).json({ success: false, message: 'Access denied.' });
            if (assessment.status === 'approved') return res.status(400).json({ success: false, message: 'Cannot delete approved records.' });
        }

        if (assessment.status === 'approved' && ['admin', 'superadmin'].includes(req.user.role)) {
            await prisma.continuousAssessment.update({
                where: { id: parsedAssessmentId },
                data: { isActive: false }
            });
            return res.json({ success: true, message: 'Score record soft-deleted.', data: { id: assessmentId, softDeleted: true } });
        }

        await prisma.continuousAssessment.delete({ where: { id: parsedAssessmentId } });
        res.json({ success: true, message: 'Score record permanently deleted.', data: { id: assessmentId, softDeleted: false } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// PATCH - Bulk update scores for multiple students
exports.bulkUpdateScores = async (req, res) => {
    try {
        const { termId, sessionId, classId, subjectId, updates, approveAfterEdit } = req.body;

        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        if (!termId || !sessionId || !subjectId || !updates || !Array.isArray(updates)) return res.status(400).json({ success: false, message: 'Missing required fields.' });

        if (!isValidId(termId) || !isValidId(sessionId) || !isValidId(subjectId)) {
            return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        }

        const tenantFilter = getTenantFilter(req);
        const adminId = getAdminId(req);

        const parsedTermId = parseInt(termId);
        const parsedSessionId = parseInt(sessionId);
        const parsedSubjectId = parseInt(subjectId);

        if (req.user.role === 'teacher') {
            const assignment = await prisma.teacherAssignment.findFirst({ 
                where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: classId ? parseInt(classId) : undefined, subjectId: parsedSubjectId, isActive: true } 
            });
            if (!assignment) return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const validateScore = (score, max) => score === undefined || score === null ? null : Math.min(Math.max(Number(score) || 0, 0), max);
        const results = []; const errors = []; let created = 0; let updated = 0; let failed = 0;

        for (let i = 0; i < updates.length; i++) {
            const update = updates[i];
            try {
                if (!isValidId(update.studentId)) {
                    errors.push({ index: i, studentId: update.studentId, message: 'Invalid student ID' });
                    failed++;
                    continue;
                }

                const parsedStudentId = parseInt(update.studentId);

                const testScore = validateScore(update.testScore, 20);
                const noteScore = validateScore(update.noteTakingScore, 10);
                const assignScore = validateScore(update.assignmentScore, 10);
                const examScore = validateScore(update.examScore, 60);

                let studentClassId = classId ? parseInt(classId) : null;
                if (!studentClassId) {
                    const studentData = await prisma.student.findUnique({ where: { id: parsedStudentId }, select: { classId: true } });
                    studentClassId = studentData?.classId;
                }

                const existing = await prisma.continuousAssessment.findFirst({ 
                    where: { ...tenantFilter, studentId: parsedStudentId, classId: studentClassId, subjectId: parsedSubjectId, termId: parsedTermId, sessionId: parsedSessionId } 
                });

                const finalTestScore = testScore !== null ? testScore : (existing?.testScore || 0);
                const finalNoteScore = noteScore !== null ? noteScore : (existing?.noteTakingScore || 0);
                const finalAssignScore = assignScore !== null ? assignScore : (existing?.assignmentScore || 0);
                const finalExamScore = examScore !== null ? examScore : (existing?.examScore || 0);

                const totalCA = finalTestScore + finalNoteScore + finalAssignScore;
                const totalScore = totalCA + finalExamScore;
                const { grade, remark } = await calculateGrade(totalScore, adminId);
                const finalStatus = update.status || (existing?.status || 'draft');

                if (existing) {
                    if (req.user.role === 'teacher' && existing.status === 'approved') { 
                        errors.push({ index: i, studentId: update.studentId, message: 'Cannot update approved.' }); 
                        failed++; 
                        continue; 
                    }
                    
                    const dataPayload = {
                        testScore: finalTestScore, noteTakingScore: finalNoteScore, assignmentScore: finalAssignScore, 
                        totalCA, examScore: finalExamScore, totalScore, grade, remark, status: finalStatus
                    };

                    if ((approveAfterEdit || finalStatus === 'approved') && ['admin', 'superadmin'].includes(req.user.role)) { 
                        dataPayload.status = 'approved';
                        dataPayload.approvedBy = parseInt(req.user.id);
                        dataPayload.approvedAt = new Date();
                    }

                    await prisma.continuousAssessment.update({
                        where: { id: existing.id },
                        data: dataPayload
                    });
                    updated++;
                } else {
                    const dataPayload = {
                        ...tenantFilter,
                        studentId: parsedStudentId, classId: studentClassId, subjectId: parsedSubjectId, termId: parsedTermId, sessionId: parsedSessionId, 
                        teacherId: parseInt(req.user.id), testScore: finalTestScore, noteTakingScore: finalNoteScore, assignmentScore: finalAssignScore, 
                        totalCA, examScore: finalExamScore, totalScore, grade, remark, 
                        status: approveAfterEdit && ['admin', 'superadmin'].includes(req.user.role) ? 'approved' : finalStatus 
                    };

                    if (approveAfterEdit && ['admin', 'superadmin'].includes(req.user.role)) { 
                        dataPayload.approvedBy = parseInt(req.user.id);
                        dataPayload.approvedAt = new Date();
                    }

                    await prisma.continuousAssessment.create({ data: dataPayload });
                    created++;
                }
            } catch (err) {
                errors.push({ index: i, studentId: update.studentId, message: err.message });
                failed++;
            }
        }

        res.json({ success: true, message: `Bulk update completed. Created: ${created}, Updated: ${updated}, Failed: ${failed}.`, data: { summary: { created, updated, failed, total: updates.length }, errors } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// DELETE - Bulk delete score records
exports.bulkDeleteScores = async (req, res) => {
    try {
        const { assessmentIds, force } = req.body;

        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        if (!assessmentIds || !Array.isArray(assessmentIds) || assessmentIds.length === 0) return res.status(400).json({ success: false, message: 'assessmentIds array is required.' });

        const validIds = assessmentIds.filter(isValidId).map(id => parseInt(id));
        let query = { ...getTenantFilter(req), id: { in: validIds }, isActive: true };

        if (req.user.role === 'teacher') { 
            query.teacherId = parseInt(req.user.id); 
            query.status = { not: 'approved' };
        }

        let deleted = 0; let softDeleted = 0; let notFound = validIds.length;

        if (force && ['admin', 'superadmin'].includes(req.user.role)) {
            const approvedRecords = await prisma.continuousAssessment.findMany({ 
                where: { ...getTenantFilter(req), id: { in: validIds }, status: 'approved', isActive: true } 
            });
            
            if (approvedRecords.length > 0) {
                const approvedIds = approvedRecords.map(r => r.id);
                const softDeleteResult = await prisma.continuousAssessment.updateMany({ 
                    where: { ...getTenantFilter(req), id: { in: approvedIds } }, 
                    data: { isActive: false } 
                });
                softDeleted = softDeleteResult.count;
            }
        }

        const deleteResult = await prisma.continuousAssessment.deleteMany({ where: query });
        deleted = deleteResult.count;
        notFound = validIds.length - deleted - softDeleted;

        res.json({ success: true, message: 'Bulk delete completed.', data: { summary: { requested: assessmentIds.length, validIds: validIds.length, deleted, softDeleted, notFound } } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET - Get student's score summary by class
exports.getClassScoreSummary = async (req, res) => {
    try {
        const { classId } = req.params;
        const { termId, sessionId, subjectId } = req.query;

        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        if (!isValidId(classId)) return res.status(400).json({ success: false, message: 'Invalid class ID format.' });

        const parsedClassId = parseInt(classId);
        const tenantFilter = getTenantFilter(req);
        const resolved = await resolveTermAndSession(termId, sessionId, req);
        
        const query = { ...tenantFilter, classId: parsedClassId, isActive: true };
        if (resolved.termId) query.termId = resolved.termId;
        if (resolved.sessionId) query.sessionId = resolved.sessionId;
        if (subjectId && isValidId(subjectId)) query.subjectId = parseInt(subjectId);

        const assessments = await prisma.continuousAssessment.findMany({ where: query });
        const populatedAssessments = await populateAssessmentRelations(assessments);

        const studentSummaries = {};
        populatedAssessments.forEach(a => {
            const studentId = a.studentId?._id?.toString(); 
            if (!studentId) return;
            
            if (!studentSummaries[studentId]) studentSummaries[studentId] = { 
                studentId: a.studentId._id, firstName: a.studentId?.firstName, lastName: a.studentId?.lastName, 
                admissionNumber: a.studentId?.admissionNumber, subjects: [], totalScore: 0, subjectCount: 0, subjectsWithScores: 0 
            };
            
            const summary = studentSummaries[studentId];
            summary.subjects.push({ 
                subjectId: a.subjectId?._id, subjectName: a.subjectId?.name, subjectCode: a.subjectId?.code, 
                testScore: a.testScore || 0, noteTakingScore: a.noteTakingScore || 0, assignmentScore: a.assignmentScore || 0, 
                totalCA: a.totalCA || 0, examScore: a.examScore || 0, totalScore: a.totalScore || 0, grade: a.grade || '', status: a.status 
            });
            
            if (a.totalScore > 0) { 
                summary.totalScore += a.totalScore; 
                summary.subjectCount++; 
                summary.subjectsWithScores++; 
            }
        });

        const students = Object.values(studentSummaries).map(s => ({ ...s, averageScore: s.subjectCount > 0 ? Math.round((s.totalScore / s.subjectCount) * 100) / 100 : 0 }));
        students.sort((a, b) => b.averageScore - a.averageScore);
        students.forEach((student, index) => { student.position = index + 1; });

        const scoredStudents = students.filter(s => s.subjectCount > 0);
        const classAverage = scoredStudents.length > 0 ? Math.round((scoredStudents.reduce((sum, s) => sum + s.averageScore, 0) / scoredStudents.length) * 100) / 100 : 0;
        
        const classInfo = await prisma.class.findFirst({ where: { ...tenantFilter, id: parsedClassId } });

        res.json({ success: true, data: { 
            class: classInfo ? { id: classInfo.id, name: classInfo.name, level: classInfo.level, section: classInfo.section, fullName: `${classInfo.name} ${classInfo.section || ''}`.trim() } : null, 
            term: { id: resolved.termId, name: resolved.termName }, session: { id: resolved.sessionId, name: resolved.sessionName }, 
            students, 
            classStatistics: { 
                totalStudents: students.length, studentsWithScores: scoredStudents.length, classAverage, 
                highestAverage: scoredStudents.length > 0 ? scoredStudents[0].averageScore : 0, 
                lowestAverage: scoredStudents.length > 0 ? scoredStudents[scoredStudents.length - 1].averageScore : 0 
            } 
        }});
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};