console.log('🔥 studentController.js FILE LOADED SUCCESSFULLY!');

const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// ==========================================
// MULTER & CLOUDINARY IMPORTS
// ==========================================
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary with your existing .env credentials
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Use memory storage (Best for Vercel/Serverless)
const storage = multer.memoryStorage();

const studentFileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Not an image! Please upload an image file.'), false);
    }
};

// Export the multer upload middleware
exports.uploadStudentImage = multer({ 
    storage: storage, 
    fileFilter: studentFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
}).single('profileImage');

// Helper function to upload buffer to Cloudinary v2
const uploadToCloudinary = (buffer) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: 'student_profiles',
                allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
                public_id: `student-${Date.now()}`,
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        uploadStream.end(buffer);
    });
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ==========================================
// HELPER: Generate Custom Admission Number
// ==========================================
const generateCustomAdmissionNumber = async (adminId) => {
    const year = new Date().getFullYear();
    
    // 1. Atomically increment the counter
    const siteInfo = await prisma.siteInformation.upsert({
        where: { adminId },
        update: { admissionCounter: { increment: 1 } },
        create: { adminId, admissionCounter: 1 }
    });

    // 2. Get prefix (fallback to 'SCH' if not set yet)
    const prefix = siteInfo.admissionPrefix || 'SCH';
    
    // 3. Pad the number with leading zeros
    const paddedNumber = String(siteInfo.admissionCounter).padStart(3, '0');
    
    return `${prefix}/${year}/${paddedNumber}`;
};

// Helper to remove a student ID from a Class array (Prisma doesn't have $pull)
const removeStudentFromClass = async (classId, studentId) => {
    if (!classId) return;
    const classData = await prisma.class.findUnique({ where: { id: classId } });
    if (classData) {
        const updatedStudents = classData.students.filter(id => id !== studentId);
        await prisma.class.update({
            where: { id: classId },
            data: { students: { set: updatedStudents } }
        });
    }
};

// Helper to add a student ID to a Class array
const addStudentToClass = async (classId, studentId) => {
    if (!classId) return;
    const classData = await prisma.class.findUnique({ where: { id: classId } });
    if (classData && !classData.students.includes(studentId)) {
        await prisma.class.update({
            where: { id: classId },
            data: { students: { push: studentId } }
        });
    }
};

// ==========================================
// HELPER: Build safe student data (explicit whitelist - Prisma
// throws on unknown fields, so never spread req.body directly)
// ==========================================
const buildStudentData = (body, admissionNumber, adminId) => {
    const parsedClassId = body.classId && isValidId(body.classId) ? parseInt(body.classId) : null;

    // Sanitize profileImage (from CSV import)
    let profileImage;
    if (body.profileImage
        && typeof body.profileImage.url === 'string'
        && /^https?:\/\//i.test(body.profileImage.url)) {
        profileImage = {
            url: body.profileImage.url,
            publicId: typeof body.profileImage.publicId === 'string' ? body.profileImage.publicId : ''
        };
    }

    return {
        firstName: body.firstName,
        lastName: body.lastName,
        gender: body.gender || null,
        admissionNumber,
        adminId: adminId,
        classId: parsedClassId,
        ...(typeof body.owingFees === 'boolean' ? { owingFees: body.owingFees } : {}),
        ...(typeof body.feesAccessGranted === 'boolean' ? { feesAccessGranted: body.feesAccessGranted } : {}),
        ...(profileImage ? { profileImage } : {})
    };
};

// ==========================================
// STUDENT CONTROLLERS
// ==========================================

