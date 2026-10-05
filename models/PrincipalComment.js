const mongoose = require('mongoose');

const principalCommentSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    termId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Term',
        required: true
    },
    sessionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Session',
        required: true
    },
    classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class'
    },
    comment: {
        type: String,
        required: true
    },
    percentage: {
        type: Number,
        default: 0
    },
    classTeacherComment: {
        type: String
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true }
});

// Index for unique student per term/session within the same school
principalCommentSchema.index(
    { adminId: 1, studentId: 1, termId: 1, sessionId: 1 }, 
    { unique: true }
);

module.exports = mongoose.model('PrincipalComment', principalCommentSchema);