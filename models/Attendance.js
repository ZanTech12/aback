const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true // Speeds up queries when fetching attendance for a specific school
    },
    student_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Student', 
        required: true 
    },
    class_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Class', 
        required: true 
    },
    term: { 
        type: String, 
        required: true,
        trim: true,
        index: true
    },
    session: { 
        type: String, 
        required: true,
        trim: true,
        index: true
    },
    times_present: { 
        type: Number, 
        default: 0,
        min: 0
    },
    teacher_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Teacher' 
    },
    isActive: { type: Boolean, default: true }
}, { 
    timestamps: true 
});

// Prevent duplicate attendance records for the same student/class/term/session
// Added adminId to the unique index to ensure isolation per school
attendanceSchema.index({ 
    adminId: 1, 
    student_id: 1, 
    class_id: 1, 
    term: 1, 
    session: 1 
}, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);