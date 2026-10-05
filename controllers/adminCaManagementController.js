const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// GET /admin/ca/filter-options
exports.getFilterOptions = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { termId, sessionId, classId } = req.query;
        const tenantFilter = getTenantFilter(req);

        const matchStage = { ...tenantFilter, isActive: true };
        if (termId && isValidId(termId)) matchStage.termId = parseInt(termId);
        if (sessionId && isValidId(sessionId)) matchStage.sessionId = parseInt(sessionId);
        if (classId && isValidId(classId)) matchStage.classId = parseInt(classId);

        // 1. Subjects Aggregation
        const subjectAgg = await prisma.continuousAssessment.groupBy({
            by: ['subjectId'],
            where: matchStage,
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } }
        });

        const subjectIds = subjectAgg.map(s => s.subjectId);
        const populatedSubjects = await prisma.subject.findMany({ 
            where: { ...tenantFilter, id: { in: subjectIds } }, 
            select: { id: true, name: true, code: true, classLevel: true } 
        });

        const subjectsWithOptions = populatedSubjects.map(sub => ({
            _id: sub.id, name: sub.name, code: sub.code, classLevel: sub.classLevel,
            submissionCount: subjectAgg.find(s => s.subjectId === sub.id)?._count.id || 0
        }));

        // 2. Classes Aggregation
        const classAgg = await prisma.continuousAssessment.groupBy({
            by: ['classId'],
            where: matchStage,
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } }
        });

        const classIds = classAgg.map(c => c.classId);
        const populatedClasses = await prisma.class.findMany({ 
            where: { ...tenantFilter, id: { in: classIds } }, 
            select: { id: true, name: true, level: true, section: true } 
        });

        const classesWithOptions = populatedClasses.map(cls => ({
            _id: cls.id, name: cls.name, level: cls.level, section: cls.section,
            submissionCount: classAgg.find(c => c.classId === cls.id)?._count.id || 0
        }));

        // 3. Status Aggregation
        const statusAgg = await prisma.continuousAssessment.groupBy({
            by: ['status'],
            where: matchStage,
            _count: { id: true }
        });
        
        const statusMap = { draft: 0, submitted: 0, approved: 0 };
        statusAgg.forEach(s => { if (s.status && statusMap.hasOwnProperty(s.status)) statusMap[s.status] = s._count.id; });

        res.json({ success: true, data: { subjects: subjectsWithOptions, classes: classesWithOptions, statusCounts: statusMap } });
    } catch (error) {
        console.error('[ADMIN CA FILTER OPTIONS] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET /admin/ca/assessments
exports.getAssessments = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { termId, sessionId, classId, subjectId, teacherId, status, search, page = 1, limit = 50 } = req.query;
        const query = { ...getTenantFilter(req), isActive: true };

        if (termId && isValidId(termId)) query.termId = parseInt(termId);
        if (sessionId && isValidId(sessionId)) query.sessionId = parseInt(sessionId);
        if (classId && isValidId(classId)) query.classId = parseInt(classId);
        if (subjectId && isValidId(subjectId)) query.subjectId = parseInt(subjectId);
        if (teacherId && isValidId(teacherId)) query.teacherId = parseInt(teacherId);
        if (status) query.status = status;

        if (search) {
            const students = await prisma.student.findMany({ 
                where: {
                    ...getTenantFilter(req),
                    OR: [
                        { firstName: { contains: search, mode: 'insensitive' } }, 
                        { lastName: { contains: search, mode: 'insensitive' } }, 
                        { admissionNumber: { contains: search, mode: 'insensitive' } }
                    ] 
                },
                select: { id: true }
            });
            
            if (students.length > 0) query.studentId = { in: students.map(s => s.id) };
            else return res.json({ success: true, data: [], pagination: { total: 0, pages: 0 } });
        }

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

        if (assessments.length === 0) {
            return res.json({ success: true, data: [], pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, pages: 0 } });
        }

        // Fetch relations in parallel
        const studentIds = [...new Set(assessments.map(a => a.studentId))];
        const classIds = [...new Set(assessments.map(a => a.classId))];
        const subjectIds = [...new Set(assessments.map(a => a.subjectId))];
        const termIds = [...new Set(assessments.map(a => a.termId))];
        const sessionIds = [...new Set(assessments.map(a => a.sessionId))];
        const teacherIds = [...new Set(assessments.map(a => a.teacherId))];
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
        const maps = {
            student: mapById(students), class: mapById(classes), subject: mapById(subjects),
            term: mapById(terms), session: mapById(sessions), teacher: mapById(teachers), approver: mapById(approvers)
        };

        const populatedAssessments = assessments.map(a => ({
            ...a,
            studentId: maps.student.get(a.studentId) || null,
            classId: maps.class.get(a.classId) || null,
            subjectId: maps.subject.get(a.subjectId) || null,
            termId: maps.term.get(a.termId) || null,
            sessionId: maps.session.get(a.sessionId) || null,
            teacherId: maps.teacher.get(a.teacherId) || null,
            approvedBy: a.approvedBy ? maps.approver.get(a.approvedBy) || null : null,
        }));

        res.json({ success: true, data: populatedAssessments, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
    } catch (error) {
        console.error('[ADMIN CA ASSESSMENTS] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// PATCH /admin/ca/clear-approval-status
exports.clearApprovalStatus = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const { classId, subjectId, termId, sessionId, resetTo, studentIds } = req.body;
        if (!classId || !subjectId) return res.status(400).json({ success: false, message: 'classId and subjectId are required.' });

        const targetStatus = resetTo || 'draft';
        if (!['draft', 'submitted'].includes(targetStatus)) return res.status(400).json({ success: false, message: 'Invalid resetTo value.' });

        const query = { 
            ...getTenantFilter(req), 
            classId: parseInt(classId), 
            subjectId: parseInt(subjectId), 
            status: 'approved', 
            isActive: true 
        };
        
        if (termId && isValidId(termId)) query.termId = parseInt(termId);
        if (sessionId && isValidId(sessionId)) query.sessionId = parseInt(sessionId);
        if (studentIds?.length > 0) query.studentId = { in: studentIds.filter(isValidId).map(id => parseInt(id)) };

        const updateResult = await prisma.continuousAssessment.updateMany({ 
            where: query, 
            data: { 
                status: targetStatus, 
                approvedBy: null, 
                approvedAt: null 
            } 
        });

        res.json({ success: true, message: `Successfully cleared approval for ${updateResult.count} CA record(s).`, data: { recordsAffected: updateResult.count, nowInStatus: updateResult.count } });
    } catch (error) {
        console.error('[CLEAR CA APPROVAL] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// PATCH /admin/ca/clear-approval-status/by-ids
exports.clearApprovalStatusByIds = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const { assessmentIds, resetTo } = req.body;
        const targetStatus = resetTo || 'draft';
        const validIds = assessmentIds.filter(isValidId).map(id => parseInt(id));

        const query = { 
            ...getTenantFilter(req), 
            id: { in: validIds }, 
            status: 'approved', 
            isActive: true 
        };

        const updateResult = await prisma.continuousAssessment.updateMany({ 
            where: query, 
            data: { 
                status: targetStatus, 
                approvedBy: null, 
                approvedAt: null 
            } 
        });

        res.json({ success: true, message: `Successfully cleared approval for ${updateResult.count} record(s).`, data: { recordsAffected: updateResult.count, resetTo: targetStatus } });
    } catch (error) {
        console.error('[CLEAR CA BY IDS] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET /admin/ca/clear-approval-status/preview
exports.previewClearApprovalStatus = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const { classId, subjectId, termId, sessionId } = req.query;
        if (!classId || !subjectId) return res.status(400).json({ success: false, message: 'classId and subjectId are required.' });

        const query = { 
            ...getTenantFilter(req), 
            classId: parseInt(classId), 
            subjectId: parseInt(subjectId), 
            status: 'approved', 
            isActive: true 
        };
        
        if (termId && isValidId(termId)) query.termId = parseInt(termId);
        if (sessionId && isValidId(sessionId)) query.sessionId = parseInt(sessionId);

        const records = await prisma.continuousAssessment.findMany({
            where: query,
            select: { studentId: true, totalScore: true, grade: true, termId: true, sessionId: true, teacherId: true }
        });

        if (records.length === 0) return res.json({ success: true, data: { totalRecords: 0, students: [] } });

        const [students, terms, sessions, teachers] = await Promise.all([
            prisma.student.findMany({ where: { id: { in: records.map(r => r.studentId) } } }),
            prisma.term.findMany({ where: { id: { in: records.map(r => r.termId) } } }),
            prisma.session.findMany({ where: { id: { in: records.map(r => r.sessionId) } } }),
            prisma.teacher.findMany({ where: { id: { in: records.map(r => r.teacherId) } } })
        ]);

        const studentMap = new Map(students.map(s => [s.id, s]));
        
        // Sort by student lastName, then firstName
        records.sort((a, b) => {
            const sA = studentMap.get(a.studentId);
            const sB = studentMap.get(b.studentId);
            if (!sA || !sB) return 0;
            if (sA.lastName !== sB.lastName) return sA.lastName.localeCompare(sB.lastName);
            return sA.firstName.localeCompare(sB.firstName);
        });

        const responseData = records.map(r => {
            const student = studentMap.get(r.studentId);
            return {
                studentId: r.studentId,
                name: student ? `${student.lastName} ${student.firstName}` : 'Unknown',
                admissionNumber: student?.admissionNumber,
                totalScore: r.totalScore,
                grade: r.grade
            };
        });

        res.json({ success: true, data: { totalRecords: records.length, students: responseData } });
    } catch (error) {
        console.error('[CLEAR CA PREVIEW] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET /admin/ca/classes-with-approved
exports.getClassesWithApproved = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const { termId, sessionId } = req.query;
        const tenantFilter = getTenantFilter(req);
        
        const matchQuery = { ...tenantFilter, status: 'approved', isActive: true };
        if (termId && isValidId(termId)) matchQuery.termId = parseInt(termId);
        if (sessionId && isValidId(sessionId)) matchQuery.sessionId = parseInt(sessionId);

        const groupedByClass = await prisma.continuousAssessment.groupBy({
            by: ['classId'],
            where: matchQuery,
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } }
        });
        
        if (groupedByClass.length === 0) return res.json({ success: true, data: [], meta: { totalClasses: 0 } });

        const classIds = groupedByClass.map(c => c.classId);

        // Fetch classes and the unique subjects for them
        const [classes, caRecordsForSubjects] = await Promise.all([
            prisma.class.findMany({ 
                where: { ...tenantFilter, id: { in: classIds }, isActive: true }, 
                select: { id: true, name: true, level: true, section: true, session: true } 
            }),
            prisma.continuousAssessment.findMany({
                where: matchQuery,
                select: { classId: true, subjectId: true }
            })
        ]);

        const classesMap = new Map(classes.map(c => [c.id, c]));
        
        // Calculate unique subjects per class using JS Sets
        const uniqueSubjectsMap = new Map();
        caRecordsForSubjects.forEach(record => {
            if (!uniqueSubjectsMap.has(record.classId)) {
                uniqueSubjectsMap.set(record.classId, new Set());
            }
            uniqueSubjectsMap.get(record.classId).add(record.subjectId);
        });

        const responseData = groupedByClass.map(group => {
            const classData = classesMap.get(group.classId);
            if (!classData) return null;
            return {
                classId: classData.id,
                className: `${classData.name} ${classData.section || ''}`.trim(),
                classLevel: classData.level,
                classSession: classData.session,
                approvedRecords: group._count.id,
                uniqueSubjects: uniqueSubjectsMap.get(classData.id)?.size || 0
            };
        }).filter(Boolean);

        // Sort by className
        responseData.sort((a, b) => a.className.localeCompare(b.className));

        res.json({ success: true, data: responseData, meta: { totalClasses: responseData.length } });
    } catch (error) {
        console.error('[CLASSES WITH APPROVED] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET /admin/ca/classes/:classId/subjects-with-approved
exports.getSubjectsInClassWithApproved = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const classId = parseInt(req.params.classId);
        if (isNaN(classId)) return res.status(400).json({ success: false, message: 'Invalid classId format.' });

        const { termId, sessionId } = req.query;
        const tenantFilter = getTenantFilter(req);
        const matchQuery = { ...tenantFilter, classId, status: 'approved', isActive: true };

        if (termId && isValidId(termId)) matchQuery.termId = parseInt(termId);
        if (sessionId && isValidId(sessionId)) matchQuery.sessionId = parseInt(sessionId);

        const groupedBySubject = await prisma.continuousAssessment.groupBy({
            by: ['subjectId'],
            where: matchQuery,
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } }
        });

        if (groupedBySubject.length === 0) return res.json({ success: true, data: [], meta: { totalSubjects: 0 } });

        const subjectIds = groupedBySubject.map(s => s.subjectId);

        const [subjects, caRecordsForStudents] = await Promise.all([
            prisma.subject.findMany({ 
                where: { ...tenantFilter, id: { in: subjectIds } }, 
                select: { id: true, name: true, code: true, classLevel: true } 
            }),
            prisma.continuousAssessment.findMany({
                where: matchQuery,
                select: { subjectId: true, studentId: true }
            })
        ]);

        const subjectsMap = new Map(subjects.map(s => [s.id, s]));

        // Calculate unique students per subject using JS Sets
        const uniqueStudentsMap = new Map();
        caRecordsForStudents.forEach(record => {
            if (!uniqueStudentsMap.has(record.subjectId)) {
                uniqueStudentsMap.set(record.subjectId, new Set());
            }
            uniqueStudentsMap.get(record.subjectId).add(record.studentId);
        });

        const responseData = groupedBySubject.map(group => {
            const subjectData = subjectsMap.get(group.subjectId);
            if (!subjectData) return null;
            return {
                subjectId: subjectData.id,
                subjectName: subjectData.name,
                subjectCode: subjectData.code,
                classLevel: subjectData.classLevel,
                approvedRecords: group._count.id,
                uniqueStudents: uniqueStudentsMap.get(subjectData.id)?.size || 0
            };
        }).filter(Boolean);

        // Sort by subjectName
        responseData.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

        res.json({ success: true, data: responseData, meta: { totalSubjects: responseData.length } });
    } catch (error) {
        console.error('[SUBJECTS WITH APPROVED] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};