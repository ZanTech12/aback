const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

exports.toggleFeesAccess = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const filter = { ...getTenantFilter(req), id: parseInt(req.params.id) };
        const student = await prisma.student.findFirst({ where: filter });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const updatedStudent = await prisma.student.update({
            where: { id: student.id },
            data: { feesAccessGranted: !student.feesAccessGranted }
        });

        res.json({ 
            success: true, 
            message: `Fees access ${updatedStudent.feesAccessGranted ? 'granted' : 'revoked'}`, 
            data: { 
                _id: updatedStudent.id, 
                firstName: updatedStudent.firstName, 
                lastName: updatedStudent.lastName, 
                admissionNumber: updatedStudent.admissionNumber, 
                owingFees: updatedStudent.owingFees, 
                feesAccessGranted: updatedStudent.feesAccessGranted 
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.toggleOwing = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const filter = { ...getTenantFilter(req), id: parseInt(req.params.id) };
        const student = await prisma.student.findFirst({ where: filter });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const dataToUpdate = { owingFees: !student.owingFees };
        if (!dataToUpdate.owingFees) dataToUpdate.feesAccessGranted = false;

        const updatedStudent = await prisma.student.update({
            where: { id: student.id },
            data: dataToUpdate
        });

        res.json({ 
            success: true, 
            message: `${updatedStudent.firstName} ${updatedStudent.lastName} marked as ${updatedStudent.owingFees ? 'owing fees' : 'fees cleared'}`, 
            data: { 
                _id: updatedStudent.id, 
                firstName: updatedStudent.firstName, 
                lastName: updatedStudent.lastName, 
                admissionNumber: updatedStudent.admissionNumber, 
                owingFees: updatedStudent.owingFees, 
                feesAccessGranted: updatedStudent.feesAccessGranted 
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.toggleStudentResultAccess = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const reason = req.body?.reason || '';
        const filter = { ...getTenantFilter(req), id: parseInt(req.params.id) };
        const student = await prisma.student.findFirst({ where: filter });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const isBlocked = !student.resultAccessBlocked;
        const dataToUpdate = {
            resultAccessBlocked: isBlocked,
            resultBlockReason: isBlocked ? (reason || 'Result access has been blocked by administration.') : '',
            resultBlockedAt: isBlocked ? new Date() : null,
            resultBlockedBy: isBlocked ? parseInt(req.user.id) : null
        };

        const updatedStudent = await prisma.student.update({
            where: { id: student.id },
            data: dataToUpdate
        });

        res.json({ 
            success: true, 
            message: `Result access ${updatedStudent.resultAccessBlocked ? 'blocked' : 'unblocked'}`, 
            data: { 
                _id: updatedStudent.id, 
                firstName: updatedStudent.firstName, 
                lastName: updatedStudent.lastName, 
                admissionNumber: updatedStudent.admissionNumber, 
                resultAccessBlocked: updatedStudent.resultAccessBlocked, 
                resultBlockReason: updatedStudent.resultBlockReason, 
                resultBlockedAt: updatedStudent.resultBlockedAt 
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.setStudentResultBlock = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const { blocked, reason } = req.body;
        if (blocked === undefined) return res.status(400).json({ success: false, message: 'blocked (true/false) is required.' });

        const filter = { ...getTenantFilter(req), id: parseInt(req.params.id) };
        const student = await prisma.student.findFirst({ where: filter });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const dataToUpdate = {
            resultAccessBlocked: blocked,
            resultBlockReason: blocked ? (reason || 'Result access has been blocked by administration.') : '',
            resultBlockedAt: blocked ? new Date() : null,
            resultBlockedBy: blocked ? parseInt(req.user.id) : null
        };

        const updatedStudent = await prisma.student.update({
            where: { id: student.id },
            data: dataToUpdate
        });

        res.json({ 
            success: true, 
            message: `Result access ${blocked ? 'blocked' : 'unblocked'}`, 
            data: { 
                _id: updatedStudent.id, 
                resultAccessBlocked: updatedStudent.resultAccessBlocked, 
                resultBlockReason: updatedStudent.resultBlockReason 
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.toggleClassResultAccess = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const reason = req.body?.reason || '';
        const filter = { ...getTenantFilter(req), id: parseInt(req.params.id) };
        const classData = await prisma.class.findFirst({ where: filter });
        if (!classData) return res.status(404).json({ success: false, message: 'Class not found' });

        const isBlocked = !classData.resultAccessBlocked;
        const dataToUpdate = {
            resultAccessBlocked: isBlocked,
            resultBlockReason: isBlocked ? (reason || `Result access blocked for ${classData.name} ${classData.section || ''}.`) : '',
            resultBlockedAt: isBlocked ? new Date() : null,
            resultBlockedBy: isBlocked ? parseInt(req.user.id) : null
        };

        const updatedClass = await prisma.class.update({
            where: { id: classData.id },
            data: dataToUpdate
        });

        const affectedStudents = await prisma.student.count({ 
            where: { ...getTenantFilter(req), classId: classData.id, isDeleted: { not: true } } 
        });

        res.json({ 
            success: true, 
            message: `Result access ${updatedClass.resultAccessBlocked ? 'blocked' : 'unblocked'}`, 
            data: { 
                _id: updatedClass.id, 
                name: updatedClass.name, 
                section: updatedClass.section, 
                resultAccessBlocked: updatedClass.resultAccessBlocked, 
                resultBlockReason: updatedClass.resultBlockReason, 
                resultBlockedAt: updatedClass.resultBlockedAt, 
                affectedStudents 
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.setClassResultBlock = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const { blocked, reason } = req.body;
        if (blocked === undefined) return res.status(400).json({ success: false, message: 'blocked (true/false) is required.' });

        const filter = { ...getTenantFilter(req), id: parseInt(req.params.id) };
        const classData = await prisma.class.findFirst({ where: filter });
        if (!classData) return res.status(404).json({ success: false, message: 'Class not found' });

        const dataToUpdate = {
            resultAccessBlocked: blocked,
            resultBlockReason: blocked ? (reason || `Result access blocked for ${classData.name} ${classData.section || ''}.`) : '',
            resultBlockedAt: blocked ? new Date() : null,
            resultBlockedBy: blocked ? parseInt(req.user.id) : null
        };

        const updatedClass = await prisma.class.update({
            where: { id: classData.id },
            data: dataToUpdate
        });

        const affectedStudents = await prisma.student.count({ 
            where: { ...getTenantFilter(req), classId: classData.id, isDeleted: { not: true } } 
        });

        res.json({ 
            success: true, 
            message: `Result access ${blocked ? 'blocked' : 'unblocked'}`, 
            data: { 
                _id: updatedClass.id, 
                name: updatedClass.name, 
                section: updatedClass.section, 
                resultAccessBlocked: updatedClass.resultAccessBlocked, 
                resultBlockReason: updatedClass.resultBlockReason, 
                resultBlockedAt: updatedClass.resultBlockedAt, 
                affectedStudents 
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.bulkResultAccess = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });

        const { classId, blocked, reason, studentIds } = req.body;
        if (blocked === undefined) return res.status(400).json({ success: false, message: 'blocked (true/false) is required.' });

        let query = { ...getTenantFilter(req), isDeleted: { not: true } };
        if (classId) query.classId = parseInt(classId);
        if (studentIds && Array.isArray(studentIds) && studentIds.length > 0) {
            query.id = { in: studentIds.map(id => parseInt(id)) };
        }

        const updateData = { 
            resultAccessBlocked: blocked, 
            resultBlockReason: blocked ? (reason || 'Result access blocked by administration.') : '', 
            resultBlockedAt: blocked ? new Date() : null, 
            resultBlockedBy: blocked ? parseInt(req.user.id) : null 
        };

        const result = await prisma.student.updateMany({ 
            where: query, 
            data: updateData 
        });

        // Prisma updateMany returns 'count' instead of 'modifiedCount' and 'matchedCount'
        res.json({ 
            success: true, 
            message: `Result access ${blocked ? 'blocked' : 'unblocked'} for ${result.count} student(s)`, 
            data: { 
                modified: result.count, 
                matched: result.count 
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};