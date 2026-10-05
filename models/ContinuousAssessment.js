const mongoose = require('mongoose');

const continuousAssessmentSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    termId: { type: mongoose.Schema.Types.ObjectId, ref: 'Term', required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    
    // CA Components (total 40)
    testScore: { type: Number, default: 0, min: 0, max: 20 },
    noteTakingScore: { type: Number, default: 0, min: 0, max: 10 },
    assignmentScore: { type: Number, default: 0, min: 0, max: 10 },
    totalCA: { type: Number, default: 0 },
    
    // Exam Score (60 marks)
    examScore: { type: Number, default: 0, min: 0, max: 60 },
    
    // Total Score (100 marks)
    totalScore: { type: Number, default: 0 },
    
    // Grade
    grade: { type: String, default: '' },
    remark: { type: String, default: '' },
    
    // Source tracking
    sourceTestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test' },
    
    // Approval status
    status: { type: String, enum: ['draft', 'submitted', 'approved'], default: 'draft' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    approvedAt: { type: Date },
    isActive: { type: Boolean, default: true }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Updated unique index to include adminId
continuousAssessmentSchema.index({ 
    adminId: 1, 
    studentId: 1, 
    classId: 1, 
    subjectId: 1, 
    termId: 1, 
    sessionId: 1 
}, { unique: true });

module.exports = mongoose.model('ContinuousAssessment', continuousAssessmentSchema);