const prisma = require('../config/db');
const { Prisma } = require('@prisma/client'); // kept for any future raw queries
const { getTenantFilter } = require('../utils/helpers');

// ==========================================================
// SHARED HELPERS
// ==========================================================
const ALLOWED_RESET_TO = ['draft', 'submitted'];

const toInt = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};

const classFullNameOf = (c) => (c ? [c.name, c.level, c.section].filter(Boolean).join(' ') : '');

// ✅ NEW: Grade from total score (A 70–100, B 60–69, C 50–59, D 45–49, E 40–44, F 0–39)
const computeGrade = (total) => {
    if (total >= 70) return 'A';
    if (total >= 60) return 'B';
    if (total >= 50) return 'C';
    if (total >= 45) return 'D';
    if (total >= 40) return 'E';
    return 'F';
};

// ContinuousAssessment stores plain FK ints (no Prisma relations),
// so we batch-fetch related records and merge display fields into each row.
async function hydrateAssessments(rows) {
    if (!rows.length) return [];
    const idsOf = (key) => [...new Set(rows.map((r) => r[key]).filter((v) => v != null))];

    const [students, classes, subjects, terms, sessions] = await Promise.all([
        prisma.student.findMany({ where: { id: { in: idsOf('studentId') } } }),
        prisma.class.findMany({ where: { id: { in: idsOf('classId') } } }),
        prisma.subject.findMany({ where: { id: { in: idsOf('subjectId') } } }),
        prisma.term.findMany({ where: { id: { in: idsOf('termId') } } }),
        prisma.session.findMany({ where: { id: { in: idsOf('sessionId') } } }),
    ]);

    const sMap = new Map(students.map((x) => [x.id, x]));
    const cMap = new Map(classes.map((x) => [x.id, x]));
    const suMap = new Map(subjects.map((x) => [x.id, x]));
    const tMap = new Map(terms.map((x) => [x.id, x]));
    const seMap = new Map(sessions.map((x) => [x.id, x]));

    return rows.map((r) => {
        const st = sMap.get(r.studentId);
        const c = cMap.get(r.classId);
        const su = suMap.get(r.subjectId);
        const t = tMap.get(r.termId);
        const se = seMap.get(r.sessionId);

        const fullName = st ? `${st.firstName} ${st.lastName}`.trim() : 'Unknown';

        return {
            ...r,
            _id: r.id,

            // ── Student name: ALL common patterns covered ──
            studentName: fullName,     // a.studentName
            name: fullName,            // a.name
            firstName: st?.firstName || '',  // a.firstName
            lastName: st?.lastName || '',    // a.lastName
            admissionNumber: st?.admissionNumber || '',
            student: st ? {            // a.student.firstName (old populate shape)
                id: st.id,
                firstName: st.firstName,
                lastName: st.lastName,
                name: fullName,
                admissionNumber: st.admissionNumber,
            } : null,

            // ── Other display fields ──
            className: c?.name || '',
            classFullName: classFullNameOf(c),
            subjectName: su?.name || '',
            termName: t?.name || '',
            sessionName: se?.name || '',
        };
    });
}

// Resolve matching student IDs for search (name / admission number)
async function resolveStudentIdsForSearch(q, tenantFilter) {
    const matches = await prisma.student.findMany({
        where: {
            ...tenantFilter,
            isDeleted: false,
            OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { admissionNumber: { contains: q, mode: 'insensitive' } },
            ],
        },
        select: { id: true },
    });
    return matches.map((s) => s.id);
}

