const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ===================================================================
// *** GET ALL GRADING SYSTEMS ***
// ===================================================================
exports.getGradingSystems = async (req, res) => {
    try {
        const gradingSystems = await prisma.gradingSystem.findMany({ 
            where: { ...getTenantFilter(req), isActive: true } 
        });
        res.json({ success: true, data: gradingSystems });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** GET DEFAULT GRADING SYSTEM ***
// ===================================================================
exports.getDefaultGradingSystem = async (req, res) => {
    try {
        const tenantFilter = getTenantFilter(req);
        
        let gradingSystem = await prisma.gradingSystem.findFirst({ 
            where: { ...tenantFilter, isDefault: true, isActive: true } 
        });
        
        if (!gradingSystem) {
            gradingSystem = await prisma.gradingSystem.findFirst({ 
                where: { ...tenantFilter, isActive: true } 
            });
        }

        if (!gradingSystem) {
            return res.status(404).json({ success: false, message: 'No grading system found' });
        }

        res.json({ success: true, data: gradingSystem });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** CREATE GRADING SYSTEM ***
// ===================================================================
exports.createGradingSystem = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        const { name, grades, isDefault } = req.body;

        if (!name || !grades || !Array.isArray(grades) || grades.length === 0) {
            return res.status(400).json({ success: false, message: 'Name and at least one grade are required.' });
        }

        for (const grade of grades) {
            if (!grade.grade || grade.minScore === undefined || grade.maxScore === undefined) {
                return res.status(400).json({ success: false, message: 'Each grade must have grade letter, minScore, and maxScore.' });
            }
            if (grade.minScore < 0 || grade.maxScore > 100 || grade.minScore > grade.maxScore) {
                return res.status(400).json({ success: false, message: 'Invalid score range. Scores must be between 0 and 100.' });
            }
        }

        const tenantFilter = getTenantFilter(req);

        // If setting as default, remove default from others (ONLY within the same school)
        if (isDefault) {
            await prisma.gradingSystem.updateMany({ 
                where: tenantFilter, 
                data: { isDefault: false } 
            });
        }

        const newGradingSystem = await prisma.gradingSystem.create({
            data: {
                ...tenantFilter,
                name, 
                grades, // Prisma saves this as JSON automatically
                isDefault: isDefault || false 
            }
        });

        res.status(201).json({ success: true, message: 'Grading system created successfully', data: newGradingSystem });
    } catch (error) {
        console.error('Error creating grading system:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'A grading system with this name already exists.' });
        }
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** UPDATE GRADING SYSTEM ***
// ===================================================================
exports.updateGradingSystem = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const gradingSystemId = parseInt(req.params.id);

        const { name, grades, isDefault, isActive } = req.body;
        const tenantFilter = getTenantFilter(req);

        if (isDefault) {
            await prisma.gradingSystem.updateMany({ 
                where: { ...tenantFilter, id: { not: gradingSystemId } }, 
                data: { isDefault: false } 
            });
        }

        const dataToUpdate = {};
        if (name) dataToUpdate.name = name;
        if (grades) dataToUpdate.grades = grades;
        if (typeof isDefault === 'boolean') dataToUpdate.isDefault = isDefault;
        if (typeof isActive === 'boolean') dataToUpdate.isActive = isActive;

        const updatedGradingSystem = await prisma.gradingSystem.update({
            where: { id: gradingSystemId },
            data: dataToUpdate
        });

        res.json({ success: true, message: 'Grading system updated successfully', data: updatedGradingSystem });
    } catch (error) {
        console.error('Error updating grading system:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, message: 'Grading system not found' });
        }
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'A grading system with this name already exists.' });
        }
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** DELETE GRADING SYSTEM (Soft Delete) ***
// ===================================================================
exports.deleteGradingSystem = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const gradingSystemId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const gradingSystem = await prisma.gradingSystem.findFirst({ 
            where: { ...tenantFilter, id: gradingSystemId } 
        });
        
        if (!gradingSystem) {
            return res.status(404).json({ success: false, message: 'Grading system not found' });
        }

        if (gradingSystem.isDefault) {
            return res.status(400).json({ success: false, message: 'Cannot delete the default grading system. Set another as default first.' });
        }

        await prisma.gradingSystem.update({
            where: { id: gradingSystemId },
            data: { isActive: false }
        });
        
        res.json({ success: true, message: 'Grading system deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};