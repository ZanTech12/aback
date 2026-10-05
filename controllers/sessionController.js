const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ===================================================================
// *** GET ALL SESSIONS ***
// ===================================================================
exports.getSessions = async (req, res) => {
    try {
        const sessions = await prisma.session.findMany({ 
            where: { ...getTenantFilter(req), isActive: true }, 
            orderBy: { name: 'desc' } 
        });
        
        // Map _id for frontend consistency
        const responseData = sessions.map(s => ({ ...s, _id: s.id }));
        
        res.json({ success: true, data: responseData });
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** GET SINGLE SESSION ***
// ===================================================================
exports.getSessionById = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid session ID format.' });
        
        const session = await prisma.session.findFirst({ 
            where: { ...getTenantFilter(req), id: parseInt(req.params.id) } 
        });
        
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }
        
        res.json({ success: true, data: { ...session, _id: session.id } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** CREATE SESSION ***
// ===================================================================
exports.createSession = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        const { name, startDate, endDate } = req.body;

        if (!name || !startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'Name, start date, and end date are required.' });
        }

        const tenantFilter = getTenantFilter(req);

        const existingSession = await prisma.session.findFirst({ 
            where: { ...tenantFilter, name, isActive: true } 
        });
        
        if (existingSession) {
            return res.status(400).json({ success: false, message: 'Session with this name already exists.' });
        }

        const newSession = await prisma.session.create({
            data: {
                ...tenantFilter,
                name, 
                startDate: new Date(startDate), 
                endDate: new Date(endDate)
            }
        });

        res.status(201).json({ success: true, message: 'Session created successfully', data: { ...newSession, _id: newSession.id } });
    } catch (error) {
        console.error('Error creating session:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Session with this name already exists.' });
        }
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** UPDATE SESSION ***
// ===================================================================
exports.updateSession = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid session ID format.' });
        const sessionId = parseInt(req.params.id);

        const { name, startDate, endDate, isActive } = req.body;
        const tenantFilter = getTenantFilter(req);

        const session = await prisma.session.findFirst({ where: { ...tenantFilter, id: sessionId } });
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        if (name && name !== session.name) {
            const existingSession = await prisma.session.findFirst({ 
                where: { ...tenantFilter, name, id: { not: sessionId }, isActive: true } 
            });
            if (existingSession) {
                return res.status(400).json({ success: false, message: 'Session with this name already exists.' });
            }
        }

        const updateData = {};
        if (name) updateData.name = name;
        if (startDate) updateData.startDate = new Date(startDate);
        if (endDate) updateData.endDate = new Date(endDate);
        if (typeof isActive === 'boolean') updateData.isActive = isActive;

        const updatedSession = await prisma.session.update({
            where: { id: sessionId },
            data: updateData
        });

        res.json({ success: true, message: 'Session updated successfully', data: { ...updatedSession, _id: updatedSession.id } });
    } catch (error) {
        console.error('Error updating session:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Session with this name already exists.' });
        }
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** DELETE SESSION (Soft Delete) ***
// ===================================================================
exports.deleteSession = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid session ID format.' });
        const sessionId = parseInt(req.params.id);

        const tenantFilter = getTenantFilter(req);

        const session = await prisma.session.findFirst({ where: { ...tenantFilter, id: sessionId } });
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        // Check for active terms linked to this session
        const activeTerms = await prisma.term.count({ 
            where: { ...tenantFilter, sessionId: sessionId, isActive: true } 
        });
        
        if (activeTerms > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete session with active terms. Please delete or complete all terms first.' 
            });
        }

        await prisma.session.update({
            where: { id: sessionId },
            data: { isActive: false }
        });
        
        res.json({ success: true, message: 'Session deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};