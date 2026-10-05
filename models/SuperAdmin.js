const mongoose = require('mongoose');

const superAdminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    role: { type: String, default: 'superadmin' } // Standardized to lowercase
}, { timestamps: true });

module.exports = mongoose.model('SuperAdmin', superAdminSchema);