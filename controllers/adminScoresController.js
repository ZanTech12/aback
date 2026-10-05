const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to safely get Admin ID
const getAdminId = (req) => req.user.role === 'admin' ? req.user.id : req.user.adminId;

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to calculate grade locally
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
    
    // Prisma stores arrays as JSON. We parse it to loop through.
    const grades = gradingSystem.grades || [];
    const gradeEntry = grades.find(g => score >= g.minScore && score <= g.maxScore);
    return gradeEntry ? { grade: gradeEntry.grade, remark: gradeEntry.remark || '' } : { grade: 'F', remark: 'Poor' };
};

exports.requireAdmin = (req, res, next) => {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
    }
    next();
};

exports.getStudentAcademicProfile = async (req, res) => {
    try {
        const { studentId } = req.params;
        const { termId, sessionId } = req.query;
        const tenantFilter = getTenantFilter(req);

        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });

        const student = await prisma.student.findFirst({ 
            where: { ...tenantFilter, id: parseInt(studentId), isDeleted: { not: true } } 
        });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found or has been deleted.' });

        // Fetch class separately since we didn't use Prisma relations
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

        let session = null;
        if (term?.sessionId) {
            session = await prisma.session.findFirst({ where: { ...tenantFilter, id: term.sessionId } });
        }
        if (sessionId && isValidId(sessionId)) {
            const foundSession = await prisma.session.findFirst({ where: { ...tenantFilter, id: parseInt(sessionId) } });
            if (foundSession) session = foundSession;
        }

        if (!term || !session) return res.status(400).json({ success: false, message: 'No valid term or session found.' });
        const resolved = { termId: term.id, termName: term.name, sessionId: session.id, sessionName: session.name };

        const classSubjects = classData?.subjects || [];
        const populatedSubjects = await prisma.subject.findMany({ 
            where: { ...tenantFilter, id: { in: classSubjects } }, 
            select: { id: true, name: true, code: true, classLevel: true },
            orderBy: { name: 'asc' } 
        });

        const assessments = await prisma.continuousAssessment.findMany({ 
            where: { ...tenantFilter, studentId: student.id, termId: resolved.termId, sessionId: resolved.sessionId, isActive: true } 
        });

        // Fetch relations for assessments
        const subjectIds = assessments.map(a => a.subjectId);
        const teacherIds = assessments.map(a => a.teacherId);
        const approverIds = assessments.map(a => a.approvedBy).filter(Boolean);

        const [assSubjects, assClasses, assTeachers, assApprovers] = await Promise.all([
            prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
            prisma.class.findMany({ where: { id: { in: assessments.map(a => a.classId) } } }),
            prisma.teacher.findMany({ where: { id: { in: teacherIds } } }),
            prisma.admin.findMany({ where: { id: { in: approverIds } } })
        ]);

        const subjectMap = new Map(assSubjects.map(s => [s.id, s]));
        const classMap = new Map(assClasses.map(c => [c.id, c]));
        const teacherMap = new Map(assTeachers.map(t => [t.id, t]));
        const approverMap = new Map(assApprovers.map(a => [a.id, a]));

        // Sort assessments by subject name manually
        assessments.sort((a, b) => {
            const sA = subjectMap.get(a.subjectId)?.name || '';
            const sB = subjectMap.get(b.subjectId)?.name || '';
            return sA.localeCompare(sB);
        });

        const subjectsWithScores = populatedSubjects.map(subject => {
            const assessment = assessments.find(a => a.subjectId === subject.id);
            return { 
                subjectId: subject.id, subjectName: subject.name, subjectCode: subject.code, classLevel: subject.classLevel, 
                hasScore: !!assessment, 
                assessment: assessment ? { 
                    id: assessment.id, testScore: assessment.testScore || 0, noteTakingScore: assessment.noteTakingScore || 0, 
                    assignmentScore: assessment.assignmentScore || 0, totalCA: assessment.totalCA || 0, examScore: assessment.examScore || 0, 
                    totalScore: assessment.totalScore || 0, grade: assessment.grade || '', remark: assessment.remark || '', status: assessment.status || 'draft' 
                } : null 
            };
        });

        const scoredAssessments = assessments.filter(a => a.totalScore > 0);
        const totalScore = scoredAssessments.reduce((sum, a) => sum + a.totalScore, 0);
        const averageScore = scoredAssessments.length > 0 ? Math.round((totalScore / scoredAssessments.length) * 100) / 100 : 0;

        res.json({ 
            success: true, 
            data: { 
                student: { 
                    _id: student.id, firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber, 
                    classId: student.classId, className: classData ? `${classData.name} ${classData.section || ''}`.trim() : 'Not Assigned' 
                }, 
                termInfo: { id: resolved.termId, name: resolved.termName }, 
                sessionInfo: { id: resolved.sessionId, name: resolved.sessionName }, 
                subjects: subjectsWithScores, 
                summary: { totalSubjects: populatedSubjects.length, subjectsWithScores: scoredAssessments.length, totalScore, averageScore } 
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getStudentScores = async (req, res) => {
    try {
        const { studentId } = req.params;
        const { classId, subjectId, termId, sessionId, status, page = 1, limit = 100 } = req.query;
        const tenantFilter = getTenantFilter(req);

        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });

        const student = await prisma.student.findFirst({ 
            where: { ...tenantFilter, id: parseInt(studentId), isDeleted: { not: true } } 
        });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

        let term = null;
        if (termId && isValidId(termId)) term = await prisma.term.findFirst({ where: { ...tenantFilter, id: parseInt(termId) } });
        if (!term) term = await prisma.term.findFirst({ where: { ...tenantFilter, status: 'active', isActive: true } });
        if (!term) term = await prisma.term.findFirst({ where: { ...tenantFilter, isActive: true }, orderBy: { startDate: 'desc' } });

        let session = null;
        if (term?.sessionId) session = await prisma.session.findFirst({ where: { ...tenantFilter, id: term.sessionId } });
        if (sessionId && isValidId(sessionId)) {
            const foundSession = await prisma.session.findFirst({ where: { ...tenantFilter, id: parseInt(sessionId) } });
            if (foundSession) session = foundSession;
        }

        const query = { ...tenantFilter, studentId: parseInt(studentId), isActive: true };
        if (term) query.termId = term.id;
        if (session) query.sessionId = session.id;
        if (classId) query.classId = parseInt(classId);
        if (subjectId) query.subjectId = parseInt(subjectId);
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const [assessments, total] = await Promise.all([
            prisma.continuousAssessment.findMany({
                where: query,
                orderBy: { updatedAt: 'desc' },
                skip: skip,
                take: take
            }),
            prisma.continuousAssessment.count({ where: query })
        ]);

        // Fetch populated data
        const subjectIds = [...new Set(assessments.map(a => a.subjectId))];
        const classIds = [...new Set(assessments.map(a => a.classId))];
        const termIds = [...new Set(assessments.map(a => a.termId))];
        const sessionIds = [...new Set(assessments.map(a => a.sessionId))];
        const teacherIds = [...new Set(assessments.map(a => a.teacherId))];
        const approverIds = [...new Set(assessments.map(a => a.approvedBy).filter(Boolean))];

        const [subjects, classes, terms, sessions, teachers, approvers] = await Promise.all([
            prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
            prisma.class.findMany({ where: { id: { in: classIds } } }),
            prisma.term.findMany({ where: { id: { in: termIds } } }),
            prisma.session.findMany({ where: { id: { in: sessionIds } } }),
            prisma.teacher.findMany({ where: { id: { in: teacherIds } } }),
            prisma.admin.findMany({ where: { id: { in: approverIds } } })
        ]);

        const mapById = (arr) => new Map(arr.map(item => [item.id, item]));
        const maps = {
            subject: mapById(subjects), class: mapById(classes), term: mapById(terms),
            session: mapById(sessions), teacher: mapById(teachers), approver: mapById(approvers)
        };

        const populatedAssessments = assessments.map(a => ({
            ...a,
            classId: maps.class.get(a.classId) || null,
            subjectId: maps.subject.get(a.subjectId) || null,
            termId: maps.term.get(a.termId) || null,
            sessionId: maps.session.get(a.sessionId) || null,
            teacherId: maps.teacher.get(a.teacherId) || null,
            approvedBy: a.approvedBy ? maps.approver.get(a.approvedBy) || null : null,
        }));

        res.json({ 
            success: true, 
            data: { 
                student: { _id: student.id, firstName: student.firstName, lastName: student.lastName, admissionNumber: student.admissionNumber }, 
                assessments: populatedAssessments 
            }, 
            pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.editScores = async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const tenantFilter = getTenantFilter(req);
        const adminId = getAdminId(req);

        if (!isValidId(assessmentId)) return res.status(400).json({ success: false, message: 'Invalid assessment ID format.' });

        const assessment = await prisma.continuousAssessment.findFirst({ where: { ...tenantFilter, id: parseInt(assessmentId) } });
        if (!assessment) return res.status(404).json({ success: false, message: 'Assessment record not found.' });
        if (!assessment.isActive) return res.status(400).json({ success: false, message: 'This assessment record has been deactivated.' });

        const { testScore, noteTakingScore, assignmentScore, examScore, status } = req.body;
        const validateScore = (score, max) => score === undefined || score === null ? null : Math.min(Math.max(Number(score) || 0, 0), max);

        const dataToUpdate = {};
        if (testScore !== undefined) dataToUpdate.testScore = validateScore(testScore, 20);
        if (noteTakingScore !== undefined) dataToUpdate.noteTakingScore = validateScore(noteTakingScore, 10);
        if (assignmentScore !== undefined) dataToUpdate.assignmentScore = validateScore(assignmentScore, 10);
        if (examScore !== undefined) dataToUpdate.examScore = validateScore(examScore, 60);

        const fTest = dataToUpdate.testScore !== null ? dataToUpdate.testScore : (assessment.testScore || 0);
        const fNote = dataToUpdate.noteTakingScore !== null ? dataToUpdate.noteTakingScore : (assessment.noteTakingScore || 0);
        const fAssign = dataToUpdate.assignmentScore !== null ? dataToUpdate.assignmentScore : (assessment.assignmentScore || 0);
        const fExam = dataToUpdate.examScore !== null ? dataToUpdate.examScore : (assessment.examScore || 0);

        dataToUpdate.totalCA = fTest + fNote + fAssign;
        dataToUpdate.totalScore = dataToUpdate.totalCA + fExam;
        
        const { grade, remark } = await calculateGrade(dataToUpdate.totalScore, adminId);
        dataToUpdate.grade = grade; 
        dataToUpdate.remark = remark;

        if (status === 'approved') { 
            dataToUpdate.status = 'approved'; 
            dataToUpdate.approvedBy = parseInt(req.user.id); 
            dataToUpdate.approvedAt = new Date(); 
        } else if (status) { 
            dataToUpdate.status = status; 
            if (status === 'draft') { 
                dataToUpdate.approvedBy = null; 
                dataToUpdate.approvedAt = null; 
            } 
        }

        const updatedAssessment = await prisma.continuousAssessment.update({
            where: { id: parseInt(assessmentId) },
            data: dataToUpdate
        });

        res.json({ success: true, message: 'Scores updated successfully.', data: updatedAssessment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.upsertCA = async (req, res) => {
    try {
        const { studentId, classId, subjectId, termId, sessionId, teacherId, testScore, noteTakingScore, assignmentScore, examScore, status } = req.body;
        const tenantFilter = getTenantFilter(req);
        const adminId = getAdminId(req);

        if (!studentId || !classId || !subjectId || !termId || !sessionId) return res.status(400).json({ success: false, message: 'Missing required fields.' });

        const validateScore = (score, max) => score === undefined || score === null ? 0 : Math.min(Math.max(Number(score) || 0, 0), max);
        const finalTestScore = validateScore(testScore, 20);
        const finalNoteScore = validateScore(noteTakingScore, 10);
        const finalAssignScore = validateScore(assignmentScore, 10);
        const finalExamScore = validateScore(examScore, 60);

        const totalCA = finalTestScore + finalNoteScore + finalAssignScore;
        const totalScore = totalCA + finalExamScore;
        
        const { grade, remark } = await calculateGrade(totalScore, adminId);

        const existing = await prisma.continuousAssessment.findFirst({ 
            where: { ...tenantFilter, studentId: parseInt(studentId), classId: parseInt(classId), subjectId: parseInt(subjectId), termId: parseInt(termId), sessionId: parseInt(sessionId) } 
        });

        let assessment, action;

        const dataPayload = {
            testScore: finalTestScore, noteTakingScore: finalNoteScore, assignmentScore: finalAssignScore,
            totalCA, examScore: finalExamScore, totalScore, grade, remark
        };

        if (teacherId) dataPayload.teacherId = parseInt(teacherId);

        if (status === 'approved') { 
            dataPayload.status = 'approved'; 
            dataPayload.approvedBy = parseInt(req.user.id); 
            dataPayload.approvedAt = new Date(); 
        } else if (status) { 
            dataPayload.status = status; 
        } else {
            dataPayload.status = 'draft';
        }

        if (existing) {
            assessment = await prisma.continuousAssessment.update({
                where: { id: existing.id },
                data: dataPayload
            });
            action = 'updated';
        } else {
            assessment = await prisma.continuousAssessment.create({
                data: {
                    ...tenantFilter,
                    studentId: parseInt(studentId), classId: parseInt(classId), subjectId: parseInt(subjectId), 
                    termId: parseInt(termId), sessionId: parseInt(sessionId), 
                    ...dataPayload
                }
            });
            action = 'created';
        }

        res.status(action === 'created' ? 201 : 200).json({ success: true, message: `Assessment ${action} successfully.`, data: assessment });
    } catch (error) {
        if (error.code === 'P2002') return res.status(400).json({ success: false, message: 'An assessment already exists for this combination. Use PUT instead.' });
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.bulkEditScores = async (req, res) => {
    try {
        const { termId, sessionId, classId, subjectId, edits, approveAfterEdit } = req.body;
        const tenantFilter = getTenantFilter(req);
        const adminId = getAdminId(req);

        if (!termId || !sessionId || !subjectId || !edits || !Array.isArray(edits)) return res.status(400).json({ success: false, message: 'Missing required fields.' });

        const validateScore = (score, max) => score === undefined || score === null ? null : Math.min(Math.max(Number(score) || 0, 0), max);
        const results = []; const errors = []; let created = 0; let updated = 0; let failed = 0;

        for (let i = 0; i < edits.length; i++) {
            const edit = edits[i];
            try {
                const testScore = validateScore(edit.testScore, 20);
                const noteScore = validateScore(edit.noteTakingScore, 10);
                const assignScore = validateScore(edit.assignmentScore, 10);
                const examScore = validateScore(edit.examScore, 60);

                let studentClassId = classId ? parseInt(classId) : null;
                if (!studentClassId) {
                    const studentData = await prisma.student.findFirst({ where: { ...tenantFilter, id: parseInt(edit.studentId) }, select: { classId: true } });
                    studentClassId = studentData?.classId;
                }

                const existing = await prisma.continuousAssessment.findFirst({ 
                    where: { ...tenantFilter, studentId: parseInt(edit.studentId), classId: studentClassId, subjectId: parseInt(subjectId), termId: parseInt(termId), sessionId: parseInt(sessionId) } 
                });

                const finalTestScore = testScore !== null ? testScore : (existing?.testScore || 0);
                const finalNoteScore = noteScore !== null ? noteScore : (existing?.noteTakingScore || 0);
                const finalAssignScore = assignScore !== null ? assignScore : (existing?.assignmentScore || 0);
                const finalExamScore = examScore !== null ? examScore : (existing?.examScore || 0);

                const totalCA = finalTestScore + finalNoteScore + finalAssignScore;
                const totalScore = totalCA + finalExamScore;
                
                const { grade, remark } = await calculateGrade(totalScore, adminId);
                const finalStatus = edit.status || (existing?.status || 'draft');

                const dataPayload = {
                    testScore: finalTestScore, noteTakingScore: finalNoteScore, assignmentScore: finalAssignScore,
                    totalCA, examScore: finalExamScore, totalScore, grade, remark
                };

                if (approveAfterEdit || finalStatus === 'approved') {
                    dataPayload.status = 'approved';
                    dataPayload.approvedBy = parseInt(req.user.id);
                    dataPayload.approvedAt = new Date();
                } else {
                    dataPayload.status = finalStatus;
                }

                if (existing) {
                    await prisma.continuousAssessment.update({
                        where: { id: existing.id },
                        data: dataPayload
                    });
                    updated++;
                } else {
                    await prisma.continuousAssessment.create({
                        data: {
                            ...tenantFilter,
                            studentId: parseInt(edit.studentId), classId: studentClassId, subjectId: parseInt(subjectId), 
                            termId: parseInt(termId), sessionId: parseInt(sessionId),
                            ...dataPayload
                        }
                    });
                    created++;
                }
            } catch (err) {
                errors.push({ index: i, studentId: edit.studentId, message: err.message }); failed++;
            }
        }

        res.json({ success: true, message: `Bulk edit completed. Created: ${created}, Updated: ${updated}, Failed: ${failed}.`, data: { summary: { created, updated, failed, total: edits.length }, errors } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.searchStudents = async (req, res) => {
    try {
        const { q, limit = 20 } = req.query;
        if (!q || q.trim().length < 2) return res.status(400).json({ success: false, message: 'Search query must be at least 2 characters.' });

        const students = await prisma.student.findMany({
            where: {
                ...getTenantFilter(req),
                isDeleted: { not: true },
                OR: [
                    { firstName: { contains: q, mode: 'insensitive' } }, 
                    { lastName: { contains: q, mode: 'insensitive' } }, 
                    { admissionNumber: { contains: q, mode: 'insensitive' } }
                ]
            },
            take: parseInt(limit)
        });

        if (students.length === 0) return res.json({ success: true, data: [] });

        const classIds = [...new Set(students.map(s => s.classId).filter(Boolean))];
        const classes = await prisma.class.findMany({ where: { id: { in: classIds } } });
        const classMap = new Map(classes.map(c => [c.id, c]));

        const responseData = students.map(s => ({
            _id: s.id,
            firstName: s.firstName,
            lastName: s.lastName,
            admissionNumber: s.admissionNumber,
            classId: s.classId,
            className: s.classId && classMap.has(s.classId) ? `${classMap.get(s.classId).name} ${classMap.get(s.classId).section || ''}`.trim() : 'Not Assigned'
        }));

        // Sort manually since Prisma can't sort by a related field's property directly
        responseData.sort((a, b) => {
            if (a.lastName !== b.lastName) return a.lastName.localeCompare(b.lastName);
            return a.firstName.localeCompare(b.firstName);
        });

        res.json({ success: true, data: responseData });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.forceDeleteCA = async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const tenantFilter = getTenantFilter(req);

        if (!isValidId(assessmentId)) return res.status(400).json({ success: false, message: 'Invalid assessment ID format.' });

        const assessment = await prisma.continuousAssessment.findFirst({ where: { ...tenantFilter, id: parseInt(assessmentId) } });
        if (!assessment) return res.status(404).json({ success: false, message: 'Assessment record not found.' });

        // Fetch relations for response message
        const [student, subject] = await Promise.all([
            prisma.student.findUnique({ where: { id: assessment.studentId }, select: { firstName: true, lastName: true } }),
            prisma.subject.findUnique({ where: { id: assessment.subjectId }, select: { name: true } })
        ]);

        await prisma.continuousAssessment.delete({ where: { id: parseInt(assessmentId) } });

        res.json({ success: true, message: `Assessment record deleted for ${student?.firstName || 'Unknown'} (${subject?.name || 'Unknown'}).` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};