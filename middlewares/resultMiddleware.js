const Student = require('../models/Student');
const Term = require('../models/Term');
const ResultAccessSchedule = require('../models/ResultAccessSchedule');

// ===================================================================
// *** RESULT ACCESS CHECK MIDDLEWARE ***
// ===================================================================
const checkResultAccess = async (req, res, next) => {
    try {
        // Only apply to student role checking results
        if (req.user && req.user.role === 'student') {
            const student = await Student.findById(req.user.id)
                .populate('classId', 'name level section resultAccessBlocked resultBlockReason');
            
            if (!student) {
                return res.status(404).json({
                    success: false,
                    message: 'Student not found',
                    code: 'STUDENT_NOT_FOUND'
                });
            }

            // CHECK 1: FEES_BLOCKED
            if (student.owingFees && !student.feesAccessGranted) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. Please contact the school administration regarding your outstanding fees.',
                    code: 'FEES_BLOCKED',
                    data: { blocked: true, blockLevel: 'fees', blockReason: 'Outstanding school fees' }
                });
            }

            // CHECK 2: STUDENT_BLOCKED
            if (student.resultAccessBlocked) {
                return res.status(403).json({
                    success: false,
                    message: student.resultBlockReason || 'Your access to results has been blocked by the school administration.',
                    code: 'STUDENT_BLOCKED',
                    data: { blocked: true, blockLevel: 'student', blockReason: student.resultBlockReason }
                });
            }

            // CHECK 3: CLASS_BLOCKED
            if (student.classId && student.classId.resultAccessBlocked) {
                return res.status(403).json({
                    success: false,
                    message: student.classId.resultBlockReason || `Result access is currently blocked for ${student.classId.name}.`,
                    code: 'CLASS_BLOCKED',
                    data: { blocked: true, blockLevel: 'class', blockReason: student.classId.resultBlockReason }
                });
            }

            // CHECK 4 & 5: RESULT SCHEDULE
            const activeTerm = await Term.findOne({ status: 'active', isActive: true });
            if (activeTerm) {
                const schedule = await ResultAccessSchedule.findOne({ termId: activeTerm._id, isActive: true });

                if (schedule) {
                    const now = new Date();
                    const startTime = new Date(schedule.resultStartTime);
                    const deadline = new Date(schedule.resultDeadline);

                    if (now < startTime) {
                        const timeUntilStart = startTime - now;
                        const hoursUntil = Math.floor(timeUntilStart / (1000 * 60 * 60));
                        const minutesUntil = Math.floor((timeUntilStart % (1000 * 60 * 60)) / (1000 * 60));
                        
                        let timeDisplay = '';
                        if (hoursUntil > 24) timeDisplay = `Results will be available in ${Math.floor(hoursUntil / 24)} day(s)`;
                        else if (hoursUntil > 0) timeDisplay = `Results will be available in ${hoursUntil} hour(s) and ${minutesUntil} minute(s)`;
                        else timeDisplay = `Results will be available in ${minutesUntil} minute(s)`;

                        return res.status(403).json({
                            success: false,
                            message: schedule.message || 'Results are not yet available.',
                            code: 'RESULTS_NOT_YET_AVAILABLE',
                            data: { scheduleActive: true, status: 'before_start', timeDisplay: timeDisplay }
                        });
                    }

                    if (now > deadline) {
                        return res.status(403).json({
                            success: false,
                            message: 'The result viewing period has ended.',
                            code: 'RESULTS_DEADLINE_PASSED',
                            data: { scheduleActive: true, status: 'deadline_passed' }
                        });
                    }

                    req.resultSchedule = { resultStartTime: schedule.resultStartTime, resultDeadline: schedule.resultDeadline, isActive: true };
                }
            }
        }
        
        next();
    } catch (error) {
        console.error('[RESULT ACCESS CHECK] Error:', error);
        res.status(500).json({ success: false, message: 'Error checking result access', code: 'ACCESS_CHECK_ERROR' });
    }
};

// Public version for /student/check-results (no auth required)
const checkPublicResultAccess = async (req, res, next) => {
    try {
        const { admissionNumber, firstName } = req.body;
        
        if (!admissionNumber || !firstName) return next(); 

        const cleanAdmissionNumber = admissionNumber.trim();
        const cleanFirstName = firstName.trim();

        const student = await Student.findOne({
            admissionNumber: { $regex: `^${cleanAdmissionNumber}$`, $options: 'i' },
            firstName: { $regex: `^${cleanFirstName}$`, $options: 'i' },
            isDeleted: { $ne: true }
        }).populate('classId', 'name level section resultAccessBlocked resultBlockReason');

        if (!student) return next(); 

        if (student.owingFees && !student.feesAccessGranted) {
            return res.status(403).json({ success: false, message: 'Access denied. Outstanding fees.', code: 'FEES_BLOCKED' });
        }

        if (student.resultAccessBlocked) {
            return res.status(403).json({ success: false, message: student.resultBlockReason || 'Blocked by administration.', code: 'STUDENT_BLOCKED' });
        }

        if (student.classId && student.classId.resultAccessBlocked) {
            return res.status(403).json({ success: false, message: student.classId.resultBlockReason || `Blocked for class ${student.classId.name}.`, code: 'CLASS_BLOCKED' });
        }

        const activeTerm = await Term.findOne({ status: 'active', isActive: true });
        if (activeTerm) {
            const schedule = await ResultAccessSchedule.findOne({ termId: activeTerm._id, isActive: true });

            if (schedule) {
                const now = new Date();
                const startTime = new Date(schedule.resultStartTime);
                const deadline = new Date(schedule.resultDeadline);

                if (now < startTime || now > deadline) {
                    return res.status(403).json({ success: false, message: 'Results are not currently available.', code: 'SCHEDULE_BLOCKED' });
                }
                
                req.resultSchedule = { resultStartTime: schedule.resultStartTime, resultDeadline: schedule.resultDeadline, isActive: true };
            }
        }

        req.checkedStudent = student;
        next();
    } catch (error) {
        console.error('[PUBLIC RESULT ACCESS CHECK] Error:', error);
        res.status(500).json({ success: false, message: 'Error checking result access', code: 'ACCESS_CHECK_ERROR' });
    }
};

module.exports = {
    checkResultAccess,
    checkPublicResultAccess
};