// GET /admin/ca/filter-options
exports.getFilterOptions = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });
        
        const tenantFilter = getTenantFilter(req);
        
        const activeTerm = await prisma.term.findFirst({ 
            where: { ...tenantFilter, status: 'active' } 
        });
        
        const terms = await prisma.term.findMany({ 
            where: tenantFilter, 
            orderBy: { name: 'asc' } 
        });
        
        const sessions = await prisma.session.findMany({ 
            where: tenantFilter, 
            orderBy: { name: 'desc' } 
        });
        
        const classes = await prisma.class.findMany({ 
            where: { ...tenantFilter, isActive: true }, 
            orderBy: { name: 'asc' } 
        });

        res.json({ success: true, data: { terms, sessions, classes, activeTerm } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET /admin/ca/teacher-progress
exports.getTeacherProgress = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { termId, sessionId, classId } = req.query;
        const tenantFilter = getTenantFilter(req);

        let term = termId 
            ? await prisma.term.findFirst({ where: { ...tenantFilter, id: parseInt(termId) } }) 
            : await prisma.term.findFirst({ where: { ...tenantFilter, status: 'active', isActive: true } });
            
        let session = sessionId 
            ? await prisma.session.findFirst({ where: { ...tenantFilter, id: parseInt(sessionId) } }) 
            : (term?.sessionId ? await prisma.session.findFirst({ where: { ...tenantFilter, id: term.sessionId } }) : null);

        if (!session) return res.status(400).json({ success: false, message: 'No session found.' });

        const assignmentQuery = { ...tenantFilter, isActive: true };
        if (classId) assignmentQuery.classId = parseInt(classId);

        const assignments = await prisma.teacherAssignment.findMany({ where: assignmentQuery });

        const caEntries = await prisma.continuousAssessment.findMany({ 
            where: { 
                ...tenantFilter,
                termId: term.id, 
                sessionId: session.id 
            },
            select: { teacherId: true, classId: true, subjectId: true, studentId: true, updatedAt: true, createdAt: true }
        });
        
        const caMap = {};
        caEntries.forEach(ca => {
            const key = `${ca.teacherId}::${ca.classId}::${ca.subjectId}`;
            if (!caMap[key]) caMap[key] = { students: new Set(), latestTime: null };
            caMap[key].students.add(ca.studentId.toString());
            if (ca.updatedAt > caMap[key].latestTime) caMap[key].latestTime = ca.updatedAt;
        });

        const teacherIds = [...new Set(assignments.map(a => a.teacherId))];
        const classIds = [...new Set(assignments.map(a => a.classId))];
        const subjectIds = [...new Set(assignments.map(a => a.subjectId))];

        const [teachers, classes, subjects] = await Promise.all([
            prisma.teacher.findMany({ where: { id: { in: teacherIds } } }),
            prisma.class.findMany({ where: { id: { in: classIds } } }),
            prisma.subject.findMany({ where: { id: { in: subjectIds } } })
        ]);

        const teacherMap = new Map(teachers.map(t => [t.id, { 
            teacherId: t.id, 
            teacherName: `${t.firstName} ${t.lastName}`, 
            totalAssignments: 0, 
            filledAssignments: 0, 
            subjects: [] 
        }]));

        const classMap = new Map(classes.map(c => [c.id, c]));
        const subjectMap = new Map(subjects.map(s => [s.id, s]));

        assignments.forEach(a => {
            const tData = teacherMap.get(a.teacherId);
            if (!tData || !classMap.has(a.classId) || !subjectMap.has(a.subjectId)) return;
            
            tData.totalAssignments++;
            const caKey = `${a.teacherId}::${a.classId}::${a.subjectId}`;
            const hasCA = caMap[caKey]?.students.size > 0;
            if (hasCA) tData.filledAssignments++;
            
            tData.subjects.push({ 
                classId: a.classId, 
                className: classMap.get(a.classId).name, 
                subjectId: a.subjectId, 
                subjectName: subjectMap.get(a.subjectId).name, 
                hasCA 
            });
        });

        res.json({ success: true, data: { teachers: Array.from(teacherMap.values()) } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// POST /admin/ca/bulk/approve-by-ids   body: { ids: [...] }
// Used by continuousAssessmentsAPI.bulkReapprove()
exports.bulkApproveByIds = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { ids } = req.body || {};
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: 'ids array is required' });

        const cleanIds = ids.map(Number).filter(Number.isFinite);
        if (cleanIds.length === 0) return res.status(400).json({ success: false, message: 'No valid ids provided' });

        const result = await prisma.continuousAssessment.updateMany({
            where: {
                ...getTenantFilter(req),
                id: { in: cleanIds },
                isActive: true,
            },
            data: {
                status: 'approved',
                approvedBy: parseInt(req.user.id),
                approvedAt: new Date(),
            },
        });

        res.json({
            success: true,
            message: `Approved ${result.count} of ${cleanIds.length} assessments.`,
            data: { requested: cleanIds.length, modified: result.count },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// POST /admin/ca/bulk/approve-by-filters
exports.bulkApproveByFilters = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { termId, sessionId, classId, subjectId, excludedIds } = req.body;
        const filter = { ...getTenantFilter(req), status: 'submitted', isActive: true };

        if (termId) filter.termId = parseInt(termId);
        if (sessionId) filter.sessionId = parseInt(sessionId);
        if (classId) filter.classId = parseInt(classId);
        if (subjectId) filter.subjectId = parseInt(subjectId);
        if (excludedIds?.length > 0) filter.id = { notIn: excludedIds.map(id => parseInt(id)) };

        const result = await prisma.continuousAssessment.updateMany({ 
            where: filter, 
            data: { 
                status: 'approved', 
                approvedBy: parseInt(req.user.id), 
                approvedAt: new Date() 
            } 
        });
        
        res.json({ success: true, message: `Approved ${result.count} assessments.`, data: { modified: result.count } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// POST /admin/ca/bulk/unapprove
exports.bulkUnapprove = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { ids, termId, sessionId, classId, subjectId } = req.body;
        const filter = { ...getTenantFilter(req), status: 'approved', isActive: true };

        if (ids?.length > 0) {
            filter.id = { in: ids.map(id => parseInt(id)) };
        } else {
            if (termId) filter.termId = parseInt(termId);
            if (sessionId) filter.sessionId = parseInt(sessionId);
            if (classId) filter.classId = parseInt(classId);
            if (subjectId) filter.subjectId = parseInt(subjectId);
        }

        const result = await prisma.continuousAssessment.updateMany({ 
            where: filter, 
            data: { 
                status: 'submitted', 
                approvedBy: null, 
                approvedAt: null 
            } 
        });
        
        res.json({ success: true, message: `Unapproved ${result.count} assessments.`, data: { modified: result.count } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// PUT /admin/ca/:id/approve
exports.approveCA = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const id = parseInt(req.params.id);
        const filter = { ...getTenantFilter(req), id };
        
        const assessment = await prisma.continuousAssessment.findFirst({ where: filter });
        if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

        const updatedAssessment = await prisma.continuousAssessment.update({
            where: { id },
            data: {
                status: 'approved',
                approvedBy: parseInt(req.user.id),
                approvedAt: new Date()
            }
        });

        res.json({ success: true, message: 'Assessment approved', data: updatedAssessment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// PUT /admin/ca/:id/unapprove
exports.unapproveCA = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const id = parseInt(req.params.id);
        const filter = { ...getTenantFilter(req), id };
        
        const updateResult = await prisma.continuousAssessment.updateMany({
            where: filter,
            data: { 
                status: 'submitted', 
                approvedBy: null, 
                approvedAt: null 
            }
        });

        if (updateResult.count === 0) return res.status(404).json({ success: false, message: 'Failed to unapprove assessment or not found.' });

        const updatedCA = await prisma.continuousAssessment.findUnique({ where: { id } });
        res.json({ success: true, message: 'Assessment unapproved successfully', data: updatedCA });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ==========================================================
// ✅ NEW: PUT /admin/ca/:id — edit scores
// body: { testScore?, noteTakingScore?, assignmentScore?, examScore?, status?, remark? }
// Recalculates totalCA, totalScore, grade. Rejects out-of-range values.
// Returns { success, message, data: { ...updated, _id } }
// ==========================================================
exports.updateCA = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const id = parseInt(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

        const tenantFilter = getTenantFilter(req);
        const existing = await prisma.continuousAssessment.findFirst({ where: { ...tenantFilter, id } });
        if (!existing) return res.status(404).json({ success: false, message: 'Assessment not found' });

        const { testScore, noteTakingScore, assignmentScore, examScore, status, remark } = req.body || {};

        // Reject out-of-range values (don't silently clamp)
        const outOfRange =
            (testScore       !== undefined && (Number(testScore)       < 0 || Number(testScore)       > 20)) ||
            (noteTakingScore !== undefined && (Number(noteTakingScore) < 0 || Number(noteTakingScore) > 10)) ||
            (assignmentScore !== undefined && (Number(assignmentScore) < 0 || Number(assignmentScore) > 10)) ||
            (examScore       !== undefined && (Number(examScore)       < 0 || Number(examScore)       > 60));
        if (outOfRange) {
            return res.status(400).json({ success: false, message: 'Scores out of range (Test ≤20, Notes ≤10, Assignment ≤10, Exam ≤60)' });
        }

        // Merge with existing — only provided fields change
        const newTest   = testScore        !== undefined ? Number(testScore)        || 0 : existing.testScore;
        const newNotes  = noteTakingScore  !== undefined ? Number(noteTakingScore)  || 0 : existing.noteTakingScore;
        const newAssign = assignmentScore  !== undefined ? Number(assignmentScore)  || 0 : existing.assignmentScore;
        const newExam   = examScore        !== undefined ? Number(examScore)        || 0 : existing.examScore;

        const totalCA = newTest + newNotes + newAssign;
        const totalScore = totalCA + newExam;

        const VALID_STATUSES = ['draft', 'submitted', 'approved'];
        const newStatus = (status && VALID_STATUSES.includes(status)) ? status : existing.status;

        const updated = await prisma.continuousAssessment.update({
            where: { id },
            data: {
                testScore: newTest,
                noteTakingScore: newNotes,
                assignmentScore: newAssign,
                examScore: newExam,
                totalCA,
                totalScore,
                grade: computeGrade(totalScore),
                remark: remark !== undefined ? String(remark) : existing.remark,
                status: newStatus,
            },
        });

        res.json({
            success: true,
            message: 'Score updated successfully',
            data: { ...updated, _id: updated.id },
        });
    } catch (error) {
        console.error('[updateCA]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// Temporary route to fix the count in the ACTIVE database
exports.fixStudentCount = async (req, res) => {
    try {
        const adminId = parseInt(req.params.id);
        const admin = await prisma.admin.findUnique({ where: { id: adminId } });
        
        if (!admin) return res.status(404).json({ message: 'Admin not found in this DB' });

        await prisma.admin.update({
            where: { id: adminId },
            data: { currentStudentCount: 0 }
        });

        res.json({ success: true, message: `Count reset to 0` });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// ==========================================================
// LISTING — GET /admin/ca/all
// Supports: termId, sessionId, classId, subjectId, teacherId,
//           status ('submitted'|'draft'|'approved'|'all'), search,
//           page, limit
// Returns: { success, data, total, page, limit, summary:{ total, byStatus } }
// NOTE: id is exposed as _id because the frontend uses a._id
// ==========================================================
exports.getAssessments = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { termId, sessionId, classId, subjectId, teacherId, status, search, page, limit } = req.query;
        const tenantFilter = getTenantFilter(req);

        const take = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const skip = (pageNum - 1) * take;

        const where = { ...tenantFilter, isActive: true };
        const tId = toInt(termId); if (tId) where.termId = tId;
        const seId = toInt(sessionId); if (seId) where.sessionId = seId;
        const cId = toInt(classId); if (cId) where.classId = cId;
        const suId = toInt(subjectId); if (suId) where.subjectId = suId;
        const teId = toInt(teacherId); if (teId) where.teacherId = teId;
        if (status && status !== 'all') where.status = status;

        const q = (search || '').trim();
        if (q) {
            const ids = await resolveStudentIdsForSearch(q, tenantFilter);
            where.studentId = { in: ids }; // empty array → no results (correct)
        }

        const [rows, total, statusGroups] = await prisma.$transaction([
            prisma.continuousAssessment.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
            prisma.continuousAssessment.count({ where }),
            prisma.continuousAssessment.groupBy({ by: ['status'], where, _count: { _all: true } }),
        ]);

        res.json({
            success: true,
            data: await hydrateAssessments(rows),
            total,
            page: pageNum,
            limit: take,
            summary: {
                total,
                byStatus: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
            },
        });
    } catch (err) {
        console.error('[getAssessments]', err);
        res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
};

// ==========================================================
// LISTING — GET /admin/ca/all-approved
// Always filters status='approved'. Cross-term capable.
// Returns: { success, data, total, page, limit, summary:{ total, byTerm } }
// ==========================================================
exports.getAllApproved = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { classId, subjectId, termId, sessionId, search, page, limit } = req.query;
        const tenantFilter = getTenantFilter(req);

        const take = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const skip = (pageNum - 1) * take;

        const where = { ...tenantFilter, isActive: true, status: 'approved' };
        const cId = toInt(classId); if (cId) where.classId = cId;
        const suId = toInt(subjectId); if (suId) where.subjectId = suId;
        const tId = toInt(termId); if (tId) where.termId = tId;
        const seId = toInt(sessionId); if (seId) where.sessionId = seId;

        const q = (search || '').trim();
        if (q) {
            const ids = await resolveStudentIdsForSearch(q, tenantFilter);
            where.studentId = { in: ids };
        }

        const [rows, total, termGroups] = await prisma.$transaction([
            prisma.continuousAssessment.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
            prisma.continuousAssessment.count({ where }),
            prisma.continuousAssessment.groupBy({ by: ['termId', 'sessionId'], where, _count: { _all: true } }),
        ]);

        // Hydrate term/session names for the byTerm summary (cross-term banner)
        const tIds = [...new Set(termGroups.map((g) => g.termId).filter((v) => v != null))];
        const seIds = [...new Set(termGroups.map((g) => g.sessionId).filter((v) => v != null))];
        const [terms, sessions] = await Promise.all([
            tIds.length ? prisma.term.findMany({ where: { id: { in: tIds } } }) : Promise.resolve([]),
            seIds.length ? prisma.session.findMany({ where: { id: { in: seIds } } }) : Promise.resolve([]),
        ]);
        const tMap = new Map(terms.map((x) => [x.id, x]));
        const seMap = new Map(sessions.map((x) => [x.id, x]));

        res.json({
            success: true,
            data: await hydrateAssessments(rows),
            total,
            page: pageNum,
            limit: take,
            summary: {
                total,
                byTerm: termGroups
                    .map((g) => ({
                        termId: g.termId,
                        termName: tMap.get(g.termId)?.name || '',
                        sessionId: g.sessionId,
                        sessionName: seMap.get(g.sessionId)?.name || '',
                        count: g._count._all,
                    }))
                    .sort((a, b) => (a.sessionName || '').localeCompare(b.sessionName || '') || (a.termName || '').localeCompare(b.termName || '')),
            },
        });
    } catch (err) {
        console.error('[getAllApproved]', err);
        res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
};

// ==========================================================
// GET /admin/ca/classes-with-approved?termId=&sessionId=
// Returns { success, data: [{ classId, className, classFullName, approvedRecords }] }
// ==========================================================
exports.getClassesWithApproved = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { termId, sessionId } = req.query;
        const tenantFilter = getTenantFilter(req);

        const where = { ...tenantFilter, status: 'approved', isActive: true };
        const tId = toInt(termId); if (tId) where.termId = tId;
        const seId = toInt(sessionId); if (seId) where.sessionId = seId;

        const groups = await prisma.continuousAssessment.groupBy({ by: ['classId'], where, _count: { _all: true } });

        const classIds = groups.map((g) => g.classId);
        const classes = classIds.length ? await prisma.class.findMany({ where: { id: { in: classIds } } }) : [];
        const cMap = new Map(classes.map((c) => [c.id, c]));

        const data = groups
            .map((g) => ({
                classId: g.classId,
                className: cMap.get(g.classId)?.name || 'Unknown',
                classFullName: classFullNameOf(cMap.get(g.classId)) || 'Unknown',
                approvedRecords: g._count._all,
            }))
            .sort((a, b) => a.className.localeCompare(b.className));

        res.json({ success: true, data });
    } catch (err) {
        console.error('[getClassesWithApproved]', err);
        res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
};

// ==========================================================
// GET /admin/ca/classes/:classId/subjects-with-approved?termId=&sessionId=
// Returns { success, data: [{ subjectId, subjectName, approvedRecords }] }
// ==========================================================
exports.getSubjectsWithApproved = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const cid = toInt(req.params.classId);
        if (!cid) return res.status(400).json({ success: false, message: 'Invalid classId' });

        const { termId, sessionId } = req.query;
        const tenantFilter = getTenantFilter(req);

        const where = { ...tenantFilter, status: 'approved', isActive: true, classId: cid };
        const tId = toInt(termId); if (tId) where.termId = tId;
        const seId = toInt(sessionId); if (seId) where.sessionId = seId;

        const groups = await prisma.continuousAssessment.groupBy({ by: ['subjectId'], where, _count: { _all: true } });

        const subjectIds = groups.map((g) => g.subjectId);
        const subjects = subjectIds.length ? await prisma.subject.findMany({ where: { id: { in: subjectIds } } }) : [];
        const suMap = new Map(subjects.map((s) => [s.id, s]));

        const data = groups
            .map((g) => ({
                subjectId: g.subjectId,
                subjectName: suMap.get(g.subjectId)?.name || 'Unknown',
                approvedRecords: g._count._all,
            }))
            .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

        res.json({ success: true, data });
    } catch (err) {
        console.error('[getSubjectsWithApproved]', err);
        res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
};

// ==========================================================
// GET /admin/ca/clear-approval-status/preview?classId=&subjectId=&termId=&sessionId=
// Returns { success, data: { classInfo, subjectInfo, totalRecords, students:[…] } }
// ==========================================================
exports.previewClearApproval = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { classId, subjectId, termId, sessionId } = req.query;
        const cid = toInt(classId);
        if (!cid) return res.status(400).json({ success: false, message: 'classId is required' });

        const tenantFilter = getTenantFilter(req);

        const where = { ...tenantFilter, status: 'approved', isActive: true, classId: cid };
        const suId = toInt(subjectId); if (suId) where.subjectId = suId;
        const tId = toInt(termId); if (tId) where.termId = tId;
        const seId = toInt(sessionId); if (seId) where.sessionId = seId;

        const [cas, cls, su] = await Promise.all([
            prisma.continuousAssessment.findMany({
                where,
                select: { id: true, studentId: true, totalScore: true, grade: true },
                orderBy: { createdAt: 'desc' },
            }),
            prisma.class.findUnique({ where: { id: cid } }),
            suId ? prisma.subject.findUnique({ where: { id: suId } }) : Promise.resolve(null),
        ]);

        const studentIds = [...new Set(cas.map((r) => r.studentId))];
        const students = studentIds.length ? await prisma.student.findMany({ where: { id: { in: studentIds } } }) : [];
        const sMap = new Map(students.map((s) => [s.id, s]));

        res.json({
            success: true,
            data: {
                classInfo: {
                    classId: cid,
                    className: cls?.name || 'Unknown',
                    classFullName: classFullNameOf(cls) || 'Unknown',
                },
                subjectInfo: su ? { subjectId: su.id, subjectName: su.name, name: su.name } : null,
                totalRecords: cas.length,
                students: cas.map((r) => {
                    const st = sMap.get(r.studentId);
                    return {
                        studentId: r.studentId,
                        name: st ? `${st.firstName} ${st.lastName}`.trim() : 'Unknown',
                        admissionNumber: st?.admissionNumber || '',
                        totalScore: r.totalScore,
                        grade: r.grade,
                        assessmentId: r.id,
                    };
                }),
            },
        });
    } catch (err) {
        console.error('[previewClearApproval]', err);
        res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
};

// ==========================================================
// PATCH /admin/ca/clear-approval-status
// body: { classId, subjectId?, termId?, sessionId?, resetTo }
// Returns { success, message, data: { recordsAffected, modified, resetTo, subjectInfo } }
// ==========================================================
exports.clearApprovalStatus = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { classId, subjectId, termId, sessionId } = req.body || {};
        const resetTo = ALLOWED_RESET_TO.includes(req.body?.resetTo) ? req.body.resetTo : 'draft';
        const cid = toInt(classId);
        if (!cid) return res.status(400).json({ success: false, message: 'classId is required' });

        const tenantFilter = getTenantFilter(req);

        const where = { ...tenantFilter, status: 'approved', classId: cid };
        const suId = toInt(subjectId); if (suId) where.subjectId = suId;
        const tId = toInt(termId); if (tId) where.termId = tId;
        const seId = toInt(sessionId); if (seId) where.sessionId = seId;

        const result = await prisma.continuousAssessment.updateMany({
            where,
            data: { status: resetTo, approvedBy: null, approvedAt: null },
        });

        let subjectInfo = null;
        if (suId) {
            const su = await prisma.subject.findUnique({ where: { id: suId } });
            if (su) subjectInfo = { subjectId: su.id, subjectName: su.name, name: su.name };
        }

        res.json({
            success: true,
            message: `Cleared approval for ${result.count} record(s) — reset to "${resetTo}".`,
            data: { recordsAffected: result.count, modified: result.count, resetTo, subjectInfo },
        });
    } catch (err) {
        console.error('[clearApprovalStatus]', err);
        res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
};

// ==========================================================
// PATCH /admin/ca/clear-approval-status/by-ids
// body: { assessmentIds: [...], resetTo }
// Returns { success, message, data: { requested, found, modified, resetTo } }
// ==========================================================
exports.clearApprovalByIds = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { assessmentIds, resetTo: rawReset } = req.body || {};
        const resetTo = ALLOWED_RESET_TO.includes(rawReset) ? rawReset : 'draft';
        if (!Array.isArray(assessmentIds) || assessmentIds.length === 0) {
            return res.status(400).json({ success: false, message: 'assessmentIds array is required' });
        }

        const tenantFilter = getTenantFilter(req);
        const ids = assessmentIds.map(Number).filter(Number.isFinite);

        const result = await prisma.continuousAssessment.updateMany({
            where: {
                ...tenantFilter,
                id: { in: ids },
                status: 'approved',
            },
            data: { status: resetTo, approvedBy: null, approvedAt: null },
        });

        res.json({
            success: true,
            message: `Cleared ${result.count} of ${ids.length} assessment(s) — reset to "${resetTo}".`,
            data: { requested: ids.length, found: result.count, modified: result.count, resetTo },
        });
    } catch (err) {
        console.error('[clearApprovalByIds]', err);
        res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
};