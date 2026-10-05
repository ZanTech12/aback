const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    
    // ── SuperAdmin Managed Fields ──
    schoolName: { 
        type: String, 
        required: [true, 'School name is required'], 
        trim: true 
    },
    // ── NEW: Unique School Code for Subdomains ──
    schoolCode: { 
        type: String, 
        unique: true, 
        uppercase: true,
        trim: true,
        index: true 
    },
    studentLimit: { 
        type: Number, 
        required: [true, 'Student limit is required'], 
        default: 0,
        min: [0, 'Student limit cannot be negative'] 
    },
    currentStudentCount: {
        type: Number,
        default: 0,
        min: 0
    },
    expiryDate: {
        type: Date,
        required: [true, 'Expiry date is required']
    },
    isActive: {
        type: Boolean,
        default: true
    },
    deactivatedAt: {
        type: Date,
        default: null
    }
}, { 
    timestamps: true 
});

// Helper method to check if the account is valid based on countdown
adminSchema.methods.checkExpiryStatus = function() {
    if (this.expiryDate && new Date() > this.expiryDate) {
        if (this.isActive) {
            this.isActive = false;
            this.deactivatedAt = new Date();
            this.save();
        }
        return false;
    }
    return this.isActive;
};

// Helper method to check if they can register a new student
adminSchema.methods.canRegisterStudent = function() {
    return this.checkExpiryStatus() && this.currentStudentCount < this.studentLimit;
};

module.exports = mongoose.model('Admin', adminSchema);