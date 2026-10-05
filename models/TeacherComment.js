const mongoose = require('mongoose');

const teacherCommentSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    termId: { type: mongoose.Schema.Types.ObjectId, ref: 'Term', required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    comment: { type: String, required: true, trim: true },
    effortRating: { 
        type: String, 
        enum: ['excellent', 'very_good', 'good', 'fair', 'poor', ''],
        default: ''
    },
    behaviourRating: { 
        type: String, 
        enum: ['excellent', 'very_good', 'good', 'fair', 'poor', ''],
        default: ''
    },
    status: { 
        type: String, 
        enum: ['draft', 'submitted', 'approved'], 
        default: 'draft' 
    },
    submittedAt: { type: Date },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    approvedAt: { type: Date },
    isActive: { type: Boolean, default: true }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Prevent duplicate comments for same student/class/subject/term/session WITHIN the same school
teacherCommentSchema.index({ 
    adminId: 1, 
    studentId: 1, 
    classId: 1, 
    subjectId: 1, 
    termId: 1, 
    sessionId: 1 
}, { unique: true });

// Updated indexes to include adminId for isolated, fast queries
teacherCommentSchema.index({ adminId: 1, teacherId: 1, status: 1 });
teacherCommentSchema.index({ adminId: 1, classId: 1, subjectId: 1, termId: 1, sessionId: 1 });

module.exports = mongoose.model('TeacherComment', teacherCommentSchema);