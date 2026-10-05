const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// Helper to safely get Admin ID
const getAdminId = (req) => req.user.role === 'admin' ? parseInt(req.user.id) : parseInt(req.user.adminId);

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// Helper to fetch related Teacher, Subjects, and Students for an array of classes
const populateClassRelations = async (classes, includeStudents = false) => {
    if (!classes || classes.length === 0) return [];

    const teacherIds = [...new Set(classes.map(c => c.teacherId).filter(Boolean))];
    const subjectIds = [...new Set(classes.flatMap(c => c.subjects || []))];
    const studentIds = includeStudents ? [...new Set(classes.flatMap(c => c.students || []))] : [];

    const queries = [
        prisma.teacher.findMany({ where: { id: { in: teacherIds } } })
    ];
    if (subjectIds.length > 0) queries.push(prisma.subject.findMany({ where: { id: { in: subjectIds } } }));
    if (studentIds.length > 0) queries.push(prisma.student.findMany({ where: { id: { in: studentIds } } }));

    const [teachers, subjects = [], students = []] = await Promise.all(queries);

    const teacherMap = new Map(teachers.map(t => [t.id, t]));
    const subjectMap = new Map(subjects.map(s => [s.id, s]));
    const studentMap = new Map(students.map(s => [s.id, s]));

    return classes.map(c => ({
        ...c,
        teacherId: c.teacherId ? teacherMap.get(c.teacherId) || null : null,
        subjects: (c.subjects || []).map(id => subjectMap.get(id)).filter(Boolean),
        students: includeStudents ? (c.students || []).map(id => studentMap.get(id)).filter(Boolean) : c.students,
    }));
};

