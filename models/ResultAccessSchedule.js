const mongoose = require('mongoose');

const resultAccessScheduleSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
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
    resultStartTime: {
        type: Date,
        required: true
    },
    resultDeadline: {
        type: Date,
        required: true
    },
    message: {
        type: String,
        default: 'Results are not available at this time. Please check back later.'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Ensure a school can't create multiple schedules for the same term and session
resultAccessScheduleSchema.index({ adminId: 1, termId: 1, sessionId: 1 }, { unique: true });

module.exports = mongoose.model('ResultAccessSchedule', resultAccessScheduleSchema);