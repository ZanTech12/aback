const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
    // ── MULTI-TENANT FIELD ──
    adminId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin', 
        required: true,
        index: true 
    },
    name: {
        type: String,
        required: [true, 'Class name is required'],
        trim: true,
        maxlength: [100, 'Class name cannot exceed 100 characters']
    },
    level: {
        type: String,
        required: [true, 'Class level is required'],
        trim: true
    },
    section: {
        type: String,
        required: [true, 'Class section is required'],
        trim: true,
        maxlength: [10, 'Section cannot exceed 10 characters']
    },
    session: {
        type: String,
        required: [true, 'Session is required'],
        trim: true
    },
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Teacher',
        required: [true, 'Teacher is required']
    },
    capacity: {
        type: Number,
        required: [true, 'Capacity is required'],
        min: [1, 'Capacity must be at least 1'],
        max: [200, 'Capacity cannot exceed 200']
    },
    subjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
    isActive: { type: Boolean, default: true },
    
    // ✅ NEW: Result Access Block Fields
    resultAccessBlocked: { type: Boolean, default: false },
    resultBlockReason: { type: String, default: '' },
    resultBlockedAt: { type: Date },
    resultBlockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Updated unique index to include adminId so multiple schools can have the same class name
classSchema.index({ adminId: 1, name: 1, level: 1, section: 1, session: 1 }, { unique: true });
classSchema.index({ teacherId: 1 });
classSchema.index({ isActive: 1 });

classSchema.virtual('studentCount', {
    ref: 'Student',
    localField: '_id',
    foreignField: 'classId',
    count: true
});

classSchema.pre('save', async function () {
    if (this.isNew || this.isModified('name') || this.isModified('level') || this.isModified('section') || this.isModified('session')) {
        // Check for duplicates ONLY within the same school (adminId)
        const existingClass = await this.constructor.findOne({
            adminId: this.adminId, // 👈 Added adminId to duplicate check
            _id: { $ne: this._id },
            name: this.name,
            level: this.level,
            section: this.section,
            session: this.session
        });

        if (existingClass) {
            const error = new Error('Class with this name, level, section, and session already exists');
            throw error;
        }
    }
});

module.exports = mongoose.model('Class', classSchema);