const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
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
        // Removed unique: true so multiple schools can use the same session name (e.g., "2024/2025")
        trim: true,
        maxlength: [20, 'Session name cannot exceed 20 characters']
    }, // e.g., "2024/2025"
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Ensure a school can't create two sessions with the exact same name
sessionSchema.index({ adminId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Session', sessionSchema);