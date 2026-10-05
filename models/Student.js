const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    // Removed unique: true so multiple schools can use the same admission number format
    admissionNumber: { type: String, index: true }, 
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    owingFees: { type: Boolean, default: false },
    feesAccessGranted: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    profileImage: {
        url: { type: String, default: '' },
        publicId: { type: String, default: '' },
        uploadedAt: { type: Date },
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 },
        format: { type: String, default: '' },
        size: { type: Number, default: 0 }
    },
    resultAccessBlocked: { type: Boolean, default: false },
    resultBlockReason: { type: String, default: '' },
    resultBlockedAt: { type: Date },
    resultBlockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    testResults: [{
        testId: String,
        score: Number,
        totalQuestions: Number,
        percentage: Number,
        timeTaken: Number,
        passed: Boolean,
        date: { type: Date, default: Date.now }
    }]
}, {
    timestamps: true // Added timestamps for consistency
});

// Ensure admission numbers are only unique WITHIN a specific school
studentSchema.index({ adminId: 1, admissionNumber: 1 }, { unique: true });

// Auto-generate admission number before saving
studentSchema.pre('save', async function() {
    if (!this.admissionNumber) {
        const currentYear = new Date().getFullYear().toString();
        const prefix = `DIS/${currentYear}/`;

        // 👇 Find the last student ONLY within the same school
        const lastStudent = await this.constructor.findOne({
            adminId: this.adminId, 
            admissionNumber: { $regex: `^${prefix}` }
        }).sort({ admissionNumber: -1 }).limit(1);

        let nextNumber = 1;

        if (lastStudent && lastStudent.admissionNumber) {
            const parts = lastStudent.admissionNumber.split('/');
            const lastNumber = parseInt(parts[2], 10);
            if (!isNaN(lastNumber)) {
                nextNumber = lastNumber + 1;
            }
        }

        const paddedNumber = String(nextNumber).padStart(3, '0');
        this.admissionNumber = `${prefix}${paddedNumber}`;
    }
});

module.exports = mongoose.model('Student', studentSchema);