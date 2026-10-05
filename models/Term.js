const mongoose = require('mongoose');

const termSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    name: { 
        type: String, 
        required: true, 
        enum: ['First Term', 'Second Term', 'Third Term'],
        trim: true
    },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    nextTermBegins: { type: Date },
    status: { type: String, enum: ['upcoming', 'active', 'completed'], default: 'upcoming' },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Ensure a school can't create two terms with the same name for the same session
termSchema.index({ adminId: 1, name: 1, session: 1 }, { unique: true });

module.exports = mongoose.model('Term', termSchema);