// ===================================================================
// *** GET ALL CLASSES (Paginated or All) ***
// ===================================================================
exports.getClasses = async (req, res) => {
    try {
        const { page = 1, limit = 1000, search, level, teacherId, all } = req.query;
        const query = { ...getTenantFilter(req), isActive: true };

        if (search) query.name = { contains: search, mode: 'insensitive' };
        if (level) query.level = level;
        if (teacherId && isValidId(teacherId)) query.teacherId = parseInt(teacherId);

        const orderBy = [{ name: 'asc' }, { section: 'asc' }];

        // If 'all' parameter is passed, return all classes without pagination
        if (all === 'true' || all === '1') {
            const classes = await prisma.class.findMany({ where: query, orderBy });
            const populatedClasses = await populateClassRelations(classes);

            return res.json({
                success: true,
                data: populatedClasses,
                pagination: { page: 1, limit: classes.length, total: classes.length, pages: 1 }
            });
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const [classes, total] = await Promise.all([
            prisma.class.findMany({ where: query, orderBy, skip, take }),
            prisma.class.count({ where: query })
        ]);

        const populatedClasses = await populateClassRelations(classes);

        res.json({
            success: true,
            data: populatedClasses,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** GET ALL CLASSES FOR DROPDOWN ***
// ===================================================================
exports.getAllClassesForDropdown = async (req, res) => {
    try {
        const { search, level, session } = req.query;
        const query = { ...getTenantFilter(req), isActive: true };

        if (search) query.name = { contains: search, mode: 'insensitive' };
        if (level) query.level = level;
        if (session) query.session = session;

        const classes = await prisma.class.findMany({
            where: query,
            orderBy: [{ name: 'asc' }, { section: 'asc' }]
        });

        // Fetch only teachers for the dropdown
        const populatedClasses = await populateClassRelations(classes);

        // Return only specific fields to match old .select() behavior
        const responseData = populatedClasses.map(c => ({
            _id: c.id,
            id: c.id,
            name: c.name,
            level: c.level,
            section: c.section,
            session: c.session,
            teacherId: c.teacherId ? { _id: c.teacherId.id, firstName: c.teacherId.firstName, lastName: c.teacherId.lastName, email: c.teacherId.email } : null
        }));

        res.json({ success: true, data: responseData });
    } catch (error) {
        console.error('Error fetching all classes:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** GET CLASS BY ID ***
// ===================================================================
exports.getClassById = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid class ID format.' });

        const classData = await prisma.class.findFirst({ 
            where: { ...getTenantFilter(req), id: parseInt(req.params.id) } 
        });

        if (!classData) return res.status(404).json({ success: false, message: 'Class not found' });

        const [populatedClassArr] = await populateClassRelations([classData], true); // true = include students
        const populatedClass = populatedClassArr;

        // Format subjects and students to match Mongoose _id output
        populatedClass.subjects = populatedClass.subjects.map(s => ({ ...s, _id: s.id }));
        populatedClass.students = populatedClass.students.map(s => ({ ...s, _id: s.id }));

        res.json({ success: true, data: populatedClass });
    } catch (error) {
        console.error('Error fetching class:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** CREATE CLASS ***
// ===================================================================
exports.createClass = async (req, res) => {
    try {
        const adminId = getAdminId(req);

        const teacher = await prisma.teacher.findFirst({ 
            where: { adminId, id: parseInt(req.body.teacherId) } 
        });
        if (!teacher) return res.status(400).json({ success: false, message: 'Teacher not found' });

        if (req.body.subjects && req.body.subjects.length > 0) {
            const subjectIds = req.body.subjects.map(id => parseInt(id));
            const subjectCount = await prisma.subject.count({ 
                where: { adminId, id: { in: subjectIds } } 
            });
            if (subjectCount !== subjectIds.length) {
                return res.status(400).json({ success: false, message: 'One or more subjects not found' });
            }
        }

        const newClass = await prisma.class.create({
            data: {
                ...req.body,
                adminId,
                teacherId: parseInt(req.body.teacherId),
                subjects: req.body.subjects ? req.body.subjects.map(id => parseInt(id)) : [],
                students: [] // Initialize empty array
            }
        });

        const [populatedClassArr] = await populateClassRelations([newClass], true);
        const populatedClass = populatedClassArr;
        populatedClass.subjects = populatedClass.subjects.map(s => ({ ...s, _id: s.id }));

        res.status(201).json({
            success: true,
            message: 'Class created successfully',
            data: populatedClass
        });
    } catch (error) {
        console.error('Error creating class:', error);

        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Class with this name, level, section, and session already exists' });
        }

        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** UPDATE CLASS ***
// ===================================================================
exports.updateClass = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid class ID format.' });
        const classId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const existingClass = await prisma.class.findFirst({ where: { ...tenantFilter, id: classId } });
        if (!existingClass) return res.status(404).json({ success: false, message: 'Class not found' });

        // Check for duplicates manually
        if (req.body.name && req.body.level && req.body.section && req.body.session) {
            const duplicateClass = await prisma.class.findFirst({
                where: {
                    ...tenantFilter,
                    id: { not: classId },
                    name: req.body.name,
                    level: req.body.level,
                    section: req.body.section,
                    session: req.body.session
                }
            });
            if (duplicateClass) return res.status(400).json({ success: false, message: 'Class with this name, level, section, and session already exists' });
        }

        const dataToUpdate = { ...req.body };
        if (dataToUpdate.teacherId) dataToUpdate.teacherId = parseInt(dataToUpdate.teacherId);
        if (dataToUpdate.subjects) dataToUpdate.subjects = dataToUpdate.subjects.map(id => parseInt(id));

        const updatedClass = await prisma.class.update({
            where: { id: classId },
            data: dataToUpdate
        });

        const [populatedClassArr] = await populateClassRelations([updatedClass], true);
        const populatedClass = populatedClassArr;
        populatedClass.subjects = populatedClass.subjects.map(s => ({ ...s, _id: s.id }));

        res.json({
            success: true,
            message: 'Class updated successfully',
            data: populatedClass
        });
    } catch (error) {
        console.error('Error updating class:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Class with this name, level, section, and session already exists' });
        }
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** DELETE CLASS (Soft Delete) ***
// ===================================================================
exports.deleteClass = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid class ID format.' });
        const classId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const classToDelete = await prisma.class.findFirst({ where: { ...tenantFilter, id: classId } });
        if (!classToDelete) return res.status(404).json({ success: false, message: 'Class not found' });

        const studentCount = await prisma.student.count({ 
            where: { ...tenantFilter, classId: classId, isDeleted: { not: true } } 
        });

        if (studentCount > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete class with enrolled students.',
                studentCount
            });
        }

        await prisma.class.update({
            where: { id: classId },
            data: { isActive: false }
        });

        res.json({ success: true, message: 'Class deleted successfully' });
    } catch (error) {
        console.error('Error deleting class:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** GET CLASSES BY TEACHER ID ***
// ===================================================================
exports.getTeacherClasses = async (req, res) => {
    try {
        if (req.user.role === 'teacher' && parseInt(req.user.id) !== parseInt(req.params.teacherId)) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        if (!isValidId(req.params.teacherId)) return res.status(400).json({ success: false, message: 'Invalid teacher ID format.' });
        const teacherId = parseInt(req.params.teacherId);

        const classes = await prisma.class.findMany({
            where: {
                ...getTenantFilter(req),
                teacherId: teacherId,
                isActive: true
            },
            orderBy: [{ name: 'asc' }, { section: 'asc' }]
        });

        const populatedClasses = await populateClassRelations(classes, true); // true = include students

        // Format subjects and students to match Mongoose _id output
        populatedClasses.forEach(c => {
            c.subjects = c.subjects.map(s => ({ ...s, _id: s.id }));
            c.students = c.students.map(s => ({ ...s, _id: s.id, gender: s.gender, admissionNumber: s.admissionNumber, firstName: s.firstName, lastName: s.lastName }));
        });

        res.json({ success: true, data: populatedClasses });
    } catch (error) {
        console.error('Error fetching teacher classes:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

// ===================================================================
// *** GET CLASS WITH MATCHING SUBJECTS ***
// ===================================================================
exports.getClassWithSubjects = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid class ID format.' });
        const classId = parseInt(id);
        const tenantFilter = getTenantFilter(req);

        const classData = await prisma.class.findFirst({ where: { ...tenantFilter, id: classId } });
        if (!classData) return res.status(404).json({ success: false, message: 'Class not found' });

        const matchingSubjects = await prisma.subject.findMany({
            where: {
                ...tenantFilter,
                OR: [
                    { classLevel: classData.level },
                    { classLevel: classData.name }
                ]
            }
        });

        // Format to match old output
        const responseData = {
            ...classData,
            _id: classData.id,
            subjects: matchingSubjects.map(s => ({ ...s, _id: s.id }))
        };

        res.json({ success: true, data: responseData });
    } catch (error) {
        console.error('Error fetching class with subjects:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};