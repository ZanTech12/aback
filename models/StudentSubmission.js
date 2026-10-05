const mongoose = require('mongoose');

const studentSubmissionSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    questionText: { type: String, required: true },
    options: { type: [String], required: true },
    correctAnswer: { type: Number, required: true },
    explanation: String,
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    isActive: { type: Boolean, default: true }
}, { 
    timestamps: true // Added timestamps for consistency
});

// Compound index for fast multi-tenant queries
studentSubmissionSchema.index({ adminId: 1, classId: 1, studentId: 1 });

module.exports = mongoose.model('StudentSubmission', studentSubmissionSchema);