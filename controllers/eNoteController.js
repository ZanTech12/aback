const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET 
});

// Helper function to upload a file buffer to Cloudinary
const uploadToCloudinary = (fileBuffer, folderName) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { 
                folder: folderName, 
                resource_type: "raw" // Required for PDFs
            }, 
            (error, result) => {
                if (error) {
                    reject(error);
                } else {
                    // ✅ FIX: Append query parameter to force inline viewing in the browser
                    let secureUrl = result.secure_url + "?response-content-disposition=inline";
                    resolve(secureUrl);
                }
            }
        );
        stream.end(fileBuffer);
    });
};
// ============================================
// GET STUDENT INFO
// ============================================
exports.getMyStudentInfo = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const student = await prisma.student.findUnique({
            where: { id: parseInt(req.user.id) },
            select: { id: true, firstName: true, lastName: true, classId: true }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        res.json({ success: true, data: student });
    } catch (error) {
        console.error('Error fetching student info:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// GET CLASSES FOR TEACHER/ADMIN
// ============================================
exports.getMyClasses = async (req, res) => {
    try {
        const { role, id } = req.user;
        let classes = [];

        if (role === 'admin') {
            classes = await prisma.class.findMany({
                where: { adminId: parseInt(id) },
                select: { id: true, name: true, level: true, section: true, session: true },
                orderBy: { name: 'asc' }
            });
        } else if (role === 'teacher') {
            const assignments = await prisma.teacherAssignment.findMany({
                where: { teacherId: parseInt(id) },
                select: { classId: true }
            });
            
            const mainClasses = await prisma.class.findMany({
                where: { teacherId: parseInt(id) },
                select: { id: true }
            });
            
            const classIds = [...new Set([...assignments.map(a => a.classId), ...mainClasses.map(c => c.id)])];
            
            if (classIds.length > 0) {
                classes = await prisma.class.findMany({
                    where: { id: { in: classIds } },
                    select: { id: true, name: true, level: true, section: true, session: true },
                    orderBy: { name: 'asc' }
                });
            }
        }

        res.json({ success: true, data: classes });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// GET SUBJECTS FOR TEACHER/ADMIN BY CLASS
// ============================================
exports.getMySubjects = async (req, res) => {
    try {
        const { classId } = req.query;
        if (!classId) return res.status(400).json({ success: false, message: 'Class ID is required' });

        const parsedClassId = parseInt(classId);
        let subjects = [];

        if (req.user.role === 'admin') {
            const classData = await prisma.class.findUnique({
                where: { id: parsedClassId },
                select: { subjects: true }
            });

            if (classData && classData.subjects.length > 0) {
                subjects = await prisma.subject.findMany({
                    where: { id: { in: classData.subjects } },
                    select: { id: true, name: true, code: true },
                    orderBy: { name: 'asc' }
                });
            }
        } else if (req.user.role === 'teacher') {
            const assignments = await prisma.teacherAssignment.findMany({
                where: { 
                    teacherId: parseInt(req.user.id), 
                    classId: parsedClassId,
                    isActive: true 
                },
                select: { subjectId: true }
            });
            
            const subjectIds = assignments.map(a => a.subjectId);
            
            if (subjectIds.length > 0) {
                subjects = await prisma.subject.findMany({
                    where: { id: { in: subjectIds } },
                    select: { id: true, name: true, code: true },
                    orderBy: { name: 'asc' }
                });
            }
        }

        res.json({ success: true, data: subjects });
    } catch (error) {
        console.error('Error fetching subjects:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// GET STUDENTS BY CLASS
// ============================================
exports.getStudentsByClass = async (req, res) => {
    try {
        const { classId } = req.query;
        if (!classId) return res.status(400).json({ success: false, message: 'Class ID is required' });

        const parsedClassId = parseInt(classId);

        if (req.user.role === 'teacher') {
            const assignment = await prisma.teacherAssignment.findFirst({
                where: { teacherId: parseInt(req.user.id), classId: parsedClassId, isActive: true }
            });
            const isClassTeacher = await prisma.class.findFirst({
                where: { id: parsedClassId, teacherId: parseInt(req.user.id) }
            });
            
            if (!assignment && !isClassTeacher) {
                return res.status(403).json({ success: false, message: 'You are not assigned to this class.' });
            }
        }

        const students = await prisma.student.findMany({
            where: {
                classId: parsedClassId,
                isDeleted: false,
                ...(req.user.role === 'admin' ? { adminId: parseInt(req.user.id) } : {})
            },
            select: { id: true, firstName: true, lastName: true, admissionNumber: true, gender: true },
            orderBy: { firstName: 'asc' }
        });

        res.json({ success: true, data: students });
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// GET E-NOTES WEEKS BY CLASS (Using Raw SQL)
// ============================================
exports.getWeeksByClass = async (req, res) => {
    try {
        const { classId, subjectId } = req.query;
        if (!classId) return res.status(400).json({ success: false, message: 'Class ID is required' });

        const parsedClassId = parseInt(classId);

        // 1. Security Check
        if (req.user.role === 'teacher') {
            const assignment = await prisma.teacherAssignment.findFirst({
                where: { teacherId: parseInt(req.user.id), classId: parsedClassId, isActive: true }
            });
            const isClassTeacher = await prisma.class.findFirst({
                where: { id: parsedClassId, teacherId: parseInt(req.user.id) }
            });

            if (!assignment && !isClassTeacher) {
                return res.status(403).json({ success: false, message: 'You are not assigned to this class.' });
            }
        } else if (req.user.role === 'student') {
            const student = await prisma.student.findFirst({
                where: { id: parseInt(req.user.id), classId: parsedClassId }
            });
            if (!student) {
                return res.status(403).json({ success: false, message: 'You are not in this class.' });
            }
        }

        // 2. Fetch Weeks using Raw SQL to bypass Prisma client cache issues
        const weeks = await prisma.$queryRaw`
            SELECT * FROM "ENoteWeek" 
            WHERE "classId" = ${parsedClassId} 
            ORDER BY "createdAt" ASC
        `;

        // 3. Fetch Files using Raw SQL
        let files = [];
        if (weeks.length > 0) {
            const weekIds = weeks.map(w => w.id);
            files = await prisma.$queryRaw`
                SELECT * FROM "ENoteFile" 
                WHERE "weekId" = ANY(${weekIds}::int[])
            `;
        }

        // 4. Group files by weekId and filter by subjectId in JavaScript
        const filesMap = new Map();
        files.forEach(file => {
            const wId = file.weekId;
            if (!filesMap.has(wId)) filesMap.set(wId, []);
            filesMap.get(wId).push(file);
        });

        const formattedWeeks = weeks.map(week => {
            let weekFiles = filesMap.get(week.id) || [];
            
            if (subjectId) {
                const parsedSubjectId = parseInt(subjectId);
                weekFiles = weekFiles.filter(f => f.subjectId === parsedSubjectId);
            }

            return {
                ...week,
                createdAt: week.createdAt instanceof Date ? week.createdAt.toISOString() : week.createdAt,
                updatedAt: week.updatedAt instanceof Date ? week.updatedAt.toISOString() : week.updatedAt,
                files: weekFiles.map(f => ({
                    ...f,
                    createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : f.createdAt,
                    updatedAt: f.updatedAt instanceof Date ? f.updatedAt.toISOString() : f.updatedAt,
                }))
            };
        });

        res.json({ success: true, data: formattedWeeks });
    } catch (error) {
        console.error('Error fetching e-note weeks:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// CREATE A NEW WEEK (ADMIN ONLY)
// ============================================
exports.createWeek = async (req, res) => {
    try {
        const { classId, classIds, title } = req.body;
        const { role, id } = req.user;

        if (role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Only administrators can create weeks.' });
        }

        if (!title || (!classId && !classIds)) {
            return res.status(400).json({ success: false, message: 'Class ID(s) and Title are required' });
        }

        const targetClassIds = classIds && Array.isArray(classIds) ? classIds : [classId];
        const createdWeeks = [];

        for (const cId of targetClassIds) {
            const newWeek = await prisma.eNoteWeek.create({
                data: {
                    title,
                    classId: parseInt(cId),
                    adminId: parseInt(id),
                    teacherId: role === 'teacher' ? parseInt(id) : null 
                }
            });
            createdWeeks.push(newWeek);
        }

        res.status(201).json({ success: true, data: createdWeeks });
    } catch (error) {
        console.error('Error creating e-note week:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// UPLOAD PDF FILES TO A WEEK (Cloudinary + Raw SQL)
// ============================================
exports.uploadFiles = async (req, res) => {
    try {
        const { weekId } = req.params;
        const { role, id } = req.user;
        const { subjectId, subjectName } = req.body;

        if (role !== 'admin' && role !== 'teacher') {
            return res.status(403).json({ success: false, message: 'Not authorized to upload files' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No files uploaded' });
        }

        const filter = { id: parseInt(weekId) };
        if (role === 'admin') {
            filter.adminId = parseInt(id);
        } else if (role === 'teacher') {
            filter.adminId = req.user.adminId ? parseInt(req.user.adminId) : parseInt(id);
        }

        const week = await prisma.eNoteWeek.findFirst({ where: filter });

        if (!week) {
            return res.status(404).json({ success: false, message: 'Week not found or unauthorized' });
        }

        if (role === 'teacher') {
            if (!subjectId) {
                return res.status(400).json({ success: false, message: 'Subject ID is required for teachers to upload.' });
            }

            const assignment = await prisma.teacherAssignment.findFirst({
                where: {
                    teacherId: parseInt(id),
                    classId: week.classId,
                    subjectId: parseInt(subjectId),
                    isActive: true
                }
            });

            if (!assignment) {
                return res.status(403).json({ success: false, message: 'You are not assigned to teach this subject in this class.' });
            }
        }

        // ✅ Ensure database columns exist
        await prisma.$executeRawUnsafe(`ALTER TABLE "ENoteFile" ADD COLUMN IF NOT EXISTS "subjectId" INTEGER;`).catch(e => console.log("Column might already exist:", e.message));
        await prisma.$executeRawUnsafe(`ALTER TABLE "ENoteFile" ADD COLUMN IF NOT EXISTS "subjectName" TEXT;`).catch(e => console.log("Column might already exist:", e.message));

        // ✅ Upload files to Cloudinary and save URLs to Database
        for (const file of req.files) {
            // Upload the memory buffer to Cloudinary
            const cloudinaryUrl = await uploadToCloudinary(file.buffer, `school_enotes/week_${weekId}`);

            await prisma.$executeRaw`
                INSERT INTO "ENoteFile" ("fileName", "fileUrl", "weekId", "subjectId", "subjectName", "createdAt", "updatedAt") 
                VALUES (
                    ${file.originalname}, 
                    ${cloudinaryUrl}, 
                    ${parseInt(weekId)}, 
                    ${subjectId ? parseInt(subjectId) : null}, 
                    ${subjectName || null}, 
                    NOW(), 
                    NOW()
                )
            `;
        }

        // Fetch the updated week with ALL files using Raw SQL
        const updatedWeek = await prisma.$queryRaw`
            SELECT * FROM "ENoteWeek" WHERE "id" = ${parseInt(weekId)}
        `;

        const updatedFiles = await prisma.$queryRaw`
            SELECT * FROM "ENoteFile" WHERE "weekId" = ${parseInt(weekId)}
        `;

        const formattedWeek = updatedWeek[0] ? {
            ...updatedWeek[0],
            createdAt: updatedWeek[0].createdAt instanceof Date ? updatedWeek[0].createdAt.toISOString() : updatedWeek[0].createdAt,
            updatedAt: updatedWeek[0].updatedAt instanceof Date ? updatedWeek[0].updatedAt.toISOString() : updatedWeek[0].updatedAt,
            files: updatedFiles.map(f => ({
                ...f,
                createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : f.createdAt,
                updatedAt: f.updatedAt instanceof Date ? f.updatedAt.toISOString() : f.updatedAt,
            }))
        } : null;

        res.status(200).json({ success: true, data: formattedWeek });
    } catch (error) {
        console.error('Error uploading e-note files:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// DELETE AN UPLOADED FILE
// ============================================
exports.deleteFile = async (req, res) => {
    try {
        const { fileId } = req.params;
        const { role, id } = req.user;

        if (role !== 'admin' && role !== 'teacher') {
            return res.status(403).json({ success: false, message: 'Not authorized to delete files' });
        }

        const file = await prisma.eNoteFile.findUnique({
            where: { id: parseInt(fileId) },
            include: { week: true }
        });

        if (!file) return res.status(404).json({ success: false, message: 'File not found' });

        const filter = { id: file.weekId };
        if (role === 'admin') {
            filter.adminId = parseInt(id);
        } else if (role === 'teacher') {
            filter.adminId = req.user.adminId ? parseInt(req.user.adminId) : parseInt(id);
        }

        const isOwned = await prisma.eNoteWeek.findFirst({ where: filter });
        if (!isOwned) return res.status(403).json({ success: false, message: 'Unauthorized' });

        if (role === 'teacher' && file.subjectId) {
            const assignment = await prisma.teacherAssignment.findFirst({
                where: {
                    teacherId: parseInt(id),
                    classId: file.week.classId,
                    subjectId: file.subjectId,
                    isActive: true
                }
            });

            if (!assignment) {
                return res.status(403).json({ success: false, message: 'You can only delete files for subjects you teach.' });
            }
        }

        // NOTE: To delete the file from Cloudinary, you would use cloudinary.uploader.destroy(public_id)
        // For now, we are just removing the database record. 
        await prisma.eNoteFile.delete({ where: { id: parseInt(fileId) } });

        res.json({ success: true, message: 'File deleted successfully' });
    } catch (error) {
        console.error('Error deleting e-note file:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// DELETE A WEEK (ADMIN ONLY)
// ============================================
exports.deleteWeek = async (req, res) => {
    try {
        const { weekId } = req.params;
        const { role, id } = req.user;

        if (role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Only administrators can delete weeks.' });
        }

        const parsedWeekId = parseInt(weekId);

        const week = await prisma.eNoteWeek.findFirst({
            where: { id: parsedWeekId, adminId: parseInt(id) },
            include: { files: true }
        });

        if (!week) {
            return res.status(404).json({ success: false, message: 'Week not found or unauthorized.' });
        }

        // NOTE: Files will remain in Cloudinary storage, but are removed from the database.
        await prisma.eNoteFile.deleteMany({ where: { weekId: parsedWeekId } });
        await prisma.eNoteWeek.delete({ where: { id: parsedWeekId } });

        res.json({ success: true, message: 'Week and all associated files deleted successfully.' });
    } catch (error) {
        console.error('Error deleting e-note week:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};