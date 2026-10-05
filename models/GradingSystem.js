const mongoose = require('mongoose');

const gradingSystemSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    name: { type: String, required: true, trim: true }, // e.g., "Standard Grading"
    grades: [{
        grade: { type: String, required: true, trim: true }, // A, B, C, D, F
        minScore: { type: Number, required: true, min: 0, max: 100 },
        maxScore: { type: Number, required: true, min: 0, max: 100 },
        remark: { type: String, trim: true }, // Excellent, Very Good, Good, Fair, Poor
        description: { type: String, trim: true }
    }],
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Ensure a school can't create two grading systems with the same name
gradingSystemSchema.index({ adminId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('GradingSystem', gradingSystemSchema);