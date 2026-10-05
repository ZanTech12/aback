const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Note: You will need to configure multer and cloudinary in a separate middleware file and pass it to the router.

exports.uploadStudentProfileImage = async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Student role required.' });
        if (!req.file) return res.status(400).json({ success: false, message: 'No image file provided.' });

        if (!isValidId(req.user.id)) return res.status(400).json({ success: false, message: 'Invalid user ID.' });
        const studentId = parseInt(req.user.id);

        // Apply tenant filter
        const student = await prisma.student.findFirst({ 
            where: { ...getTenantFilter(req), id: studentId } 
        });
        
        if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

        // Update the JSON field directly
        const profileImageData = {
            url: req.file.path,
            publicId: req.file.filename,
            uploadedAt: new Date()
        };

        const updatedStudent = await prisma.student.update({
            where: { id: studentId },
            data: { profileImage: profileImageData }
        });

        res.json({ success: true, message: 'Profile image uploaded successfully.', data: { profileImage: updatedStudent.profileImage } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error uploading profile image.' });
    }
};

exports.uploadAdminStudentProfileImage = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Admin access required' });
        if (!req.file) return res.status(400).json({ success: false, message: 'No image file provided' });

        const { studentId } = req.params;
        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const parsedStudentId = parseInt(studentId);
        
        // Apply tenant filter
        const student = await prisma.student.findFirst({ 
            where: { ...getTenantFilter(req), id: parsedStudentId } 
        });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const profileImageData = { 
            url: req.file.path, 
            publicId: req.file.filename, 
            uploadedAt: new Date() 
        };

        const updatedStudent = await prisma.student.update({
            where: { id: parsedStudentId },
            data: { profileImage: profileImageData }
        });

        res.json({ success: true, message: 'Image uploaded', data: updatedStudent.profileImage });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.removeAdminStudentProfileImage = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Admin access required' });

        const { studentId } = req.params;
        if (!isValidId(studentId)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const parsedStudentId = parseInt(studentId);
        
        // Apply tenant filter
        const student = await prisma.student.findFirst({ 
            where: { ...getTenantFilter(req), id: parsedStudentId } 
        });
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        // Set JSON field back to empty structure
        await prisma.student.update({
            where: { id: parsedStudentId },
            data: { 
                profileImage: { url: '', publicId: '', uploadedAt: null } 
            }
        });

        res.json({ success: true, message: 'Profile image removed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to remove profile image', error: error.message });
    }
};