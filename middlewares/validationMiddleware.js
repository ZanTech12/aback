const validate = {
    createClass: (req, res, next) => {
        const { name, level, section, session, teacherId, capacity } = req.body;

        if (!name || !level || !section || !session || !teacherId || !capacity) {
            return res.status(400).json({ success: false, message: 'All required fields must be provided' });
        }

        if (name.length < 2 || name.length > 100) {
            return res.status(400).json({ success: false, message: 'Class name must be between 2 and 100 characters' });
        }

        if (capacity < 1 || capacity > 200) {
            return res.status(400).json({ success: false, message: 'Capacity must be between 1 and 200' });
        }

        if (section.length > 10) {
            return res.status(400).json({ success: false, message: 'Section cannot exceed 10 characters' });
        }

        next();
    },

    updateClass: (req, res, next) => {
        const { name, level, section, session, teacherId, capacity } = req.body;

        if (!name || !level || !section || !session || !teacherId || !capacity) {
            return res.status(400).json({ success: false, message: 'All required fields must be provided' });
        }

        if (name.length < 2 || name.length > 100) {
            return res.status(400).json({ success: false, message: 'Class name must be between 2 and 100 characters' });
        }

        if (capacity < 1 || capacity > 200) {
            return res.status(400).json({ success: false, message: 'Capacity must be between 1 and 200' });
        }

        next();
    }
};

module.exports = validate;