const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to populate Session relation for an array of terms
const populateTermRelations = async (terms) => {
    if (!terms || terms.length === 0) return [];
    const termArray = Array.isArray(terms) ? terms : [terms];

    const sessionIds = [...new Set(termArray.map(t => t.sessionId).filter(Boolean))];
    const sessions = await prisma.session.findMany({ where: { id: { in: sessionIds } } });
    
    const sessionMap = new Map(sessions.map(s => [s.id, s]));

    const mapped = termArray.map(t => ({
        ...t,
        _id: t.id, // Map _id for frontend consistency
        session: t.sessionId ? { ...sessionMap.get(t.sessionId), _id: t.sessionId } : null,
    }));

    return Array.isArray(terms) ? mapped : mapped[0];
};

// ===================================================================
// *** GET ALL TERMS ***
// ===================================================================
exports.getTerms = async (req, res) => {
    try {
        const { sessionId, status } = req.query;
        
        const query = { ...getTenantFilter(req), isActive: true };

        if (sessionId && isValidId(sessionId)) query.sessionId = parseInt(sessionId);
        if (status) query.status = status;

        const terms = await prisma.term.findMany({
            where: query,
            orderBy: { startDate: 'desc' }
        });

        const populatedTerms = await populateTermRelations(terms);

        res.json({ success: true, data: populatedTerms });
    } catch (error) {
        console.error('Error fetching terms:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** GET ACTIVE TERM ***
// ===================================================================
exports.getActiveTerm = async (req, res) => {
    try {
        const activeTerm = await prisma.term.findFirst({ 
            where: { ...getTenantFilter(req), status: 'active', isActive: true } 
        });

        if (!activeTerm) {
            return res.status(404).json({ success: false, message: 'No active term found' });
        }

        const populatedTerm = await populateTermRelations(activeTerm);

        res.json({ success: true, data: populatedTerm });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** GET SINGLE TERM ***
// ===================================================================
exports.getTermById = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid term ID format.' });
        
        const term = await prisma.term.findFirst({ 
            where: { ...getTenantFilter(req), id: parseInt(req.params.id) } 
        });
        
        if (!term) {
            return res.status(404).json({ success: false, message: 'Term not found' });
        }
        
        const populatedTerm = await populateTermRelations(term);
        
        res.json({ success: true, data: populatedTerm });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** CREATE TERM ***
// ===================================================================
exports.createTerm = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        const { name, session, startDate, endDate, nextTermBegins } = req.body;

        if (!name || !session || !startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'Name, session, start date, and end date are required.' });
        }

        if (!isValidId(session)) return res.status(400).json({ success: false, message: 'Invalid session ID format.' });
        const parsedSessionId = parseInt(session);

        const tenantFilter = getTenantFilter(req);

        const sessionExists = await prisma.session.findFirst({ where: { ...tenantFilter, id: parsedSessionId } });
        if (!sessionExists) {
            return res.status(404).json({ success: false, message: 'Session not found.' });
        }

        const existingTerm = await prisma.term.findFirst({ 
            where: { ...tenantFilter, name, sessionId: parsedSessionId, isActive: true } 
        });
        
        if (existingTerm) {
            return res.status(400).json({ success: false, message: `${name} already exists for this session.` });
        }

        const newTerm = await prisma.term.create({
            data: {
                ...tenantFilter,
                name, 
                sessionId: parsedSessionId, 
                startDate: new Date(startDate), 
                endDate: new Date(endDate), 
                nextTermBegins: nextTermBegins ? new Date(nextTermBegins) : null 
            }
        });

        const populatedTerm = await populateTermRelations(newTerm);

        res.status(201).json({ success: true, message: 'Term created successfully', data: populatedTerm });
    } catch (error) {
        console.error('Error creating term:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'This term already exists for this session.' });
        }
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** UPDATE TERM ***
// ===================================================================
exports.updateTerm = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid term ID format.' });
        const termId = parseInt(req.params.id);

        const { name, session, startDate, endDate, nextTermBegins, status, isActive } = req.body;
        const tenantFilter = getTenantFilter(req);

        const term = await prisma.term.findFirst({ where: { ...tenantFilter, id: termId } });
        if (!term) {
            return res.status(404).json({ success: false, message: 'Term not found' });
        }

        if (status === 'active' && term.status !== 'active') {
            await prisma.term.updateMany({ 
                where: { ...tenantFilter, status: 'active', NOT: { id: termId } }, 
                data: { status: 'upcoming' } 
            });
        }

        const updateData = {};
        if (name) updateData.name = name;
        if (session && isValidId(session)) updateData.sessionId = parseInt(session);
        if (startDate) updateData.startDate = new Date(startDate);
        if (endDate) updateData.endDate = new Date(endDate);
        if (nextTermBegins !== undefined) updateData.nextTermBegins = nextTermBegins ? new Date(nextTermBegins) : null;
        if (status) updateData.status = status;
        if (typeof isActive === 'boolean') updateData.isActive = isActive;

        const updatedTerm = await prisma.term.update({
            where: { id: termId },
            data: updateData
        });

        const populatedTerm = await populateTermRelations(updatedTerm);

        res.json({ success: true, message: 'Term updated successfully', data: populatedTerm });
    } catch (error) {
        console.error('Error updating term:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'This term already exists for this session.' });
        }
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** DELETE TERM (Soft Delete) ***
// ===================================================================
exports.deleteTerm = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid term ID format.' });
        const termId = parseInt(req.params.id);

        const tenantFilter = getTenantFilter(req);

        const term = await prisma.term.findFirst({ where: { ...tenantFilter, id: termId } });
        if (!term) {
            return res.status(404).json({ success: false, message: 'Term not found' });
        }

        const assessmentsCount = await prisma.continuousAssessment.count({ 
            where: { ...tenantFilter, termId: termId } 
        });
        
        if (assessmentsCount > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete term with existing student assessments.' 
            });
        }

        await prisma.term.update({
            where: { id: termId },
            data: { isActive: false }
        });
        
        res.json({ success: true, message: 'Term deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};