exports.getStudents = async (req, res) => {
    try {
        console.log('🚀 getStudents FUNCTION WAS CALLED!');
        
        const { classId } = req.query;
        const filter = { ...getTenantFilter(req), isDeleted: { not: true } };
        
        if (classId) {
            filter.classId = parseInt(classId);
        }
        
        const students = await prisma.student.findMany({ 
            where: filter,
            select: { id: true, firstName: true, lastName: true, admissionNumber: true, classId: true, gender: true, profileImage: true },
            orderBy: { firstName: 'asc' }
        });
        
        res.json({ success: true, data: students });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getStudentById = async (req, res) => {
    try {
        if (req.user.role === 'student' && parseInt(req.user.id) !== parseInt(req.params.id)) {
            return res.status(403).json({ success: false, message: 'Access denied. You can only view your own profile.' });
        }

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });

        const filter = { ...getTenantFilter(req), id: parseInt(req.params.id), isDeleted: { not: true } };
        const student = await prisma.student.findFirst({ where: filter });
        
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        res.json({ success: true, data: student });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.createStudent = async (req, res) => {
    try {
        const adminId = parseInt(req.user.id);
        const userRole = req.user.role;

        if (userRole !== 'superadmin') {
            const admin = await prisma.admin.findUnique({ where: { id: adminId } });
            if (!admin) return res.status(404).json({ success: false, message: 'Admin account not found.' });

            // ✅ FIX: LIVE COUNT - never trust the stored counter (it drifts).
            // Direct-DB deletions, superadmin deletes, etc. can never block imports.
            const activeStudentCount = await prisma.student.count({
                where: { adminId, isDeleted: { not: true } }
            });

            if (activeStudentCount >= admin.studentLimit) {
                return res.status(403).json({ 
                    success: false, 
                    message: `Student limit reached. Your limit is ${admin.studentLimit}. Please contact the Super Admin to increase it.` 
                });
            }
        }

        // Use the provided admission number (CSV import), or generate one
        const providedAdmissionNumber = req.body.admissionNumber && String(req.body.admissionNumber).trim()
            ? String(req.body.admissionNumber).trim()
            : null;

        let admissionNumber;
        if (providedAdmissionNumber) {
            const existing = await prisma.student.findFirst({
                where: { ...getTenantFilter(req), admissionNumber: providedAdmissionNumber }
            });
            if (existing) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Admission number "${providedAdmissionNumber}" already exists.` 
                });
            }
            admissionNumber = providedAdmissionNumber;
        } else {
            admissionNumber = await generateCustomAdmissionNumber(adminId);
        }

        const studentData = buildStudentData(req.body, admissionNumber, adminId);
        const student = await prisma.student.create({ data: studentData });

        if (student.classId) {
            await addStudentToClass(student.classId, student.id);
        }

        // Keep the counter ahead of imported numbers so future
        // auto-generated numbers never collide with imported ones
        if (providedAdmissionNumber) {
            try {
                const siteInfo = await prisma.siteInformation.findUnique({ where: { adminId } });
                if (siteInfo) {
                    const prefix = (siteInfo.admissionPrefix || 'SCH').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const year = new Date().getFullYear();
                    const match = admissionNumber.match(new RegExp(`^${prefix}/${year}/(\\d+)$`));
                    if (match) {
                        const seq = parseInt(match[1], 10);
                        if (seq > (siteInfo.admissionCounter || 0)) {
                            await prisma.siteInformation.update({ 
                                where: { adminId }, 
                                data: { admissionCounter: seq } 
                            });
                        }
                    }
                }
            } catch (syncErr) {
                console.warn('Admission counter sync skipped:', syncErr.message);
            }
        }

        if (userRole !== 'superadmin') {
            await prisma.admin.update({
                where: { id: adminId },
                data: { currentStudentCount: { increment: 1 } }
            });
        }

        res.status(201).json({ 
            success: true, 
            data: student, 
            message: `Student registered with admission number: ${admissionNumber}` 
        });
    } catch (error) {
        console.error('Create Student Error:', error);
        // Prisma unique constraint error is 'P2002'
        if (error.code === 'P2002' && error.meta?.target?.includes('admissionNumber')) {
            // If the number came from the CSV, report it - do NOT silently replace it
            if (providedAdmissionNumber) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Admission number "${providedAdmissionNumber}" already exists.` 
                });
            }
            // Auto-generated collision - retry once with a fresh number
            try {
                const adminId = parseInt(req.user.id);
                const admissionNumber = await generateCustomAdmissionNumber(adminId);
                // ✅ FIX: use the explicit whitelist (spreading req.body can crash Prisma
                // with unknown fields)
                const studentData = buildStudentData(req.body, admissionNumber, adminId);
                const student = await prisma.student.create({ data: studentData });

                if (student.classId) {
                    await addStudentToClass(student.classId, student.id);
                }

                if (req.user.role !== 'superadmin') {
                    await prisma.admin.update({
                        where: { id: adminId },
                        data: { currentStudentCount: { increment: 1 } }
                    });
                }

                return res.status(201).json({ success: true, data: student, message: `Student registered with admission number: ${admissionNumber}` });
            } catch (retryError) {
                return res.status(500).json({ success: false, message: 'Failed to generate unique admission number. Please try again.' });
            }
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateStudent = async (req, res) => {
    try {
        const { firstName, lastName, admissionNumber, classId: rawClassId, gender } = req.body;
        const tenantFilter = getTenantFilter(req);
        
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const studentId = parseInt(req.params.id);
        
        const filter = { ...tenantFilter, id: studentId, isDeleted: { not: true } };
        const student = await prisma.student.findFirst({ where: filter });
        
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        if (admissionNumber && admissionNumber !== student.admissionNumber) {
            const existingStudent = await prisma.student.findFirst({ 
                where: { ...tenantFilter, admissionNumber, NOT: { id: studentId } } 
            });
            if (existingStudent) return res.status(400).json({ success: false, message: 'Admission number already exists' });
        }

        let oldClassId = student.classId;
        let newClassId = rawClassId && isValidId(rawClassId) ? parseInt(rawClassId) : null;

        const updatedStudent = await prisma.student.update({
            where: { id: studentId },
            data: { firstName, lastName, admissionNumber, classId: newClassId, gender }
        });

        if (oldClassId && oldClassId !== newClassId) {
            await removeStudentFromClass(oldClassId, studentId);
            if (newClassId) await addStudentToClass(newClassId, studentId);
        }

        res.json({ success: true, message: 'Student updated successfully', data: updatedStudent });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

exports.softDeleteStudent = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const tenantFilter = getTenantFilter(req);
        const studentId = parseInt(req.params.id);
        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: studentId } });
        
        if (!student || student.isDeleted) return res.status(404).json({ success: false, message: 'Student not found or already in recycle bin.' });

        await prisma.student.update({
            where: { id: studentId },
            data: { isDeleted: true }
        });

        await Promise.all([
            student.classId ? removeStudentFromClass(student.classId, studentId) : Promise.resolve(),
            prisma.continuousAssessment.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: false } }),
            prisma.teacherComment.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: false } }),
            prisma.classTeacherComment.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: false } }),
            prisma.principalComment.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: false } }),
            prisma.attendance.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: false } }),
            prisma.studentSubmission.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: false } })
        ]);

        // ✅ FIX: decrement the STUDENT'S OWNER's counter, regardless of which
        // role performed the delete (previously only ran for admin role and
        // targeted the DELETER's account, not the owner's)
        const owner = await prisma.admin.findUnique({ where: { id: student.adminId } });
        if (owner) {
            await prisma.admin.update({
                where: { id: student.adminId },
                data: { currentStudentCount: Math.max(0, owner.currentStudentCount - 1) }
            });
        }

        res.json({ success: true, message: `Student "${student.firstName} ${student.lastName}" moved to Recycle Bin. All records have been hidden.` });
    } catch (error) {
        console.error('Soft Delete Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getRecycleBin = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }
        
        const filter = { ...getTenantFilter(req), isDeleted: true };
        const deletedStudents = await prisma.student.findMany({ where: filter });
        
        res.json({ success: true, data: deletedStudents });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.restoreStudent = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const tenantFilter = getTenantFilter(req);
        const studentId = parseInt(req.params.id);
        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: studentId } });
        
        if (!student || !student.isDeleted) return res.status(404).json({ success: false, message: 'Student not found in recycle bin.' });

        await prisma.student.update({
            where: { id: studentId },
            data: { isDeleted: false }
        });

        await Promise.all([
            student.classId ? addStudentToClass(student.classId, studentId) : Promise.resolve(),
            prisma.continuousAssessment.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: true } }),
            prisma.teacherComment.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: true } }),
            prisma.classTeacherComment.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: true } }),
            prisma.principalComment.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: true } }),
            prisma.attendance.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: true } }),
            prisma.studentSubmission.updateMany({ where: { ...tenantFilter, studentId }, data: { isActive: true } })
        ]);

        // ✅ FIX: increment the STUDENT'S OWNER's counter, regardless of who restored
        await prisma.admin.update({
            where: { id: student.adminId },
            data: { currentStudentCount: { increment: 1 } }
        });

        res.json({ success: true, message: `Student "${student.firstName} ${student.lastName}" and all associated records have been restored.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.permanentDeleteStudent = async (req, res) => {
    try {
        if (!['admin', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
        }

        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        const tenantFilter = getTenantFilter(req);
        const studentId = parseInt(req.params.id);
        const student = await prisma.student.findFirst({ where: { ...tenantFilter, id: studentId } });
        
        if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

        await Promise.all([
            student.classId ? removeStudentFromClass(student.classId, studentId) : Promise.resolve(),
            prisma.continuousAssessment.deleteMany({ where: { ...tenantFilter, studentId } }),
            prisma.teacherComment.deleteMany({ where: { ...tenantFilter, studentId } }),
            prisma.classTeacherComment.deleteMany({ where: { ...tenantFilter, studentId } }),
            prisma.principalComment.deleteMany({ where: { ...tenantFilter, studentId } }),
            prisma.attendance.deleteMany({ where: { ...tenantFilter, studentId } }),
            prisma.studentSubmission.deleteMany({ where: { ...tenantFilter, studentId } })
        ]);

        await prisma.student.delete({ where: { id: studentId } });

        // ✅ FIX: only decrement if the student was still ACTIVE (soft delete already
        // decremented). Target the student's owner, works for any role.
        if (!student.isDeleted) {
            const owner = await prisma.admin.findUnique({ where: { id: student.adminId } });
            if (owner) {
                await prisma.admin.update({
                    where: { id: student.adminId },
                    data: { currentStudentCount: Math.max(0, owner.currentStudentCount - 1) }
                });
            }
        }

        res.json({ success: true, message: `Student "${student.firstName} ${student.lastName}" has been permanently deleted from the system.` });
    } catch (error) {
        console.error('Permanent Delete Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// PROFILE IMAGE CONTROLLERS (CLOUDINARY)
// ==========================================

exports.uploadProfileImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image file uploaded.' });
        }

        const studentId = parseInt(req.params.id);
        if (!isValidId(studentId)) {
            return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        }

        const existingStudent = await prisma.student.findUnique({ where: { id: studentId } });
        if (existingStudent?.profileImage?.publicId) {
            await cloudinary.uploader.destroy(existingStudent.profileImage.publicId);
        }

        const result = await uploadToCloudinary(req.file.buffer);

        const imageData = {
            url: result.secure_url,
            publicId: result.public_id
        };

        const updatedStudent = await prisma.student.update({
            where: { id: studentId },
            data: { profileImage: imageData } 
        });

        res.status(200).json({
            success: true,
            message: 'Profile image uploaded to Cloudinary successfully.',
            data: updatedStudent
        });

    } catch (error) {
        console.error('Cloudinary Upload Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.removeProfileImage = async (req, res) => {
    try {
        const studentId = parseInt(req.params.id);
        if (!isValidId(studentId)) {
            return res.status(400).json({ success: false, message: 'Invalid student ID format.' });
        }

        const student = await prisma.student.findUnique({ where: { id: studentId } });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }

        if (student.profileImage?.publicId) {
            await cloudinary.uploader.destroy(student.profileImage.publicId);
        }

        const updatedStudent = await prisma.student.update({
            where: { id: studentId },
            data: { profileImage: null }
        });

        res.status(200).json({
            success: true,
            message: 'Profile image removed from Cloudinary successfully.',
            data: updatedStudent
        });

    } catch (error) {
        console.error('Cloudinary Remove Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// TEMPORARY: COUNTER RESET (run once, then remove)
// POST /students/reset-counter - logged in as the school admin
// ==========================================
exports.resetMyCounter = async (req, res) => {
    try {
        const adminId = parseInt(req.user.id);
        const realCount = await prisma.student.count({
            where: { adminId, isDeleted: { not: true } }
        });
        const before = await prisma.admin.findUnique({
            where: { id: adminId },
            select: { currentStudentCount: true, studentLimit: true }
        });
        await prisma.admin.update({ where: { id: adminId }, data: { currentStudentCount: realCount } });
        res.json({ 
            success: true, 
            message: `Counter fixed: ${before?.currentStudentCount} -> ${realCount} (limit: ${before?.studentLimit})` 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// STUDENT PROMOTION (category-based)
// ==========================================

// Categories whose APEX class graduates to the recycle bin (the school exit).
// Add 'primary' too if primary leavers should also exit to the recycle bin.
const GRADUATING_CATEGORIES = ['secondary'];

// Per-category promotion rungs. Names are normalized before matching
// (lowercase, spaces removed) so "SSS1" and "SSS 1" both match "sss1".
// ⚠️ EDIT to match your school: remove the nursery rungs if you don't run
// Nursery, or reorder if Nursery comes before KG in your school.
const CATEGORY_RUNGS = {
  primary: [
    { level: 1, names: ['kg1', 'kindergarten1'] },
    { level: 2, names: ['kg2', 'kindergarten2'] },
    { level: 3, names: ['nursery1'] },
    { level: 4, names: ['nursery2'] },
    { level: 5, names: ['primary1'] },
    { level: 6, names: ['primary2'] },
    { level: 7, names: ['primary3'] },
    { level: 8, names: ['primary4'] },
    { level: 9, names: ['primary5'] }    // APEX of Primary School — promotion STOPS
  ],
  secondary: [
    { level: 1, names: ['jss1'] },
    { level: 2, names: ['jss2'] },
    { level: 3, names: ['jss3'] },
    { level: 4, names: ['sss1'] },
    { level: 5, names: ['sss2'] },
    { level: 6, names: ['sss3'] }        // APEX of Secondary School — GRADUATES
  ]
};

const normClass = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const findRung = (category, className) => {
  const rungs = CATEGORY_RUNGS[category];
  if (!rungs) return null;
  const n = normClass(className);
  return rungs.find(r => r.names.includes(n)) || null;
};

const apexLevel = (category) => {
  const rungs = CATEGORY_RUNGS[category] || [];
  return rungs.length ? rungs[rungs.length - 1].level : null;
};

const rungName = (category, level) => {
  const rungs = CATEGORY_RUNGS[category] || [];
  const rung = rungs.find(r => r.level === level);
  return rung ? rung.names[0] : `level ${level}`;
};

const buildPromotionPlan = async (adminId) => {
  const classes = await prisma.class.findMany({ where: { adminId } });
  const students = await prisma.student.findMany({
    where: { adminId, isDeleted: { not: true } },
    select: { id: true, firstName: true, lastName: true, admissionNumber: true, classId: true }
  });

  const classInfo = classes.map(c => {
    const rung = c.category ? findRung(c.category, c.name) : null;
    return {
      id: c.id, name: c.name, section: c.section,
      category: c.category || null,
      level: rung ? rung.level : null
    };
  });
  const classById = new Map(classInfo.map(c => [c.id, c]));

  const byClass = new Map();
  for (const s of students) {
    if (!s.classId) continue;
    if (!byClass.has(s.classId)) byClass.set(s.classId, []);
    byClass.get(s.classId).push(s);
  }

  const moves = [];
  const graduates = [];
  const apexStops = [];
  const noCategory = [];
  const noTarget = [];
  const unmatched = [];

  for (const [classId, classStudents] of byClass) {
    const info = classById.get(classId);
    if (!info) { unmatched.push({ className: `Class #${classId} (deleted)`, category: null, count: classStudents.length }); continue; }
    const label = `${info.name}${info.section ? ' - ' + info.section : ''}`;

    if (!info.category) {
      noCategory.push({ className: label, count: classStudents.length });
      continue;
    }
    if (info.level === null) {
      unmatched.push({ className: label, category: info.category, count: classStudents.length });
      continue;
    }

    // APEX of the category
    if (info.level === apexLevel(info.category)) {
      if (GRADUATING_CATEGORIES.includes(info.category)) {
        graduates.push({ className: label, students: classStudents });
      } else {
        apexStops.push({ className: label, category: info.category, count: classStudents.length });
      }
      continue;
    }

    // Next class up — WITHIN the same category, never crosses categories
    const targets = classInfo.filter(c => c.category === info.category && c.level === info.level + 1);
    if (targets.length === 0) {
      noTarget.push({ className: label, count: classStudents.length, missing: rungName(info.category, info.level + 1) });
      continue;
    }
    const target = targets.find(c => normClass(c.section) === normClass(info.section)) || targets[0];

    moves.push({
      category: info.category,
      from: { id: info.id, label },
      to: { id: target.id, label: `${target.name}${target.section ? ' - ' + target.section : ''}` },
      students: classStudents
    });
  }

  // Entry class = lowest rung of primary (empties after promotion)
  const entry = classInfo
    .filter(c => c.category === 'primary' && c.level !== null)
    .sort((a, b) => a.level - b.level)[0] || null;

  return {
    totalStudents: students.length,
    unassignedCount: students.filter(s => !s.classId).length,
    moves, graduates, apexStops, noCategory, noTarget, unmatched,
    entryClass: entry ? `${entry.name}${entry.section ? ' - ' + entry.section : ''}` : null
  };
};

