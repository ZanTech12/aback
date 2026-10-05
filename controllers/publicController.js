const prisma = require('../config/db');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ===================================================================
// *** PUBLIC ROUTES (No Auth Required) ***
// ===================================================================

// @route   GET /public/terms
// @desc    Get all active terms for public result checking
exports.getPublicTerms = async (req, res) => {
    try {
        const { sessionId, status, adminId } = req.query;
        
        const query = { isActive: true };

        // Filter by school so public users only see the correct school's terms
        if (adminId && isValidId(adminId)) query.adminId = parseInt(adminId); 
        if (sessionId && isValidId(sessionId)) query.sessionId = parseInt(sessionId);
        if (status) query.status = status;

        const terms = await prisma.term.findMany({
            where: query,
            include: {
                session: {
                    select: { name: true } // Replaces .populate('session', 'name')
                }
            },
            orderBy: { startDate: 'desc' }
        });

        // Map to include _id for frontend consistency
        const responseData = terms.map(t => ({
            ...t,
            _id: t.id,
            session: t.session ? { ...t.session, _id: t.session.id } : null
        }));

        res.json({ success: true, data: responseData });
    } catch (error) {
        console.error('Error fetching public terms:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// @route   GET /public/sessions
// @desc    Get all active sessions for public result checking
exports.getPublicSessions = async (req, res) => {
    try {
        const { adminId } = req.query;
        
        const query = { isActive: true };
        
        // Filter by school so public users only see the correct school's sessions
        if (adminId && isValidId(adminId)) query.adminId = parseInt(adminId);

        const sessions = await prisma.session.findMany({
            where: query,
            orderBy: { name: 'desc' }
        });

        // Map to include _id for frontend consistency
        const responseData = sessions.map(s => ({ ...s, _id: s.id }));

        res.json({ success: true, data: responseData });
    } catch (error) {
        console.error('Error fetching public sessions:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// @route   GET /public/site-info
// @desc    Get school information (address, motto, phone, email, website) for public display
exports.getPublicSiteInfo = async (req, res) => {
    try {
        const { adminId, schoolCode } = req.query;
        
        let query = {};

        // 1. If adminId is provided, use it
        if (adminId && isValidId(adminId)) {
            query.adminId = parseInt(adminId);
        } 
        // 2. If schoolCode is provided, find the Admin first to get their ID
        else if (schoolCode) {
            const admin = await prisma.admin.findFirst({
                where: { schoolCode: schoolCode }
            });
            if (admin) {
                query.adminId = admin.id;
            } else {
                return res.status(404).json({ success: false, message: 'School not found.' });
            }
        }

        const siteInfo = await prisma.siteInformation.findFirst({
            where: query,
            select: {
                id: true,
                schoolName: true,
                shortName: true,
                schoolMotto: true,
                address: true,
                state: true,
                country: true,
                phoneNumber: true,
                email: true,
                website: true,
                // You can also fetch the logo if needed for the public header
                schoolLogo: true 
            }
        });

        if (!siteInfo) {
            return res.status(404).json({ success: false, message: 'School information not found.' });
        }

        // Map to include _id for frontend consistency
        const responseData = { ...siteInfo, _id: siteInfo.id };

        res.json({ success: true, data: responseData });
    } catch (error) {
        console.error('Error fetching public site info:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};