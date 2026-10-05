const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Compute status + timeRemaining for a schedule
const computeScheduleStatus = (schedule, now = new Date()) => {
    const startTime = new Date(schedule.resultStartTime);
    const deadline = new Date(schedule.resultDeadline);

    if (!schedule.isActive) return { currentStatus: 'inactive', timeRemaining: null };

    if (now < startTime) {
        const diff = startTime - now;
        return {
            currentStatus: 'before_start',
            timeRemaining: {
                days: Math.floor(diff / (1000 * 60 * 60 * 24)),
                hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
                minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
                total: diff,
            },
        };
    }
    if (now > deadline) return { currentStatus: 'deadline_passed', timeRemaining: null };

    const diff = deadline - now;
    return {
        currentStatus: 'active',
        timeRemaining: {
            days: Math.floor(diff / (1000 * 60 * 60 * 24)),
            hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
            minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
            total: diff,
        },
    };
};

// Helper to populate Term and Session relations manually
const populateScheduleRelations = async (schedules) => {
    if (!schedules) return null;
    const scheduleArray = Array.isArray(schedules) ? schedules : [schedules];
    if (scheduleArray.length === 0) return Array.isArray(schedules) ? [] : null;

    const termIds = [...new Set(scheduleArray.map(s => s.termId).filter(Boolean))];
    const sessionIds = [...new Set(scheduleArray.map(s => s.sessionId).filter(Boolean))];

    const [terms, sessions] = await Promise.all([
        termIds.length ? prisma.term.findMany({ where: { id: { in: termIds } } }) : Promise.resolve([]),
        sessionIds.length ? prisma.session.findMany({ where: { id: { in: sessionIds } } }) : Promise.resolve([])
    ]);

    const termMap = new Map(terms.map(t => [t.id, t]));
    const sessionMap = new Map(sessions.map(s => [s.id, s]));

    const mapped = scheduleArray.map(s => {
        // ✅ status + timeRemaining attached to every row (frontend table reads these)
        const { currentStatus, timeRemaining } = computeScheduleStatus(s);
        return {
            ...s,
            _id: s.id, // ✅ frontend reads schedule._id
            termId: s.termId ? { ...termMap.get(s.termId), _id: s.termId } : null,
            sessionId: s.sessionId ? { ...sessionMap.get(s.sessionId), _id: s.sessionId } : null,
            currentStatus,
            timeRemaining,
        };
    });

    return Array.isArray(schedules) ? mapped : mapped[0];
};

// Resolve the owning adminId for create (tenant filter may be empty for superadmin)
const resolveAdminId = async (req) => {
    const tenantFilter = getTenantFilter(req);
    if (tenantFilter.adminId != null) return Number(tenantFilter.adminId);
    if (req.user.role === 'admin') {
        const id = req.user.adminId ?? req.user.id;
        if (id != null) return Number(id);
    }
    // superadmin fallback: first existing schedule's admin, else first admin
    const existing = await prisma.resultAccessSchedule.findFirst({ select: { adminId: true } });
    if (existing) return existing.adminId;
    const firstAdmin = await prisma.admin.findFirst({ select: { id: true } });
    return firstAdmin?.id ?? null;
};

