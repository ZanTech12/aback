const mongoose = require('mongoose');

const testSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    title: { type: String, required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    duration: { type: Number, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    passMark: { type: Number, required: true },
    instructions: { type: String },
    questions: [{
        questionText: { type: String, required: true },
        options: { type: [String], required: true },
        correctAnswer: { type: Number, required: true },
        difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
        explanation: { type: String }
    }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    isActive: { type: Boolean, default: true },
    resultsPublished: { type: Boolean, default: false },
    publishedAt: { type: Date }
}, {
    timestamps: true
});

// Compound index for fast multi-tenant queries (fetching tests for a specific class/subject)
testSchema.index({ adminId: 1, classId: 1, subjectId: 1 });

module.exports = mongoose.model('Test', testSchema);