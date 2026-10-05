const prisma = require('../config/db'); // 👈 Import Prisma

const resolveTermAndSession = async (termId, sessionId) => {
    try {
        let term = null;
        let session = null;

        const parsedTermId = parseInt(termId);
        const parsedSessionId = parseInt(sessionId);

        // 1. Try specified termId first
        if (termId && !isNaN(parsedTermId)) {
            term = await prisma.term.findUnique({ where: { id: parsedTermId } });
        }

        // 2. Fall back to active term
        if (!term) {
            term = await prisma.term.findFirst({ 
                where: { status: 'active', isActive: true },
                orderBy: { startDate: 'desc' }
            });
        }

        // 3. Fall back to most recent term
        if (!term) {
            term = await prisma.term.findFirst({ 
                where: { isActive: true },
                orderBy: { startDate: 'desc' }
            });
        }

        // 4. Get session
        if (sessionId && !isNaN(parsedSessionId)) {
            session = await prisma.session.findUnique({ where: { id: parsedSessionId } });
        }

        // 5. Fall back to term's session
        if (!session && term && term.sessionId) {
            session = await prisma.session.findUnique({ where: { id: term.sessionId } });
        }

        // 6. Fall back to most recent session
        if (!session) {
            session = await prisma.session.findFirst({ 
                where: { isActive: true },
                orderBy: { name: 'desc' }
            });
        }

        return {
            term,
            session,
            termId: term ? term.id : null,
            sessionId: session ? session.id : null,
            termName: term ? term.name : null,
            sessionName: session ? session.name : null
        };
    } catch (error) {
        console.error('[RESOLVE TERM/SESSION] Error:', error);
        return { term: null, session: null, termId: null, sessionId: null, termName: null, sessionName: null };
    }
};

const generateAdmissionNumber = async () => {
    const currentYear = new Date().getFullYear();
    const prefix = 'DIS';
    const searchString = `${prefix}/${currentYear}/`;
    
    const lastStudent = await prisma.student.findFirst({
        where: { admissionNumber: { startsWith: searchString } },
        orderBy: { admissionNumber: 'desc' }
    });
    
    let nextNumber = 1;
    
    if (lastStudent) {
        const parts = lastStudent.admissionNumber.split('/');
        const lastNumber = parseInt(parts[2], 10);
        if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
    
    const formattedNumber = nextNumber.toString().padStart(3, '0');
    
    return `${prefix}/${currentYear}/${formattedNumber}`;
};

// ==========================================
// MULTI-TENANT HELPER
// ==========================================
const getTenantFilter = (req) => {
    if (req.user && req.user.role === 'admin') {
        // Admins use their own ID as the adminId
        return { adminId: parseInt(req.user.id) }; 
    }
    if (req.user && (req.user.role === 'teacher' || req.user.role === 'student')) {
        // Teachers and Students use the adminId stored in their JWT token
        return { adminId: parseInt(req.user.adminId) }; 
    }
    // Superadmins or unknown roles get no filter (can see everything)
    return {};
};

module.exports = {
    resolveTermAndSession,
    generateAdmissionNumber,
    getTenantFilter 
};