const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    name: { type: String, required: true },
    // Removed unique: true so multiple schools can use the same subject code
    code: { type: String, required: true, index: true }, 
    classLevel: String,
    description: String
}, { 
    timestamps: true // Added timestamps for consistency
});

// Ensure subject codes are only unique WITHIN a specific school
subjectSchema.index({ adminId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('Subject', subjectSchema);