const mongoose = require('mongoose');

const siteInformationSchema = new mongoose.Schema({
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true, 
        index: true 
    },
    schoolName: { type: String, default: '' },
    shortName: { type: String, default: '' },
    schoolMotto: { type: String, default: '' },
    address: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: 'Nigeria' },
    phoneNumber: { type: String, default: '' },
    email: { type: String, default: '' },
    website: { type: String, default: '' },
    registrationNumber: { type: String, default: '' },
    principalName: { type: String, default: '' },
    schoolLogo: { url: { type: String, default: '' } },
    principalSignature: { url: { type: String, default: '' } },
    schoolStamp: { url: { type: String, default: '' } },
    
    // 👇 NEW FIELDS FOR ADMISSION NUMBER CONTROL
    admissionPrefix: { 
        type: String, 
        default: 'SCH', 
        trim: true,
        uppercase: true 
    },
    admissionCounter: { 
        type: Number, 
        default: 0 
    }
}, { timestamps: true });

module.exports = mongoose.model('SiteInformation', siteInformationSchema);