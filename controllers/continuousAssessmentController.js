const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to safely get Admin ID
const getAdminId = (req) => req.user.role === 'admin' ? parseInt(req.user.id) : parseInt(req.user.adminId);

// Helper: Calculate grade based on grading system
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

// GET - Get CA entries
exports.getCAs = async (req, res) => {
    try {
        const query = { ...getTenantFilter(req), isActive: true };
        if (req.user.role === 'teacher') query.teacherId = parseInt(req.user.id);

        const assessments = await prisma.continuousAssessment.findMany({
            where: query,
            orderBy: { createdAt: 'desc' }
        });

        if (assessments.length === 0) return res.json({ success: true, data: [] });

        // Fetch related data in parallel (replaces Mongoose .populate)
        const studentIds = [...new Set(assessments.map(a => a.studentId))];
        const classIds = [...new Set(assessments.map(a => a.classId))];
        const subjectIds = [...new Set(assessments.map(a => a.subjectId))];
        const termIds = [...new Set(assessments.map(a => a.termId))];
        const sessionIds = [...new Set(assessments.map(a => a.sessionId))];
        const teacherIds = [...new Set(assessments.map(a => a.teacherId))];

        const [students, classes, subjects, terms, sessions, teachers] = await Promise.all([
            prisma.student.findMany({ where: { id: { in: studentIds } } }),
            prisma.class.findMany({ where: { id: { in: classIds } } }),
            prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
            prisma.term.findMany({ where: { id: { in: termIds } } }),
            prisma.session.findMany({ where: { id: { in: sessionIds } } }),
            prisma.teacher.findMany({ where: { id: { in: teacherIds } } })
        ]);

        // Create Maps for fast lookup
        const mapById = (arr) => new Map(arr.map(item => [item.id, item]));
        const studentMap = mapById(students);
        const classMap = mapById(classes);
        const subjectMap = mapById(subjects);
        const termMap = mapById(terms);
        const sessionMap = mapById(sessions);
        const teacherMap = mapById(teachers);

        // Attach relations manually
        const populatedAssessments = assessments.map(a => ({
            ...a,
            studentId: studentMap.get(a.studentId) || null,
            classId: classMap.get(a.classId) || null,
            subjectId: subjectMap.get(a.subjectId) || null,
            termId: termMap.get(a.termId) || null,
            sessionId: sessionMap.get(a.sessionId) || null,
            teacherId: teacherMap.get(a.teacherId) || null,
        }));

        res.json({ success: true, data: populatedAssessments });
    } catch (error) {
        console.error('Error fetching continuous assessments:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET - Classes and subjects teacher can upload CA for
exports.getTeacherCAEligible = async (req, res) => {
    try {
        if (req.user.role !== 'teacher') return res.status(403).json({ success: false, message: 'Access denied. Teacher role required.' });

        const assignments = await prisma.teacherAssignment.findMany({ 
            where: { ...getTenantFilter(req), teacherId: parseInt(req.user.id), isActive: true } 
        });

        if (assignments.length === 0) {
            return res.json({ success: true, data: [], message: 'No class-subject assignments found. Contact admin.' });
        }
        
        const classIds = [...new Set(assignments.map(a => a.classId))];
        const subjectIds = [...new Set(assignments.map(a => a.subjectId))];

        const [classes, subjects] = await Promise.all([
            prisma.class.findMany({ where: { id: { in: classIds } } }),
            prisma.subject.findMany({ where: { id: { in: subjectIds } } })
        ]);

        const classMap = new Map(classes.map(c => [c.id, c]));
        const subjectMap = new Map(subjects.map(s => [s.id, s]));

        const groupedByClass = {};
        for (const assignment of assignments) {
            const classData = classMap.get(assignment.classId);
            if (!classData) continue;

            if (!groupedByClass[assignment.classId]) {
                groupedByClass[assignment.classId] = {
                    classId: assignment.classId,
                    className: classData.name,
                    classLevel: classData.level,
                    classSection: classData.section,
                    classSession: classData.session,
                    subjects: []
                };
            }
            
            const subjectData = subjectMap.get(assignment.subjectId);
            groupedByClass[assignment.classId].subjects.push({
                subjectId: assignment.subjectId,
                subjectName: subjectData?.name || 'Unknown',
                subjectCode: subjectData?.code || 'N/A',
                assignmentId: assignment.id
            });
        }

        const result = Object.values(groupedByClass);
        res.json({ success: true, data: result, message: `Found ${result.length} class(es) with ${assignments.length} subject assignment(s)` });
    } catch (error) {
        console.error('[TEACHER CA ELIGIBLE] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET - Students in a class for CA upload
exports.getTeacherCAStudents = async (req, res) => {
    try {
        if (req.user.role !== 'teacher') return res.status(403).json({ success: false, message: 'Access denied. Teacher role required.' });

        const classId = parseInt(req.params.classId);
        const subjectId = parseInt(req.params.subjectId);
        const { termId, sessionId } = req.query;
        const tenantFilter = getTenantFilter(req);

        const assignment = await prisma.teacherAssignment.findFirst({ 
            where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId, subjectId, isActive: true } 
        });
        if (!assignment) return res.status(403).json({ success: false, message: 'Access denied. You are not assigned to this class and subject.' });

        const students = await prisma.student.findMany({ 
            where: { ...tenantFilter, classId, isDeleted: { not: true } },
            select: { id: true, firstName: true, lastName: true, admissionNumber: true, gender: true },
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
        });

        if (students.length === 0) return res.json({ success: true, data: [], classInfo: null, subjectInfo: null, message: 'No students found in this class.' });

        const classInfo = await prisma.class.findUnique({ where: { id: classId } });
        const subjectInfo = await prisma.subject.findUnique({ where: { id: subjectId } });

        let term = termId 
            ? await prisma.term.findFirst({ where: { ...tenantFilter, id: parseInt(termId) } }) 
            : await prisma.term.findFirst({ where: { ...tenantFilter, status: 'active', isActive: true } });
            
        if (!term) term = await prisma.term.findFirst({ where: { ...tenantFilter, isActive: true }, orderBy: { startDate: 'desc' } });

        let session = sessionId 
            ? await prisma.session.findFirst({ where: { ...tenantFilter, id: parseInt(sessionId) } }) 
            : (term?.sessionId ? await prisma.session.findFirst({ where: { ...tenantFilter, id: term.sessionId } }) : null);
            
        if (!session) session = await prisma.session.findFirst({ where: { ...tenantFilter, isActive: true }, orderBy: { name: 'desc' } });

        const studentIds = students.map(s => s.id);
        const existingCA = await prisma.continuousAssessment.findMany({ 
            where: { ...tenantFilter, studentId: { in: studentIds }, classId, subjectId, termId: term?.id || 0, sessionId: session?.id || 0 } 
        });
        
        const caMap = {};
        existingCA.forEach(ca => caMap[ca.studentId] = ca);

        const studentsWithCA = students.map(student => {
            const existing = caMap[student.id];
            return {
                studentId: student.id,
                firstName: student.firstName,
                lastName: student.lastName,
                admissionNumber: student.admissionNumber,
                gender: student.gender,
                existingCA: existing ? {
                    id: existing.id, testScore: existing.testScore, noteTakingScore: existing.noteTakingScore, assignmentScore: existing.assignmentScore, totalCA: existing.totalCA, examScore: existing.examScore, totalScore: existing.totalScore, grade: existing.grade, remark: existing.remark, status: existing.status
                } : null
            };
        });

        res.json({
            success: true, data: studentsWithCA, classInfo, subjectInfo,
            termInfo: term ? { id: term.id, name: term.name, status: term.status } : null,
            sessionInfo: session ? { id: session.id, name: session.name } : null,
            stats: { totalStudents: students.length, withExistingCA: existingCA.length, withoutCA: students.length - existingCA.length }
        });
    } catch (error) {
        console.error('[TEACHER CA STUDENTS] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// POST - Upload CA for single student
exports.uploadCA = async (req, res) => {
    try {
        if (req.user.role !== 'teacher') return res.status(403).json({ success: false, message: 'Access denied. Teacher role required.' });

        const { studentId, classId, subjectId, termId, sessionId, testScore, noteTakingScore, assignmentScore, examScore } = req.body;
        if (!studentId || !classId || !subjectId || !termId || !sessionId) return res.status(400).json({ success: false, message: 'Student, Class, Subject, Term, and Session are required.' });

        const tenantFilter = getTenantFilter(req);
        const adminId = getAdminId(req);

        const assignment = await prisma.teacherAssignment.findFirst({ 
            where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: parseInt(classId), subjectId: parseInt(subjectId), isActive: true } 
        });
        if (!assignment) return res.status(403).json({ success: false, message: 'Access denied. You are not assigned to this class and subject combination.' });

        const student = await prisma.student.findFirst({ 
            where: { ...tenantFilter, id: parseInt(studentId), classId: parseInt(classId) } 
        });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found or not enrolled in this class.' });

        const validateScore = (score, max) => score === undefined || score === null ? 0 : Math.min(Math.max(Number(score) || 0, 0), max);
        const vTest = validateScore(testScore, 20);
        const vNote = validateScore(noteTakingScore, 10);
        const vAssign = validateScore(assignmentScore, 10);
        const vExam = validateScore(examScore, 60);

        const totalCA = vTest + vNote + vAssign;
        const totalScore = totalCA + vExam;
        
        const { grade, remark } = await calculateGrade(totalScore, adminId); 

        const existingCA = await prisma.continuousAssessment.findFirst({ 
            where: { ...tenantFilter, studentId: parseInt(studentId), subjectId: parseInt(subjectId), termId: parseInt(termId), sessionId: parseInt(sessionId) } 
        });

        if (existingCA && existingCA.status === 'approved') {
            return res.status(400).json({ success: false, message: 'Cannot modify approved assessment. Contact admin.' });
        }

        let assessment;
        if (existingCA) {
            assessment = await prisma.continuousAssessment.update({
                where: { id: existingCA.id },
                data: {
                    testScore: vTest, noteTakingScore: vNote, assignmentScore: vAssign,
                    totalCA, examScore: vExam, totalScore,
                    grade, remark, teacherId: parseInt(req.user.id),
                    classId: parseInt(classId), status: 'draft'
                }
            });
        } else {
            assessment = await prisma.continuousAssessment.create({
                data: {
                    ...tenantFilter,
                    studentId: parseInt(studentId), classId: parseInt(classId), subjectId: parseInt(subjectId), 
                    termId: parseInt(termId), sessionId: parseInt(sessionId), teacherId: parseInt(req.user.id),
                    testScore: vTest, noteTakingScore: vNote, assignmentScore: vAssign, totalCA,
                    examScore: vExam, totalScore, grade, remark, status: 'draft'
                }
            });
        }

        // Re-fetch with populated data
        const [stu, cls, sub, ter, ses] = await Promise.all([
            prisma.student.findUnique({ where: { id: assessment.studentId } }),
            prisma.class.findUnique({ where: { id: assessment.classId } }),
            prisma.subject.findUnique({ where: { id: assessment.subjectId } }),
            prisma.term.findUnique({ where: { id: assessment.termId } }),
            prisma.session.findUnique({ where: { id: assessment.sessionId } })
        ]);

        const populatedAssessment = {
            ...assessment,
            studentId: stu,
            classId: cls,
            subjectId: sub,
            termId: ter,
            sessionId: ses
        };

        res.status(200).json({ success: true, message: 'CA uploaded successfully', data: populatedAssessment });
    } catch (error) {
        console.error('[TEACHER CA UPLOAD] Error:', error);
        if (error.code === 'P2002') return res.status(400).json({ success: false, message: 'CA already exists for this student and subject.' });
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// POST - Bulk upload CA for multiple students
exports.bulkUploadCA = async (req, res) => {
    try {
        if (req.user.role !== 'teacher') return res.status(403).json({ success: false, message: 'Access denied. Teacher role required.' });

        const { classId, subjectId, termId, sessionId, assessments } = req.body;
        if (!classId || !subjectId || !termId || !sessionId || !assessments || !Array.isArray(assessments)) {
            return res.status(400).json({ success: false, message: 'Missing required fields.' });
        }

        const tenantFilter = getTenantFilter(req);
        const adminId = getAdminId(req);

        // Verify teacher assignment
        const assignment = await prisma.teacherAssignment.findFirst({ 
            where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId: parseInt(classId), subjectId: parseInt(subjectId), isActive: true } 
        });
        if (!assignment) return res.status(403).json({ success: false, message: 'Access denied. You are not assigned to this class and subject combination.' });

        const validateScore = (score, max) => score === undefined || score === null ? 0 : Math.min(Math.max(Number(score) || 0, 0), max);
        let created = 0, updated = 0, failed = 0;
        const errors = [];

        for (let i = 0; i < assessments.length; i++) {
            const ass = assessments[i];
            try {
                if (!ass.studentId) { errors.push({ index: i, message: 'Missing studentId' }); failed++; continue; }
                const parsedStudentId = parseInt(ass.studentId);

                const vTest = validateScore(ass.testScore, 20);
                const vNote = validateScore(ass.noteTakingScore, 10);
                const vAssign = validateScore(ass.assignmentScore, 10);
                const vExam = validateScore(ass.examScore, 60);

                const totalCA = vTest + vNote + vAssign;
                const totalScore = totalCA + vExam;
                const { grade, remark } = await calculateGrade(totalScore, adminId);

                const existingCA = await prisma.continuousAssessment.findFirst({ 
                    where: { ...tenantFilter, studentId: parsedStudentId, classId: parseInt(classId), subjectId: parseInt(subjectId), termId: parseInt(termId), sessionId: parseInt(sessionId) } 
                });

                if (existingCA && existingCA.status === 'approved') {
                    errors.push({ index: i, studentId: ass.studentId, message: 'Cannot modify approved assessment.' });
                    failed++;
                    continue;
                }

                if (existingCA) {
                    await prisma.continuousAssessment.update({
                        where: { id: existingCA.id },
                        data: { testScore: vTest, noteTakingScore: vNote, assignmentScore: vAssign, totalCA, examScore: vExam, totalScore, grade, remark, status: 'draft' }
                    });
                    updated++;
                } else {
                    await prisma.continuousAssessment.create({
                        data: { ...tenantFilter, studentId: parsedStudentId, classId: parseInt(classId), subjectId: parseInt(subjectId), termId: parseInt(termId), sessionId: parseInt(sessionId), teacherId: parseInt(req.user.id), testScore: vTest, noteTakingScore: vNote, assignmentScore: vAssign, totalCA, examScore: vExam, totalScore, grade, remark, status: 'draft' }
                    });
                    created++;
                }
            } catch (err) {
                errors.push({ index: i, message: err.message });
                failed++;
            }
        }

        res.status(200).json({ success: true, message: `Bulk upload completed. Created: ${created}, Updated: ${updated}, Failed: ${failed}.`, data: { summary: { created, updated, failed, total: assessments.length }, errors } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// PUT - Submit CA for approval
exports.submitForApproval = async (req, res) => {
    try {
        if (req.user.role !== 'teacher') return res.status(403).json({ success: false, message: 'Access denied. Teacher role required.' });

        const classId = parseInt(req.params.classId);
        const subjectId = parseInt(req.params.subjectId);
        const { termId, sessionId } = req.body;
        const tenantFilter = getTenantFilter(req);

        // Verify teacher assignment
        const assignment = await prisma.teacherAssignment.findFirst({ 
            where: { ...tenantFilter, teacherId: parseInt(req.user.id), classId, subjectId, isActive: true } 
        });
        if (!assignment) return res.status(403).json({ success: false, message: 'Access denied. You are not assigned to this class and subject.' });

        // Update all draft CAs for this class/subject/term/session to 'submitted'
        const result = await prisma.continuousAssessment.updateMany({
            where: { 
                ...tenantFilter, 
                classId, 
                subjectId, 
                termId: parseInt(termId), 
                sessionId: parseInt(sessionId), 
                status: 'draft',
                isActive: true 
            },
            data: { 
                status: 'submitted'
                // Removed submittedAt: new Date() because it doesn't exist in your schema
            }
        });

        res.json({ success: true, message: `${result.count} draft assessment(s) submitted for approval`, data: { submitted: result.count } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};