// GET /result-schedules/current  (frontend: resultScheduleAPI.getCurrent)
exports.getSchedule = async (req, res) => {
    try {
        const { termId, includeInactive } = req.query;
        const query = { ...getTenantFilter(req) };
        
        if (termId && isValidId(termId)) query.termId = parseInt(termId);
        if (!includeInactive || includeInactive === 'false') query.isActive = true;

        let schedule = await prisma.resultAccessSchedule.findFirst({ where: query });

        if (!schedule && !termId) {
            const activeTerm = await prisma.term.findFirst({ 
                where: { ...getTenantFilter(req), status: 'active', isActive: true } 
            });
            if (activeTerm) {
                schedule = await prisma.resultAccessSchedule.findFirst({ 
                    where: { ...getTenantFilter(req), termId: activeTerm.id, isActive: true } 
                });
            }
        }

        let currentStatus = 'no_schedule';
        let timeRemaining = null;
        
        if (schedule) {
            const computed = computeScheduleStatus(schedule);
            currentStatus = computed.currentStatus;
            timeRemaining = computed.timeRemaining;
        }

        const populatedSchedule = await populateScheduleRelations(schedule);

        res.json({ success: true, data: populatedSchedule, meta: { currentStatus, timeRemaining, currentTime: new Date() } });
    } catch (error) {
        console.error('[resultSchedule:getSchedule]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET /result-schedules  (frontend: resultScheduleAPI.getAll)
exports.getAllSchedules = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const schedules = await prisma.resultAccessSchedule.findMany({ 
            where: getTenantFilter(req), 
            orderBy: { createdAt: 'desc' } 
        });
        
        const populatedSchedules = await populateScheduleRelations(schedules);

        res.json({ success: true, data: populatedSchedules });
    } catch (error) {
        console.error('[resultSchedule:getAllSchedules]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// POST /result-schedules  (frontend: resultScheduleAPI.create)
exports.createSchedule = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const { termId, sessionId, resultStartTime, resultDeadline, message, isActive } = req.body;
        if (!termId || !sessionId || !resultStartTime || !resultDeadline) return res.status(400).json({ success: false, message: 'Term, Session, Start Time, and Deadline are required.' });

        const parsedTermId = parseInt(termId);
        const parsedSessionId = parseInt(sessionId);
        const startTime = new Date(resultStartTime);
        const deadline = new Date(resultDeadline);
        
        if (deadline <= startTime) return res.status(400).json({ success: false, message: 'Deadline must be after start time.' });

        const existingSchedule = await prisma.resultAccessSchedule.findFirst({ 
            where: { ...getTenantFilter(req), termId: parsedTermId } 
        });
        if (existingSchedule) return res.status(400).json({ success: false, message: 'A schedule already exists for this term. Please update it instead.', existingScheduleId: existingSchedule.id });

        // ✅ FIXED: resolve adminId explicitly (tenantFilter spread doesn't guarantee it)
        const adminId = await resolveAdminId(req);
        if (adminId == null) return res.status(400).json({ success: false, message: 'Could not resolve owning admin for the schedule.' });

        const newSchedule = await prisma.resultAccessSchedule.create({ 
            data: {
                adminId,
                termId: parsedTermId, 
                sessionId: parsedSessionId, 
                resultStartTime: startTime, 
                resultDeadline: deadline, 
                message: message || 'Results are not available at this time. Please check back later.', 
                isActive: isActive !== undefined ? isActive : true 
            }
        });

        const populatedSchedule = await populateScheduleRelations(newSchedule);

        res.status(201).json({ success: true, message: 'Result access schedule created successfully', data: populatedSchedule });
    } catch (error) {
        if (error.code === 'P2002') return res.status(400).json({ success: false, message: 'A schedule already exists for this term.' });
        console.error('[resultSchedule:createSchedule]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// PUT /result-schedules/:id  (frontend: resultScheduleAPI.update)
exports.updateSchedule = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid schedule ID format.' });
        const scheduleId = parseInt(req.params.id);

        const { resultStartTime, resultDeadline, message, isActive, termId, sessionId } = req.body;
        
        const schedule = await prisma.resultAccessSchedule.findFirst({ where: { ...getTenantFilter(req), id: scheduleId } });
        if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found.' });

        if (resultStartTime || resultDeadline) {
            const startTime = resultStartTime ? new Date(resultStartTime) : schedule.resultStartTime;
            const deadline = resultDeadline ? new Date(resultDeadline) : schedule.resultDeadline;
            if (deadline <= startTime) return res.status(400).json({ success: false, message: 'Deadline must be after start time.' });
        }

        const dataToUpdate = {};
        if (resultStartTime) dataToUpdate.resultStartTime = new Date(resultStartTime);
        if (resultDeadline) dataToUpdate.resultDeadline = new Date(resultDeadline);
        if (message !== undefined) dataToUpdate.message = message;
        if (isActive !== undefined) dataToUpdate.isActive = isActive;
        if (termId && isValidId(termId)) dataToUpdate.termId = parseInt(termId);
        if (sessionId && isValidId(sessionId)) dataToUpdate.sessionId = parseInt(sessionId);

        const updatedSchedule = await prisma.resultAccessSchedule.update({
            where: { id: scheduleId },
            data: dataToUpdate
        });

        const populatedSchedule = await populateScheduleRelations(updatedSchedule);

        res.json({ success: true, message: 'Result access schedule updated successfully', data: populatedSchedule });
    } catch (error) {
        console.error('[resultSchedule:updateSchedule]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// PATCH /result-schedules/:id/toggle-active  (frontend: resultScheduleAPI.toggleActive)
exports.toggleScheduleActive = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid schedule ID format.' });
        const scheduleId = parseInt(req.params.id);

        const schedule = await prisma.resultAccessSchedule.findFirst({ where: { ...getTenantFilter(req), id: scheduleId } });
        if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found.' });

        const updatedSchedule = await prisma.resultAccessSchedule.update({
            where: { id: scheduleId },
            data: { isActive: !schedule.isActive }
        });

        const populatedSchedule = await populateScheduleRelations(updatedSchedule);

        res.json({ success: true, message: `Schedule ${updatedSchedule.isActive ? 'activated' : 'deactivated'}`, data: populatedSchedule });
    } catch (error) {
        console.error('[resultSchedule:toggleScheduleActive]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// DELETE /result-schedules/:id  (frontend: resultScheduleAPI.delete)
exports.deleteSchedule = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid schedule ID format.' });
        const scheduleId = parseInt(req.params.id);

        const schedule = await prisma.resultAccessSchedule.findFirst({ where: { ...getTenantFilter(req), id: scheduleId } });
        if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found.' });

        await prisma.resultAccessSchedule.delete({ where: { id: scheduleId } });

        res.json({ success: true, message: 'Result access schedule deleted successfully' });
    } catch (error) {
        console.error('[resultSchedule:deleteSchedule]', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// GET /result-schedules/public-status?adminId=  (student-facing)
exports.getPublicResultAccessStatus = async (req, res) => {
    try {
        const { adminId } = req.query;
        const query = { isActive: true };
        if (adminId && isValidId(adminId)) query.adminId = parseInt(adminId);

        const resultStatus = { scheduleActive: false, scheduleStatus: null, scheduleDetails: null, message: null };
        const activeTerm = await prisma.term.findFirst({ where: { ...query, status: 'active' } });
        
        if (activeTerm) {
            const schedule = await prisma.resultAccessSchedule.findFirst({ where: { ...query, termId: activeTerm.id } });
            if (schedule) {
                resultStatus.scheduleActive = true;
                const now = new Date();
                const startTime = new Date(schedule.resultStartTime);
                const deadline = new Date(schedule.resultDeadline);

                let scheduleStatus = 'active';
                let timeRemaining = null;

                if (now < startTime) {
                    scheduleStatus = 'before_start';
                    const diff = startTime - now;
                    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                    timeRemaining = { days, hours, minutes };
                    
                    let timeDisplay = days > 0 ? `Results will be available in ${days} day(s) and ${hours} hour(s)` : (hours > 0 ? `Results will be available in ${hours} hour(s) and ${minutes} minute(s)` : `Results will be available in ${minutes} minute(s)`);
                    resultStatus.message = schedule.message || timeDisplay;
                } else if (now > deadline) {
                    scheduleStatus = 'deadline_passed';
                    resultStatus.message = 'The result viewing period has ended.';
                } else {
                    const diff = deadline - now;
                    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                    timeRemaining = { days, hours, minutes };
                    resultStatus.message = 'Results are currently available.';
                }
                resultStatus.scheduleStatus = scheduleStatus;
                resultStatus.scheduleDetails = { resultStartTime: schedule.resultStartTime, resultDeadline: schedule.resultDeadline, timeRemaining };
            } else {
                resultStatus.message = 'No result schedule has been set.';
            }
        } else {
            resultStatus.message = 'No active term found.';
        }

        res.json({ success: true, data: resultStatus });
    } catch (error) {
        console.error('[resultSchedule:getPublicResultAccessStatus]', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};