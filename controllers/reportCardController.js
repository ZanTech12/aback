const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// ==========================================================
// SHARED HELPERS
// ==========================================================
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

const toInt = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};

const classFullNameOf = (c) => (c ? [c.name, c.level, c.section].filter(Boolean).join(' ') : '');

const guard = (req, res) => {
    if (!['admin', 'superadmin'].includes(req.user?.role)) {
        res.status(403).json({ success: false, message: 'Access denied.' });
        return false;
    }
    return true;
};

// Position by average — ties share position
const computePositions = (rows) => {
    const sorted = [...rows].sort((a, b) => b.average - a.average);
    const map = {};
    sorted.forEach((r, idx) => {
        if (idx === 0) map[r.studentId] = 1;
        else if (r.average === sorted[idx - 1].average) map[r.studentId] = map[sorted[idx - 1].studentId];
        else map[r.studentId] = idx + 1;
    });
    return map;
};

// Fetch related Teacher/Subject objects for assessments/comments
const populateAssessmentRelations = async (records) => {
    if (!records || records.length === 0) return [];
    const subjectIds = [...new Set(records.map(a => a.subjectId).filter(Boolean))];
    const teacherIds = [...new Set(records.map(a => a.teacherId).filter(Boolean))];

    const [subjects, teachers] = await Promise.all([
        subjectIds.length ? prisma.subject.findMany({ where: { id: { in: subjectIds } } }) : Promise.resolve([]),
        teacherIds.length ? prisma.teacher.findMany({ where: { id: { in: teacherIds } } }) : Promise.resolve([]),
    ]);

    const subjectMap = new Map(subjects.map(s => [s.id, s]));
    const teacherMap = new Map(teachers.map(t => [t.id, t]));

    return records.map(a => ({
        ...a,
        subjectId: a.subjectId ? { ...subjectMap.get(a.subjectId), _id: a.subjectId } : null,
        teacherId: a.teacherId ? { ...teacherMap.get(a.teacherId), _id: a.teacherId } : null,
    }));
};

