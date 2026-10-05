const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ===================================================================
// *** GET ALL SUBJECTS ***
// ===================================================================
exports.getSubjects = async (req, res) => {
    try {
        const subjects = await prisma.subject.findMany({ 
            where: getTenantFilter(req) 
        });
        
        // Map _id for frontend consistency
        const responseData = subjects.map(s => ({ ...s, _id: s.id }));
        
        res.json({ success: true, data: responseData });
    } catch (error) {
        console.error('Error fetching subjects:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ===================================================================
// *** CREATE SUBJECT ***
// ===================================================================
exports.createSubject = async (req, res) => {
    try {
        if (!isValidId(req.user.id)) return res.status(400).json({ success: false, message: 'Invalid admin ID.' });
        
        const newSubject = await prisma.subject.create({
            data: {
                ...req.body,
                adminId: parseInt(req.user.id)
            }
        });

        res.status(201).json({ success: true, data: { ...newSubject, _id: newSubject.id } });
    } catch (error) {
        console.error('Error creating subject:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Subject code or name already exists for your school.' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// ===================================================================
// *** UPDATE SUBJECT ***
// ===================================================================
exports.updateSubject = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid subject ID format.' });
        const subjectId = parseInt(req.params.id);
        
        const { name, code, classLevel, description } = req.body;
        const tenantFilter = getTenantFilter(req);

        const subject = await prisma.subject.findFirst({ where: { ...tenantFilter, id: subjectId } });
        if (!subject) {
            return res.status(404).json({ success: false, message: 'Subject not found' });
        }

        // Check if code is being changed and if it already exists (within the same school)
        if (code && code !== subject.code) {
            const existingSubject = await prisma.subject.findFirst({ 
                where: { ...tenantFilter, code: code, NOT: { id: subjectId } } 
            });
            if (existingSubject) {
                return res.status(400).json({ success: false, message: 'Subject code already exists' });
            }
        }

        // Check if name is being changed and if it already exists (within the same school)
        if (name && name !== subject.name) {
            const existingSubject = await prisma.subject.findFirst({ 
                where: { ...tenantFilter, name: name, NOT: { id: subjectId } } 
            });
            if (existingSubject) {
                return res.status(400).json({ success: false, message: 'Subject name already exists' });
            }
        }

        const dataToUpdate = {};
        if (name !== undefined) dataToUpdate.name = name;
        if (code !== undefined) dataToUpdate.code = code;
        if (classLevel !== undefined) dataToUpdate.classLevel = classLevel;
        if (description !== undefined) dataToUpdate.description = description;

        const updatedSubject = await prisma.subject.update({
            where: { id: subjectId },
            data: dataToUpdate
        });

        res.json({ success: true, message: 'Subject updated successfully', data: { ...updatedSubject, _id: updatedSubject.id } });
    } catch (error) {
        console.error('Error updating subject:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Subject code or name already exists.' });
        }
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** DELETE SUBJECT ***
// ===================================================================
exports.deleteSubject = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid subject ID format.' });
        const subjectId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        // Prevent deletion if questions are using this subject (within the same school)
        const relatedQuestions = await prisma.question.count({ 
            where: { ...tenantFilter, subjectId: subjectId } 
        });
        
        if (relatedQuestions > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot delete subject. It is used by ${relatedQuestions} question(s).` 
            });
        }

        // Prevent deletion if classes are assigned to this subject (within the same school)
        // Prisma uses 'has' to check if an integer array contains a specific value
        const relatedClasses = await prisma.class.count({ 
            where: { ...tenantFilter, subjects: { has: subjectId } } 
        });
        
        if (relatedClasses > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot delete subject. It is assigned to ${relatedClasses} class(es).` 
            });
        }

        await prisma.subject.delete({ where: { id: subjectId } });
        res.json({ success: true, message: 'Subject deleted successfully' });
    } catch (error) {
        if (error.code === 'P2025') return res.status(404).json({ success: false, message: 'Subject not found.' });
        res.status(500).json({ success: false, message: error.message });
    }
};

// ===================================================================
// *** GET SUBJECTS BY CLASS ID ***
// ===================================================================
// controllers/subjectController.js — replace the by-class handler
exports.getSubjectsByClass = async (req, res) => {
    try {
        const raw = String(req.params.classId || req.params.className || '').trim();
        const tenantFilter = getTenantFilter(req);

        // ✅ Accept EITHER a numeric ID or a class name
        let where;
        if (/^\d+$/.test(raw)) {
            where = { ...tenantFilter, id: parseInt(raw) };
        } else {
            where = { ...tenantFilter, name: { equals: raw, mode: 'insensitive' } };
        }

        const cls = await prisma.class.findFirst({ where });
        if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

        // Subjects linked via the Class.subjects Int array (your schema's shape)
        const subjectIds = Array.isArray(cls.subjects) ? cls.subjects : [];
        const subjects = subjectIds.length > 0
            ? await prisma.subject.findMany({ where: { ...tenantFilter, id: { in: subjectIds } } })
            : await prisma.subject.findMany({ where: tenantFilter });

        res.json({ success: true, data: subjects });
    } catch (error) {
        console.error('getSubjectsByClass error:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};