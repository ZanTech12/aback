const mongoose = require('mongoose');

const classTeacherCommentSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
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
    teacher_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Teacher', 
        required: true 
    },
    comment: { 
        type: String, 
        required: true,
        trim: true 
    },
    term: { 
        type: String, 
        required: true,
        trim: true
    },
    session: { 
        type: String, 
        required: true,
        trim: true
    },
    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { 
    timestamps: true 
});

// Prevent duplicate comments for same student/class/term/session within the same school
classTeacherCommentSchema.index({ 
    adminId: 1, 
    student_id: 1, 
    class_id: 1, 
    term: 1, 
    session: 1 
}, { unique: true });

classTeacherCommentSchema.index({ adminId: 1, class_id: 1, term: 1, session: 1 });

module.exports = mongoose.model('ClassTeacherComment', classTeacherCommentSchema);