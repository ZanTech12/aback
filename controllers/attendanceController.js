const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to safely get the Admin ID (School ID)
const getAdminId = (req) => {
    if (req.user.role === 'admin') return parseInt(req.user.id);
    if (req.user.role === 'teacher') return parseInt(req.user.adminId); 
    return null;
};

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ===================================================================
// *** SCHOOL OPEN DAYS ***
// ===================================================================
exports.getSchoolOpenDays = async (req, res) => {
    try {
        const { term_id, session_id } = req.query;
        if (!term_id || !session_id) return res.status(400).json({ success: false, message: 'term_id and session_id are required' });

        const termId = parseInt(term_id);
        const sessionId = parseInt(session_id);
        const filter = { ...getTenantFilter(req), termId, sessionId };
        
        const record = await prisma.schoolOpenDays.findFirst({ where: filter });
        if (!record) return res.json({ success: true, data: { times_open: 0, term_id: termId, session_id: sessionId } });

        res.json({ success: true, data: { id: record.id, times_open: record.timesOpen, term_id: record.termId, session_id: record.sessionId } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.upsertSchoolOpenDays = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { term_id, session_id, times_open } = req.body;
        if (!term_id || !session_id || times_open === undefined) return res.status(400).json({ success: false, message: 'term_id, session_id, and times_open are required' });

        const termId = parseInt(term_id);
        const sessionId = parseInt(session_id);
        const adminId = parseInt(req.user.id);

        // Prisma upsert requires a unique constraint. We defined @@unique([adminId, termId, sessionId]) in schema
        const record = await prisma.schoolOpenDays.upsert({
            where: { adminId_termId_sessionId: { adminId, termId, sessionId } },
            update: { timesOpen: times_open },
            create: { adminId, termId, sessionId, timesOpen: times_open }
        });

        res.status(201).json({ success: true, message: 'School open days set successfully', data: record });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.updateSchoolOpenDays = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { term_id, session_id, times_open, increment } = req.body;
        const termId = parseInt(term_id);
        const sessionId = parseInt(session_id);
        const adminId = parseInt(req.user.id);

        let data = {};
        let createData = { adminId, termId, sessionId };

        if (increment) {
            data = { timesOpen: { increment: 1 } };
            createData.timesOpen = 1;
        } else if (times_open !== undefined) {
            data = { timesOpen: times_open };
            createData.timesOpen = times_open;
        } else {
            return res.status(400).json({ success: false, message: 'Either times_open or increment must be provided' });
        }

        const record = await prisma.schoolOpenDays.upsert({
            where: { adminId_termId_sessionId: { adminId, termId, sessionId } },
            update: data,
            create: createData
        });

        res.json({ success: true, message: 'School open days updated successfully', data: record });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.deleteSchoolOpenDays = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { term_id, session_id } = req.query;
        const termId = parseInt(term_id);
        const sessionId = parseInt(session_id);
        const adminId = parseInt(req.user.id);
        
        try {
            await prisma.schoolOpenDays.delete({
                where: { adminId_termId_sessionId: { adminId, termId, sessionId } }
            });
        } catch (err) {
            if (err.code === 'P2025') return res.status(404).json({ success: false, message: 'Record not found' });
            throw err;
        }

        res.json({ success: true, message: 'School open days deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** STUDENT ATTENDANCE ***
// ===================================================================
exports.upsertAttendance = async (req, res) => {
    try {
        if (!['admin', 'superadmin', 'teacher'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied.' });

        const { student_id, class_id, term, session, times_present, teacher_id } = req.body;
        if (!student_id || !class_id || !term || !session || times_present === undefined) return res.status(400).json({ success: false, message: 'Missing required fields.' });

        const studentId = parseInt(student_id);
        const classId = parseInt(class_id);
        const adminId = getAdminId(req);
        const validTimesPresent = Math.max(0, parseInt(times_present, 10) || 0);

        if (req.user.role === 'teacher') {
            const classData = await prisma.class.findFirst({ where: { ...getTenantFilter(req), id: classId } });
            if (!classData || classData.teacherId !== parseInt(req.user.id)) {
                return res.status(403).json({ success: false, message: 'Access denied. You are not the class teacher.' });
            }
        }

        // Using upsert with the compound unique key: @@unique([adminId, studentId, classId, term, session])
        const record = await prisma.attendance.upsert({
            where: { adminId_studentId_classId_term_session: { adminId, studentId, classId, term, session } },
            update: {
                timesPresent: validTimesPresent,
                teacherId: teacher_id ? parseInt(teacher_id) : parseInt(req.user.id)
            },
            create: {
                adminId,
                studentId,
                classId,
                term,
                session,
                timesPresent: validTimesPresent,
                teacherId: teacher_id ? parseInt(teacher_id) : parseInt(req.user.id)
            }
        });

        res.json({ success: true, message: 'Attendance saved successfully', data: record });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.getStudentAttendanceCounts = async (req, res) => {
    try {
        const { classId } = req.params;
        const { term, session } = req.query;

        if (!isValidId(classId)) return res.status(400).json({ success: false, message: 'Valid class ID is required' });
        const parsedClassId = parseInt(classId);

        const adminId = getAdminId(req);
        const filter = { adminId, classId: parsedClassId };
        
        if (term) filter.term = term;
        if (session) filter.session = session;

        // Prisma groupBy replaces MongoDB aggregate pipeline
        const groupedCounts = await prisma.attendance.groupBy({
            by: ['studentId'],
            where: filter,
            _sum: { timesPresent: true }
        });

        // Map to match old mongoose output format
        const attendanceCounts = groupedCounts.map(g => ({
            student_id: g.studentId,
            times_present: g._sum.timesPresent || 0
        }));

        let schoolOpenDays = null;
        if (term && session) {
            // Find Term and Session by their names to get their IDs
            const termDoc = await prisma.term.findFirst({ where: { adminId, name: term, isActive: true } });
            const sessionDoc = await prisma.session.findFirst({ where: { adminId, name: session, isActive: true } });
            
            if (termDoc && sessionDoc) {
                const openDaysRecord = await prisma.schoolOpenDays.findFirst({ 
                    where: { adminId, termId: termDoc.id, sessionId: sessionDoc.id } 
                });
                if (openDaysRecord) schoolOpenDays = openDaysRecord.timesOpen;
            }
        }

        res.json({ success: true, data: attendanceCounts, schoolOpenDays });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch attendance counts', error: error.message });
    }
};