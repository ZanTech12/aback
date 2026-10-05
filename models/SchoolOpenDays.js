const mongoose = require('mongoose');

const schoolOpenDaysSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    term_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Term', 
        required: true 
    },
    session_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Session', 
        required: true 
    },
    times_open: { 
        type: Number, 
        required: true, 
        default: 0,
        min: [0, 'Times open cannot be negative']
    }
}, { 
    timestamps: true 
});

// Prevent duplicate records for same term/session within the same school
schoolOpenDaysSchema.index({ adminId: 1, term_id: 1, session_id: 1 }, { unique: true });

module.exports = mongoose.model('SchoolOpenDays', schoolOpenDaysSchema);