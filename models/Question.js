const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
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
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    explanation: { type: String },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    isActive: { type: Boolean, default: true }
}, { 
    timestamps: true // Added timestamps for consistency
});

// Compound index for fast multi-tenant queries (e.g., fetching all questions for a school's specific class/subject)
questionSchema.index({ adminId: 1, classId: 1, subjectId: 1 });

module.exports = mongoose.model('Question', questionSchema);