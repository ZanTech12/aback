const prisma = require('../config/db');
const crypto = require('crypto');

// ============================================
// ADMIN: Generate PINs for a Class/Term/Session OR Individual Student
// ============================================
exports.generatePins = async (req, res) => {
    try {
        const { classId, termId, sessionId, studentId } = req.body;
        const { id: adminId } = req.user;

        if ((!classId && !studentId) || !termId || !sessionId) {
            return res.status(400).json({ success: false, message: 'Class (or Student), Term, and Session are required' });
        }

        let targetStudentIds = [];

        if (studentId) {
            // Generate for single student
            targetStudentIds = [parseInt(studentId)];
            
            await prisma.resultPin.deleteMany({
                where: { 
                    adminId, 
                    studentId: parseInt(studentId), 
                    termId: parseInt(termId), 
                    sessionId: parseInt(sessionId), 
                    isUsed: false 
                }
            });
        } else if (classId) {
            // ✅ FIX: Query Student table directly instead of Class.students array
            const studentsInClass = await prisma.student.findMany({
                where: { 
                    classId: parseInt(classId),
                    isDeleted: false 
                },
                select: { id: true }
            });

            targetStudentIds = studentsInClass.map(s => s.id);

            if (targetStudentIds.length === 0) {
                return res.status(404).json({ success: false, message: 'No students found in this class' });
            }

            await prisma.resultPin.deleteMany({
                where: { 
                    adminId, 
                    termId: parseInt(termId), 
                    sessionId: parseInt(sessionId), 
                    isUsed: false 
                }
            });
        }

        const pinsToCreate = [];
        for (const id of targetStudentIds) {
            const pin = crypto.randomBytes(4).toString('hex').toUpperCase();
            pinsToCreate.push({
                adminId,
                studentId: id,
                termId: parseInt(termId),
                sessionId: parseInt(sessionId),
                pin
            });
        }

        const createdPins = await prisma.resultPin.createMany({
            data: pinsToCreate,
            skipDuplicates: true
        });

        res.status(201).json({ 
            success: true, 
            message: `${createdPins.count} PIN(s) generated successfully`,
            count: createdPins.count
        });

    } catch (error) {
        console.error('Error generating PINs:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// ADMIN: Fetch generated PINs
// ============================================
exports.getPins = async (req, res) => {
    try {
        // ✅ ADDED studentId to query params
        const { termId, sessionId, classId, studentId } = req.query;
        const { id: adminId } = req.user;

        let studentIds = [];
        
        // ✅ FIX: If a specific student is selected, only look for that student
        if (studentId) {
            studentIds = [parseInt(studentId)];
        } else if (classId) {
            // Otherwise, get all students in the selected class
            const studentsInClass = await prisma.student.findMany({
                where: { 
                    classId: parseInt(classId),
                    isDeleted: false 
                },
                select: { id: true }
            });
            
            studentIds = studentsInClass.map(s => s.id);
            
            // If the class has NO students, return empty list immediately
            if (studentIds.length === 0) {
                return res.json({ success: true, data: [] });
            }
        }

        const pins = await prisma.resultPin.findMany({
            where: {
                adminId,
                termId: termId ? parseInt(termId) : undefined,
                sessionId: sessionId ? parseInt(sessionId) : undefined,
                // Now this will filter by the single student OR the class array
                ...(studentIds.length > 0 ? { studentId: { in: studentIds } } : {})
            },
            include: {
                student: {
                    select: { id: true, firstName: true, lastName: true, admissionNumber: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ success: true, data: pins });
    } catch (error) {
        console.error('Error fetching PINs:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// PUBLIC: Check Result using PIN (5 Successful Views Limit)
// ============================================
exports.checkResultPublic = async (req, res) => {
    try {
        const { admissionNumber, pin, schoolCode } = req.body;

        if (!admissionNumber || !pin || !schoolCode) {
            return res.status(400).json({ success: false, message: 'Admission Number, PIN, and School Code are required' });
        }

        // 1. Find the school by School Code
        const school = await prisma.admin.findFirst({
            where: { schoolCode: schoolCode, isActive: true }
        });

        if (!school) {
            return res.status(404).json({ success: false, message: 'School not found or inactive' });
        }

        // 2. Find the student by Admission Number
        const student = await prisma.student.findFirst({
            where: { 
                admissionNumber, 
                adminId: school.id,
                isDeleted: false 
            }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        // ✅ ADDED: Fetch Class Name using classId
        let className = "N/A";
        if (student?.classId) {
            const classData = await prisma.class.findUnique({
                where: { id: student.classId }
            });
            if (classData) {
                className = `${classData.name} ${classData.section || ''}`.trim();
            }
        }

        // 3. Validate the PIN
        const validPin = await prisma.resultPin.findFirst({
            where: { 
                pin, 
                adminId: school.id,
                studentId: student.id 
            }
        });

        // If PIN doesn't match, return error (DO NOT COUNT ERRORS)
        if (!validPin) {
            return res.status(400).json({ success: false, message: 'Invalid PIN for this student' });
        }

        // ✅ 4. CHECK 5 VIEWS LIMIT
        if (validPin.usageCount >= 5) {
            return res.status(400).json({ success: false, message: 'This PIN has expired. You have reached the maximum limit of 5 views. Kindly contact the school in request for another one.' });
        }

        // ✅ 5. INCREMENT USAGE COUNT ON SUCCESS
        const newCount = validPin.usageCount + 1;
        const trialsLeft = 5 - newCount;

        await prisma.resultPin.update({
            where: { id: validPin.id },
            data: { 
                usageCount: newCount,
                isUsed: newCount >= 5 ? true : false, 
                usedAt: newCount >= 5 ? new Date() : validPin.usedAt
            }
        });

        // 6. Fetch Term and Session details manually
        const [term, session] = await Promise.all([
            prisma.term.findUnique({ where: { id: validPin.termId } }),
            prisma.session.findUnique({ where: { id: validPin.sessionId } })
        ]);

        // 7. Fetch Student Results
        const results = await prisma.continuousAssessment.findMany({
            where: {
                studentId: student.id,
                termId: validPin.termId,
                sessionId: validPin.sessionId,
                status: 'approved'
            }
        });

        if (results.length > 0) {
            const subjectIds = [...new Set(results.map(r => r.subjectId))];
            const subjects = await prisma.subject.findMany({
                where: { id: { in: subjectIds } }
            });
            const subjectMap = new Map(subjects.map(s => [s.id, s]));
            results.forEach(r => {
                r.subject = subjectMap.get(r.subjectId) || null;
            });
        }

        // 8. Fetch Comments
        const classTeacherComment = await prisma.classTeacherComment.findFirst({
            where: { 
                studentId: student.id, 
                term: term?.name || "",     
                session: session?.name || "" 
            }
        });

        const principalComment = await prisma.principalComment.findFirst({
            where: { 
                studentId: student.id, 
                termId: validPin.termId, 
                sessionId: validPin.sessionId 
            }
        });

        // ✅ 9. FETCH ATTENDANCE DATA
        let timesPresent = 0, timesOpen = 0;
        const attendanceRecord = await prisma.attendance.findFirst({ 
            where: { 
                adminId: school.id, 
                studentId: student.id, 
                term: term?.name, 
                session: session?.name 
            } 
        });
        if (attendanceRecord) timesPresent = attendanceRecord.timesPresent || 0;

        const schoolOpenDaysRecord = await prisma.schoolOpenDays.findFirst({ 
            where: { adminId: school.id, termId: validPin.termId, sessionId: validPin.sessionId } 
        });
        if (schoolOpenDaysRecord) timesOpen = schoolOpenDaysRecord.timesOpen || 0;

        // 10. Return the full report card data
        res.json({
            success: true,
            data: {
                student: {
                    id: student.id, 
                    firstName: student.firstName,
                    lastName: student.lastName,
                    admissionNumber: student.admissionNumber,
                    gender: student.gender || "N/A", 
                    className: className, 
                    profileImage: student.profileImage 
                },
                term: term,       
                session: session, 
                results,
                classTeacherComment,
                principalComment,
                attendance: { // ✅ ADDED ATTENDANCE TO RESPONSE
                    timesPresent,
                    timesOpen
                },
                trialsLeft: trialsLeft 
            }
        });

    } catch (error) {
        console.error('Error checking result:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};