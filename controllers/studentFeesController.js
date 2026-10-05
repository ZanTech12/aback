const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

exports.getFeesSummary = async (req, res) => {
    try {
        const tenantFilter = getTenantFilter(req);
        
        // Base filter for all active (non-deleted) students
        const baseWhere = { ...tenantFilter, isDeleted: { not: true } };

        // Run all counts in parallel for maximum performance
        const [totalStudents, owingFees, feesCleared, accessGranted, accessBlocked] = await Promise.all([
            prisma.student.count({ where: baseWhere }),
            prisma.student.count({ where: { ...baseWhere, owingFees: true } }),
            prisma.student.count({ where: { ...baseWhere, owingFees: false } }),
            prisma.student.count({ where: { ...baseWhere, feesAccessGranted: true } }),
            prisma.student.count({ where: { ...baseWhere, owingFees: true, feesAccessGranted: false } })
        ]);

        res.json({
            success: true,
            data: { totalStudents, owingFees, feesCleared, accessGranted, accessBlocked }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};