const mongoose = require('mongoose');

const teacherSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    // Removed unique: true so multiple schools can have teachers with the same email/username
    email: { type: String, required: true, index: true, trim: true, lowercase: true }, 
    username: { type: String, required: true, index: true, trim: true },
    password: { type: String, required: true },
    phone: String,
    address: String,
    qualification: String,
    experience: { type: Number, default: 0 },
    subjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
    // ── Last Login Tracking ──
    lastLogin: { type: Date, default: null },
    lastLoginIP: { type: String, default: '' },
    lastLoginDevice: { type: String, default: '' }
}, { 
    timestamps: true // Added timestamps for consistency
});

// Ensure teacher emails and usernames are only unique WITHIN a specific school
teacherSchema.index({ adminId: 1, email: 1 }, { unique: true });
teacherSchema.index({ adminId: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('Teacher', teacherSchema);