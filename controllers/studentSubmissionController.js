const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to safely get Admin ID (School ID)
const getAdminId = (req) => {
    if (req.user.role === 'admin') return parseInt(req.user.id);
    if (req.user.role === 'teacher' || req.user.role === 'student') return parseInt(req.user.adminId);
    return null;
};

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to fetch related Class, Subject, and Student for an array of submissions
const populateSubmissionRelations = async (submissions) => {
    if (!submissions || submissions.length === 0) return [];

    const classIds = [...new Set(submissions.map(s => s.classId).filter(Boolean))];
    const subjectIds = [...new Set(submissions.map(s => s.subjectId).filter(Boolean))];
    const studentIds = [...new Set(submissions.map(s => s.studentId).filter(Boolean))];

    const [classes, subjects, students] = await Promise.all([
        prisma.class.findMany({ where: { id: { in: classIds } } }),
        prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
        prisma.student.findMany({ where: { id: { in: studentIds } } })
    ]);

    const classMap = new Map(classes.map(c => [c.id, c]));
    const subjectMap = new Map(subjects.map(s => [s.id, s]));
    const studentMap = new Map(students.map(s => [s.id, s]));

    // Map back to object structure to match Mongoose frontend expectations
    return submissions.map(s => ({
        ...s,
        classId: s.classId ? { ...classMap.get(s.classId), _id: s.classId } : null,
        subjectId: s.subjectId ? { ...subjectMap.get(s.subjectId), _id: s.subjectId } : null,
        studentId: s.studentId ? { ...studentMap.get(s.studentId), _id: s.studentId } : null,
    }));
};

exports.getSubmissions = async (req, res) => {
    try {
        const submissions = await prisma.studentSubmission.findMany({ 
            where: getTenantFilter(req) 
        });

        const populatedSubmissions = await populateSubmissionRelations(submissions);
        
        res.json({ success: true, data: populatedSubmissions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createSubmission = async (req, res) => {
    try {
        const adminId = getAdminId(req); 
        
        // Destructure to parse IDs safely
        const { classId, subjectId, studentId, ...rest } = req.body;

        const newSubmission = await prisma.studentSubmission.create({
            data: {
                ...rest,
                adminId: adminId,
                classId: classId ? parseInt(classId) : null, 
                subjectId: subjectId ? parseInt(subjectId) : null, 
                studentId: studentId ? parseInt(studentId) : null
            }
        });

        const [populatedSubmission] = await populateSubmissionRelations([newSubmission]);

        res.status(201).json({ success: true, data: populatedSubmission });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateSubmission = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid ID format.' });
        const submissionId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const existing = await prisma.studentSubmission.findFirst({ 
            where: { ...tenantFilter, id: submissionId } 
        });
        
        if (!existing) return res.status(404).json({ success: false, message: 'Submission not found' });

        // Destructure to parse IDs safely
        const { classId, subjectId, studentId, ...rest } = req.body;
        const dataToUpdate = { ...rest };
        if (classId !== undefined) dataToUpdate.classId = classId ? parseInt(classId) : null;
        if (subjectId !== undefined) dataToUpdate.subjectId = subjectId ? parseInt(subjectId) : null;
        if (studentId !== undefined) dataToUpdate.studentId = studentId ? parseInt(studentId) : null;

        const updatedSubmission = await prisma.studentSubmission.update({
            where: { id: submissionId },
            data: dataToUpdate
        });

        const [populatedSubmission] = await populateSubmissionRelations([updatedSubmission]);

        res.json({ success: true, message: 'Submission updated successfully', data: populatedSubmission });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};