// POST /students/promotion/preview — dry run, no changes
exports.promotionPreview = async (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
    }
    const plan = await buildPromotionPlan(parseInt(req.user.id));

    res.json({
      success: true,
      data: {
        totalStudents: plan.totalStudents,
        unassignedCount: plan.unassignedCount,
        entryClass: plan.entryClass,
        moveSummary: plan.moves.map(m => ({ category: m.category, from: m.from.label, to: m.to.label, count: m.students.length })),
        graduateCount: plan.graduates.reduce((sum, g) => sum + g.students.length, 0),
        graduateClasses: plan.graduates.map(g => ({ className: g.className, count: g.students.length })),
        apexStops: plan.apexStops,
        apexStopCount: plan.apexStops.reduce((sum, a) => sum + a.count, 0),
        noCategory: plan.noCategory,
        noTarget: plan.noTarget,
        unmatched: plan.unmatched,
        hasIssues: plan.noCategory.length > 0 || plan.noTarget.length > 0 || plan.unmatched.length > 0 || plan.unassignedCount > 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /students/promotion/execute — the real thing (all-or-nothing)
exports.promotionExecute = async (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
    }
    const adminId = parseInt(req.user.id);
    const plan = await buildPromotionPlan(adminId);

    const graduateIds = plan.graduates.flatMap(g => g.students.map(s => s.id));
    const movedCount = plan.moves.reduce((sum, m) => sum + m.students.length, 0);
    const apexStopCount = plan.apexStops.reduce((sum, a) => sum + a.count, 0);

    if (movedCount === 0 && graduateIds.length === 0) {
      return res.json({ success: true, message: 'Nothing to promote - no active students in categorized classes.', data: { movedCount: 0, graduateCount: 0, apexStopCount: 0 } });
    }

    await prisma.$transaction(async (tx) => {
      // 1. MOVE students up within their category
      for (const move of plan.moves) {
        await tx.student.updateMany({
          where: { id: { in: move.students.map(s => s.id) } },
          data: { classId: move.to.id }
        });
      }

      // 2. GRADUATE the apex of graduating categories (SSS 3) into the recycle bin
      if (graduateIds.length > 0) {
        await tx.student.updateMany({ where: { id: { in: graduateIds } }, data: { isDeleted: true } });
        await tx.continuousAssessment.updateMany({ where: { adminId, studentId: { in: graduateIds } }, data: { isActive: false } });
        await tx.teacherComment.updateMany({ where: { adminId, studentId: { in: graduateIds } }, data: { isActive: false } });
        await tx.classTeacherComment.updateMany({ where: { adminId, studentId: { in: graduateIds } }, data: { isActive: false } });
        await tx.principalComment.updateMany({ where: { adminId, studentId: { in: graduateIds } }, data: { isActive: false } });
        await tx.attendance.updateMany({ where: { adminId, studentId: { in: graduateIds } }, data: { isActive: false } });
        await tx.studentSubmission.updateMany({ where: { adminId, studentId: { in: graduateIds } }, data: { isActive: false } });
      }

      // 3. REBUILD every class's student array from the database
      //    (apex-stop students stay in place automatically)
      const allClasses = await tx.class.findMany({ where: { adminId } });
      for (const cls of allClasses) {
        const newIds = (await tx.student.findMany({
          where: { classId: cls.id, isDeleted: { not: true } },
          select: { id: true }
        })).map(s => s.id);
        if (JSON.stringify(newIds) !== JSON.stringify(cls.students || [])) {
          await tx.class.update({ where: { id: cls.id }, data: { students: { set: newIds } } });
        }
      }

      // 4. RESYNC the student counter
      const activeCount = await tx.student.count({ where: { adminId, isDeleted: { not: true } } });
      await tx.admin.update({ where: { id: adminId }, data: { currentStudentCount: activeCount } });
    }, { timeout: 60000 });

    res.json({
      success: true,
      message: `Promotion complete: ${movedCount} student(s) moved up, ${graduateIds.length} graduated to the recycle bin.` +
        (apexStopCount > 0 ? ` ${apexStopCount} student(s) stopped at the apex of their category (no automatic move).` : '') +
        (plan.entryClass ? ` ${plan.entryClass} is now empty for new intakes.` : ''),
      data: {
        movedCount,
        graduateCount: graduateIds.length,
        apexStopCount,
        moveSummary: plan.moves.map(m => ({ category: m.category, from: m.from.label, to: m.to.label, count: m.students.length })),
        graduateClasses: plan.graduates.map(g => ({ className: g.className, count: g.students.length })),
        apexStops: plan.apexStops,
        skipped: {
          noCategory: plan.noCategory,
          noTarget: plan.noTarget,
          unmatched: plan.unmatched,
          unassigned: plan.unassignedCount
        },
        entryClass: plan.entryClass
      }
    });
  } catch (error) {
    console.error('Promotion error:', error);
    res.status(500).json({ success: false, message: 'Promotion failed - no changes were made. ' + error.message });
  }
};