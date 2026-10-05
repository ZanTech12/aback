const mongoose = require('mongoose');

const teacherAssignmentSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    teacher_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Teacher',
        required: true
    },
    class_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class',
        required: true
    },
    subject_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subject',
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Ensure a teacher isn't assigned to the same class/subject twice WITHIN the same school
teacherAssignmentSchema.index({ adminId: 1, teacher_id: 1, class_id: 1, subject_id: 1 }, { unique: true });

module.exports = mongoose.model('TeacherAssignment', teacherAssignmentSchema);