// ==========================================================
// GET /report-cards/status?termId=
// Per-class comment/remark counts (status badges)
// Returns { success, data: { [classId]: { classTeacherCommentCount,
//          teacherCommentCount, uniqueSubjectsCount } }, meta }
// ==========================================================
exports.getReportCardStatus = async (req, res) => {
    try {
        if (!guard(req, res)) return;

        const { termId } = req.query;
        if (!termId || !isValidId(termId)) return res.status(400).json({ success: false, message: 'Valid termId is required' });

        const parsedTermId = parseInt(termId);
        const tenantFilter = getTenantFilter(req);

        const term = await prisma.term.findFirst({ where: { ...tenantFilter, id: parsedTermId } });
        if (!term || !term.sessionId) return res.status(404).json({ success: false, message: 'Term or Session not found' });

        const session = await prisma.session.findFirst({ where: { ...tenantFilter, id: term.sessionId } });
        if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

        const classes = await prisma.class.findMany({
            where: { ...tenantFilter, isActive: true },
            select: { id: true }
        });
        const classIds = classes.map(c => c.id);

        if (classIds.length === 0) {
            return res.json({ success: true, data: {}, meta: { termId: parsedTermId, termName: term.name, sessionName: session.name, totalClasses: 0 } });
        }

        const classIdFilter = { in: classIds };

        const [classTeacherCommentsAgg, teacherCommentsAgg, teacherCommentsRaw] = await Promise.all([
            // ClassTeacherComment stores term/session as NAME strings (per schema)
            prisma.classTeacherComment.groupBy({
                by: ['classId'],
                where: { ...tenantFilter, classId: classIdFilter, term: term.name, session: session.name, isActive: true },
                _count: { id: true }
            }),
            // TeacherComment stores Int FKs
            prisma.teacherComment.groupBy({
                by: ['classId'],
                where: { ...tenantFilter, classId: classIdFilter, termId: parsedTermId, sessionId: session.id, isActive: true },
                _count: { id: true }
            }),
            prisma.teacherComment.findMany({
                where: { ...tenantFilter, classId: classIdFilter, termId: parsedTermId, sessionId: session.id, isActive: true },
                select: { classId: true, subjectId: true }
            })
        ]);

        // Unique subjects per class via JS Sets
        const uniqueSubjectsMap = new Map();
        teacherCommentsRaw.forEach(record => {
            if (!uniqueSubjectsMap.has(record.classId)) {
                uniqueSubjectsMap.set(record.classId, new Set());
            }
            uniqueSubjectsMap.get(record.classId).add(record.subjectId);
        });

        const statusMap = {};
        classIds.forEach(id => {
            statusMap[id] = { classTeacherCommentCount: 0, teacherCommentCount: 0, uniqueSubjectsCount: 0 };
        });

        classTeacherCommentsAgg.forEach(item => {
            if (statusMap[item.classId]) statusMap[item.classId].classTeacherCommentCount = item._count.id;
        });

        teacherCommentsAgg.forEach(item => {
            if (statusMap[item.classId]) {
                statusMap[item.classId].teacherCommentCount = item._count.id;
                statusMap[item.classId].uniqueSubjectsCount = uniqueSubjectsMap.get(item.classId)?.size || 0;
            }
        });

        res.json({
            success: true,
            data: statusMap,
            meta: { termId: parsedTermId, termName: term.name, sessionName: session.name, totalClasses: classIds.length }
        });
    } catch (error) {
        console.error('[getReportCardStatus]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};
// Alias — route/frontend expects getStatus
exports.getStatus = exports.getReportCardStatus;

// ==========================================================
// GET /report-cards/print-data?termId=&classIds=1,2,3
// Batch print payload — GROUPED shape consumed by
// ReportCardsPrintView.jsx: classes: [{ classInfo, students: [...] }]
// ==========================================================
// ==========================================================
// GET /report-cards/print-data?termId=&classIds=1,2,3
// Batch print payload — GROUPED shape consumed by
// ReportCardsPrintView.jsx: classes: [{ classInfo, students: [...] }]
// ==========================================================
exports.getPrintData = async (req, res) => {
    try {
        if (!guard(req, res)) return;

        const { termId, classIds } = req.query;
        if (!termId || !classIds) return res.status(400).json({ success: false, message: 'termId and classIds are required' });
        if (!isValidId(termId)) return res.status(400).json({ success: false, message: 'Invalid termId format.' });

        const tenantFilter = getTenantFilter(req);
        const parsedTermId = parseInt(termId);
        const parsedClassIds = classIds.split(',').map(id => parseInt(id.trim())).filter(isValidId);
        if (parsedClassIds.length === 0) return res.status(400).json({ success: false, message: 'No valid classIds provided' });

        const term = await prisma.term.findFirst({ where: { ...tenantFilter, id: parsedTermId } });
        if (!term || !term.sessionId) return res.status(404).json({ success: false, message: 'Term/Session not found' });

        const session = await prisma.session.findFirst({ where: { ...tenantFilter, id: term.sessionId } });
        if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

        // ── STEP 1: classes + students first (independent) ──
        const [classes, students] = await Promise.all([
            prisma.class.findMany({ where: { ...tenantFilter, id: { in: parsedClassIds } }, orderBy: [{ level: 'asc' }, { name: 'asc' }] }),
            prisma.student.findMany({
                where: { ...tenantFilter, classId: { in: parsedClassIds }, isDeleted: { not: true } },
                select: { id: true, firstName: true, lastName: true, admissionNumber: true, gender: true, classId: true, profileImage: true },
                orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
            })
        ]);

        // ── STEP 2: now studentIds exists — run the dependent queries ──
        const studentIds = students.map(s => s.id);
        const safeStudentIds = studentIds.length ? studentIds : [0]; // avoids `in: []` returning everything

        const [assessments, classTeacherComments, principalComments, attendanceData, schoolOpenDays, classSubjects] = await Promise.all([
            prisma.continuousAssessment.findMany({
                where: { ...tenantFilter, studentId: { in: safeStudentIds }, classId: { in: parsedClassIds }, termId: parsedTermId, sessionId: session.id, status: 'approved' }
            }),
            prisma.classTeacherComment.findMany({
                where: { ...tenantFilter, studentId: { in: safeStudentIds }, term: term.name, session: session.name, isActive: true },
                orderBy: { updatedAt: 'desc' }
            }),
            prisma.principalComment.findMany({
                where: { ...tenantFilter, studentId: { in: safeStudentIds }, termId: parsedTermId, sessionId: session.id, isActive: true },
                orderBy: { updatedAt: 'desc' }
            }),
            prisma.attendance.findMany({
                where: { ...tenantFilter, studentId: { in: safeStudentIds }, term: term.name, session: session.name }
            }),
            prisma.schoolOpenDays.findFirst({ where: { ...tenantFilter, termId: parsedTermId, sessionId: session.id } }),
            // Class.subjects is an Int[] array — flatten then fetch subject records
            prisma.subject.findMany({ where: { ...tenantFilter, id: { in: [...new Set(classes.flatMap(c => c.subjects || []))] } } })
        ]);

        // Latest comment per student (arrays pre-sorted desc by updatedAt)
        const ctcMap = new Map();
        classTeacherComments.forEach(c => { if (!ctcMap.has(c.studentId)) ctcMap.set(c.studentId, c.comment); });
        const pcMap = new Map();
        principalComments.forEach(c => { if (!pcMap.has(c.studentId)) pcMap.set(c.studentId, c.comment); });

        const attMap = new Map(attendanceData.map(a => [a.studentId, a]));

        // Subject names for all assessment subjectIds (+ class subject lists)
        const allSubjectIds = [...new Set([...assessments.map(a => a.subjectId).filter(Boolean), ...classSubjects.map(s => s.id)])];
        const suMap = new Map(classSubjects.concat(
            allSubjectIds.length ? await prisma.subject.findMany({ where: { id: { in: allSubjectIds } } }) : []
        ).map(s => [s.id, s]));

        // Group assessments: classId → studentId → subjectId → merged row
        const byClassStudentSubject = {};
        assessments.forEach(ca => {
            byClassStudentSubject[ca.classId] = byClassStudentSubject[ca.classId] || {};
            byClassStudentSubject[ca.classId][ca.studentId] = byClassStudentSubject[ca.classId][ca.studentId] || {};
            const per = byClassStudentSubject[ca.classId][ca.studentId];
            if (!per[ca.subjectId]) {
                per[ca.subjectId] = {
                    subjectId: ca.subjectId,
                    subjectIdObj: suMap.get(ca.subjectId) ? { ...suMap.get(ca.subjectId), _id: ca.subjectId } : null,
                    subjectName: suMap.get(ca.subjectId)?.name || 'Unknown',
                    testScore: ca.testScore, noteTakingScore: ca.noteTakingScore,
                    assignmentScore: ca.assignmentScore, totalCA: ca.totalCA,
                    examScore: ca.examScore, totalScore: ca.totalScore,
                    grade: ca.grade, remark: ca.remark,
                };
            }
        });

        const classesPayload = classes.map(cls => ({
            classInfo: {
                id: cls.id, _id: cls.id,
                name: cls.name, level: cls.level, section: cls.section,
                classFullName: classFullNameOf(cls),
                classTeacherId: cls.teacherId || null,
            },
            students: students
                .filter(s => s.classId === cls.id)
                .map(st => {
                    const perSubject = byClassStudentSubject[cls.id]?.[st.id] || {};
                    const subjectList = Object.values(perSubject)
                        .map(({ subjectIdObj, ...rest }) => ({ ...rest, subject: subjectIdObj }))
                        .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
                    const totalScore = subjectList.reduce((sum, s) => sum + (s.totalScore || 0), 0);
                    const att = attMap.get(st.id);
                    return {
                        student: {
                            id: st.id, _id: st.id,
                            firstName: st.firstName, lastName: st.lastName,
                            admissionNumber: st.admissionNumber, gender: st.gender,
                            classId: st.classId,
                            profileImage: st.profileImage || null,
                        },
                        subjects: subjectList,
                        statistics: {
                            totalScore,
                            averageScore: subjectList.length ? Math.round((totalScore / subjectList.length) * 100) / 100 : 0,
                            subjectCount: subjectList.length,
                        },
                        attendance: {
                            timesOpen: schoolOpenDays?.timesOpen ?? '',
                            timesPresent: att?.timesPresent ?? '',
                        },
                        classTeacherComment: ctcMap.get(st.id) || null,
                        principalComment: pcMap.get(st.id) || null,
                        psychomotor: null, // not in schema — print view falls back to defaults
                    };
                }),
        }));

        res.json({
            success: true,
            data: {
                term: { ...term, _id: term.id },
                session: { ...session, _id: session.id },
                classes: classesPayload,
                meta: {
                    totalClasses: classes.length,
                    totalStudents: students.length,
                    termId: parsedTermId, termName: term.name, sessionName: session.name,
                }
            }
        });
    } catch (error) {
        console.error('[getPrintData]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};
// ==========================================================
// GET /report-cards/class/:classId?termId=
// Class summary table (ClassReportCards.jsx)
// Returns { success, data: { class, term, session, totalStudents,
//          assessedStudents, students: [{ student, position,
//          subjectCount, totalScore, averageScore }] } }
// ==========================================================
exports.getClassReport = async (req, res) => {
    try {
        if (!guard(req, res)) return;

        const { termId } = req.query;
        if (!isValidId(termId)) return res.status(400).json({ success: false, message: 'Valid termId is required' });

        const parsedTermId = parseInt(termId);
        const cid = toInt(req.params.classId);
        if (!cid) return res.status(400).json({ success: false, message: 'Invalid classId' });

        const tenantFilter = getTenantFilter(req);

        const cls = await prisma.class.findFirst({ where: { ...tenantFilter, id: cid } });
        if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

        const term = await prisma.term.findFirst({ where: { ...tenantFilter, id: parsedTermId } });
        if (!term) return res.status(404).json({ success: false, message: 'Term not found' });
        const session = term.sessionId ? await prisma.session.findUnique({ where: { id: term.sessionId } }) : null;

        const [students, cas] = await Promise.all([
            prisma.student.findMany({
                where: { ...tenantFilter, classId: cid, isDeleted: { not: true } },
                select: { id: true, firstName: true, lastName: true, admissionNumber: true },
                orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
            }),
            prisma.continuousAssessment.findMany({
                where: { ...tenantFilter, classId: cid, termId: parsedTermId, sessionId: term.sessionId, status: 'approved', isActive: true },
                select: { studentId: true, subjectId: true, totalScore: true },
            }),
        ]);

        const byStudent = {};
        cas.forEach(ca => {
            if (!byStudent[ca.studentId]) byStudent[ca.studentId] = { subjects: new Set(), total: 0 };
            byStudent[ca.studentId].subjects.add(ca.subjectId);
            byStudent[ca.studentId].total += ca.totalScore || 0;
        });

        const rows = students.map(st => {
            const agg = byStudent[st.id];
            const subjectCount = agg ? agg.subjects.size : 0;
            const total = agg ? agg.total : 0;
            return {
                studentId: st.id,
                student: { id: st.id, _id: st.id, firstName: st.firstName, lastName: st.lastName, admissionNumber: st.admissionNumber },
                subjectCount,
                totalScore: total,
                average: subjectCount ? total / subjectCount : 0,
            };
        });

        const positions = computePositions(rows.filter(r => r.subjectCount > 0));
        const assessedCount = rows.filter(r => r.subjectCount > 0).length;

        res.json({
            success: true,
            data: {
                class: { id: cls.id, _id: cls.id, name: cls.name, section: cls.section, level: cls.level },
                term: { id: term.id, _id: term.id, name: term.name },
                session: session ? { id: session.id, _id: session.id, name: session.name } : null,
                totalStudents: students.length,
                assessedStudents: assessedCount,
                students: rows
                    .map(r => ({
                        student: r.student,
                        position: positions[r.studentId] || null,
                        subjectCount: r.subjectCount,
                        totalScore: r.totalScore,
                        averageScore: Math.round(r.average * 100) / 100,
                    }))
                    .sort((a, b) => (a.position || 9999) - (b.position || 9999)),
            }
        });
    } catch (error) {
        console.error('[getClassReport]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ==========================================================
// GET /report-cards/student/:studentId?termId=
// Single student's full report (student detail page)
// ==========================================================
exports.getStudentReport = async (req, res) => {
    try {
        if (!guard(req, res)) return;

        const { termId } = req.query;
        if (!isValidId(termId)) return res.status(400).json({ success: false, message: 'Valid termId is required' });

        const parsedTermId = parseInt(termId);
        const sid = toInt(req.params.studentId);
        if (!sid) return res.status(400).json({ success: false, message: 'Invalid studentId' });

        const tenantFilter = getTenantFilter(req);

        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: sid, isDeleted: { not: true } } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const term = await prisma.term.findFirst({ where: { ...tenantFilter, id: parsedTermId } });
        if (!term) return res.status(404).json({ success: false, message: 'Term not found' });
        const session = term.sessionId ? await prisma.session.findUnique({ where: { id: term.sessionId } }) : null;

        const [cls, cas, classmates] = await Promise.all([
            student.classId ? prisma.class.findUnique({ where: { id: student.classId } }) : Promise.resolve(null),
            prisma.continuousAssessment.findMany({
                where: { ...tenantFilter, studentId: sid, termId: parsedTermId, sessionId: term.sessionId, status: 'approved', isActive: true },
            }),
            student.classId ? prisma.continuousAssessment.findMany({
                where: { ...tenantFilter, classId: student.classId, termId: parsedTermId, sessionId: term.sessionId, status: 'approved', isActive: true },
                select: { studentId: true, subjectId: true, totalScore: true },
            }) : Promise.resolve([]),
        ]);

        const subjectIds = [...new Set(cas.map(c => c.subjectId).filter(Boolean))];
        const subjects = subjectIds.length ? await prisma.subject.findMany({ where: { id: { in: subjectIds } } }) : [];
        const suMap = new Map(subjects.map(s => [s.id, s]));

        const subjectList = cas.map(ca => ({
            subjectId: ca.subjectId,
            subjectName: suMap.get(ca.subjectId)?.name || 'Unknown',
            testScore: ca.testScore, noteTakingScore: ca.noteTakingScore,
            assignmentScore: ca.assignmentScore, totalCA: ca.totalCA,
            examScore: ca.examScore, totalScore: ca.totalScore,
            grade: ca.grade, remark: ca.remark,
        })).sort((a, b) => a.subjectName.localeCompare(b.subjectName));

        const totalScore = subjectList.reduce((sum, s) => sum + (s.totalScore || 0), 0);
        const average = subjectList.length ? totalScore / subjectList.length : 0;

        // Position among classmates (by average)
        const perStudent = {};
        classmates.forEach(ca => {
            perStudent[ca.studentId] = perStudent[ca.studentId] || { subjects: new Set(), total: 0 };
            perStudent[ca.studentId].subjects.add(ca.subjectId);
            perStudent[ca.studentId].total += ca.totalScore || 0;
        });
        const rows = Object.entries(perStudent).map(([stId, agg]) => ({
            studentId: Number(stId),
            average: agg.subjects.size ? agg.total / agg.subjects.size : 0,
        }));
        const positions = computePositions(rows);

        const [ctc, pc] = await Promise.all([
            prisma.classTeacherComment.findFirst({
                where: { ...tenantFilter, studentId: sid, term: term.name, ...(session ? { session: session.name } : {}), isActive: true },
                orderBy: { updatedAt: 'desc' },
            }),
            prisma.principalComment.findFirst({
                where: { ...tenantFilter, studentId: sid, termId: parsedTermId, sessionId: term.sessionId, isActive: true },
                orderBy: { updatedAt: 'desc' },
            }),
        ]);

        res.json({
            success: true,
            data: {
                student: {
                    id: student.id, _id: student.id,
                    firstName: student.firstName, lastName: student.lastName,
                    admissionNumber: student.admissionNumber, gender: student.gender,
                    classId: student.classId, profileImage: student.profileImage || null,
                },
                class: cls ? { id: cls.id, _id: cls.id, name: cls.name, section: cls.section, level: cls.level, classFullName: classFullNameOf(cls) } : null,
                term: { id: term.id, _id: term.id, name: term.name, startDate: term.startDate, endDate: term.endDate, nextTermBegins: term.nextTermBegins },
                session: session ? { id: session.id, _id: session.id, name: session.name } : null,
                subjects: subjectList,
                statistics: {
                    totalScore,
                    averageScore: Math.round(average * 100) / 100,
                    subjectCount: subjectList.length,
                    position: positions[sid] || null,
                },
                classTeacherComment: ctc?.comment || null,
                principalComment: pc?.comment || null,
            }
        });
    } catch (error) {
        console.error('[getStudentReport]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ==========================================================
// GET /report-cards/student-print/:studentId?termId=&sessionId=
// Single-student print/report payload (your original, kept as-is
// with a role guard added)
// ==========================================================
exports.getStudentPrintData = async (req, res) => {
    try {
        if (!guard(req, res)) return;

        const { studentId } = req.params;
        const { termId, sessionId } = req.query;
        const tenantFilter = getTenantFilter(req);

        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const parsedStudentId = parseInt(studentId);

        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: parsedStudentId } });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

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
        if (sessionId && isValidId(sessionId)) {
            session = await prisma.session.findFirst({ where: { ...tenantFilter, id: parseInt(sessionId) } });
        } else if (term?.sessionId) {
            session = await prisma.session.findFirst({ where: { ...tenantFilter, id: term.sessionId } });
        }

        if (!session) return res.status(404).json({ success: false, message: 'No session found' });

        const [assessments, teacherComments, classTeacherComment, principalComment, attendance, schoolOpenDays] = await Promise.all([
            prisma.continuousAssessment.findMany({ where: { ...tenantFilter, studentId: parsedStudentId, termId: term.id, sessionId: session.id, status: 'approved' } }),
            prisma.teacherComment.findMany({ where: { ...tenantFilter, studentId: parsedStudentId, termId: term.id, sessionId: session.id, status: 'approved' } }),
            prisma.classTeacherComment.findFirst({ where: { ...tenantFilter, studentId: parsedStudentId, term: term.name, session: session.name, isActive: true } }),
            prisma.principalComment.findFirst({ where: { ...tenantFilter, studentId: parsedStudentId, termId: term.id, sessionId: session.id, isActive: true } }),
            prisma.attendance.findFirst({ where: { ...tenantFilter, studentId: parsedStudentId, term: term.name, session: session.name } }),
            prisma.schoolOpenDays.findFirst({ where: { ...tenantFilter, termId: term.id, sessionId: session.id } })
        ]);

        const populatedAssessments = await populateAssessmentRelations(assessments);
        const populatedTeacherComments = await populateAssessmentRelations(teacherComments);

        res.json({
            success: true,
            data: {
                student: { ...student, _id: student.id, classId: classData ? { ...classData, _id: classData.id } : null },
                term: { ...term, _id: term.id },
                session: { ...session, _id: session.id },
                assessments: populatedAssessments.map(a => ({ ...a, _id: a.id })),
                teacherComments: populatedTeacherComments.map(c => ({ ...c, _id: c.id })),
                classTeacherComment: classTeacherComment ? { ...classTeacherComment, _id: classTeacherComment.id } : null,
                principalComment: principalComment ? { ...principalComment, _id: principalComment.id } : null,
                attendance: attendance ? { ...attendance, _id: attendance.id } : null,
                schoolOpenDays,
                message: "Report data generated"
            }
        });
    } catch (error) {
        console.error('[getStudentPrintData]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};
// Alias — route/frontend expects getStudentPrint
exports.getStudentPrint = exports.getStudentPrintData;