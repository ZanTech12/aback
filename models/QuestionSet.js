const mongoose = require('mongoose');

const questionSetSchema = new mongoose.Schema({
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
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    questions: [{
        questionText: { type: String, required: true },
        difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
        options: { type: [String], required: true },
        correctAnswer: { type: Number, required: true },
        explanation: { type: String }
    }],
    isActive: { type: Boolean, default: true }
}, {
    timestamps: true
});

// Ensure a school can't create two question sets with the exact same title
questionSetSchema.index({ adminId: 1, title: 1 }, { unique: true });

// Optimize queries when fetching all question sets for a specific class/subject in a school
questionSetSchema.index({ adminId: 1, classId: 1, subjectId: 1 });

module.exports = mongoose.model('QuestionSet', questionSetSchema);