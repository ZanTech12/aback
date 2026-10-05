const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ==========================================================
// HELPERS
// ==========================================================

const uploadToCloudinary = (buffer, folderName) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: folderName,
                resource_type: 'image'
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        uploadStream.end(buffer);
    });
};

const withAbsoluteMedia = (req, info) => ({
    ...info,
    schoolLogo: info.schoolLogo || null,
    principalSignature: info.principalSignature || null,
    schoolStamp: info.schoolStamp || null,
});

const requireAdminRole = (req, res) => {
    if (!['admin', 'superadmin'].includes(req.user?.role)) {
        res.status(403).json({ success: false, message: 'Access denied.' });
        return false;
    }
    return true;
};

// ==========================================================
// GET /site-information
// ==========================================================
exports.getSiteInfo = async (req, res) => {
    try {
        const tenantFilter = getTenantFilter(req);

        const info = await prisma.siteInformation.findFirst({
            where: tenantFilter
        });

        if (!info) {
            return res.status(200).json({ success: true, data: {} });
        }

        res.status(200).json({
            success: true,
            data: withAbsoluteMedia(req, info)
        });
    } catch (error) {
        console.error('Error fetching site info:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// ==========================================================
// PUT /site-information (Creates or Updates)
// ==========================================================
exports.upsertSiteInfo = async (req, res) => {
    try {
        const tenantFilter = getTenantFilter(req);

        const { id, adminId: bodyAdminId, admissionCounter, createdAt, updatedAt, ...updateData } = req.body;

        let adminId = tenantFilter.adminId ?? (bodyAdminId != null ? parseInt(bodyAdminId) : undefined);
        if (adminId == null || !Number.isFinite(Number(adminId))) {
            const existing = await prisma.siteInformation.findFirst();
            adminId = existing?.adminId;
        }
        adminId = adminId != null ? Number(adminId) : null;

        if (!adminId) {
            return res.status(400).json({ success: false, message: 'Admin ID is required to save site information.' });
        }

        const existingInfo = await prisma.siteInformation.findUnique({ where: { adminId } });

        if (req.files) {
            if (req.files.schoolLogo && req.files.schoolLogo[0]) {
                if (existingInfo?.schoolLogo?.publicId) {
                    await cloudinary.uploader.destroy(existingInfo.schoolLogo.publicId).catch(err => console.error("Cloudinary delete error:", err));
                }
                const result = await uploadToCloudinary(req.files.schoolLogo[0].buffer, 'site_settings/logos');
                updateData.schoolLogo = { url: result.secure_url, publicId: result.public_id };
            }
            if (req.files.principalSignature && req.files.principalSignature[0]) {
                if (existingInfo?.principalSignature?.publicId) {
                    await cloudinary.uploader.destroy(existingInfo.principalSignature.publicId).catch(err => console.error("Cloudinary delete error:", err));
                }
                const result = await uploadToCloudinary(req.files.principalSignature[0].buffer, 'site_settings/signatures');
                updateData.principalSignature = { url: result.secure_url, publicId: result.public_id };
            }
            if (req.files.schoolStamp && req.files.schoolStamp[0]) {
                if (existingInfo?.schoolStamp?.publicId) {
                    await cloudinary.uploader.destroy(existingInfo.schoolStamp.publicId).catch(err => console.error("Cloudinary delete error:", err));
                }
                const result = await uploadToCloudinary(req.files.schoolStamp[0].buffer, 'site_settings/stamps');
                updateData.schoolStamp = { url: result.secure_url, publicId: result.public_id };
            }
        }

        const updatedInfo = await prisma.siteInformation.upsert({
            where: { adminId: adminId },
            update: updateData,
            create: {
                ...updateData,
                adminId: adminId
            }
        });

        res.status(200).json({
            success: true,
            data: { ...withAbsoluteMedia(req, updatedInfo), _id: updatedInfo.id },
            message: 'Site information saved successfully'
        });
    } catch (error) {
        console.error('Error updating site info:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ==========================================================
// DELETE /site-information/image/:field (Deletes a single image)
// ==========================================================
exports.deleteSingleImage = async (req, res) => {
    try {
        const { field } = req.params;
        const tenantFilter = getTenantFilter(req);

        const validFields = ['schoolLogo', 'principalSignature', 'schoolStamp'];
        if (!validFields.includes(field)) {
            return res.status(400).json({ success: false, message: 'Invalid image field specified.' });
        }

        const info = await prisma.siteInformation.findFirst({ where: tenantFilter });
        if (!info) {
            return res.status(404).json({ success: false, message: 'Site settings not found.' });
        }

        if (info[field]?.publicId) {
            await cloudinary.uploader.destroy(info[field].publicId).catch(err => console.error("Cloudinary delete error:", err));
        }

        const updateData = {};
        updateData[field] = { url: null, publicId: null };

        await prisma.siteInformation.update({
            where: { adminId: info.adminId },
            data: updateData
        });

        res.status(200).json({ 
            success: true, 
            message: `${field} removed successfully.` 
        });
    } catch (error) {
        console.error('Error deleting single image:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error', 
            error: error.message 
        });
    }
};

// ==========================================================
// DELETE /site-information (Deletes the entire record)
// ==========================================================
exports.deleteSiteInfo = async (req, res) => {
    try {
        const tenantFilter = getTenantFilter(req);

        if (tenantFilter.adminId) {
            const info = await prisma.siteInformation.findUnique({ where: { adminId: tenantFilter.adminId } });
            if (info) {
                if (info.schoolLogo?.publicId) await cloudinary.uploader.destroy(info.schoolLogo.publicId).catch(e => console.log(e));
                if (info.principalSignature?.publicId) await cloudinary.uploader.destroy(info.principalSignature.publicId).catch(e => console.log(e));
                if (info.schoolStamp?.publicId) await cloudinary.uploader.destroy(info.schoolStamp.publicId).catch(e => console.log(e));
            }

            try {
                await prisma.siteInformation.delete({
                    where: { adminId: tenantFilter.adminId }
                });
            } catch (err) {
                if (err.code !== 'P2025') throw err;
            }
        }

        res.status(200).json({
            success: true,
            message: 'Site information deleted'
        });
    } catch (error) {
        console.error('Error deleting site info:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// ==========================================================
// ✅ NEW: NETWORK SETTINGS (Get & Update)
// ==========================================================

// GET /site-information/network-settings
exports.getNetworkSettings = async (req, res) => {
    try {
        // ✅ FIX: Parse ID to integer
        const adminId = parseInt(req.user.id);
        
        const admin = await prisma.admin.findUnique({ 
            where: { id: adminId }, 
            select: { networkSettings: true } 
        });
        
        res.status(200).json({ 
            success: true, 
            data: admin?.networkSettings || { ip: 'localhost', port: '5000' } 
        });
    } catch (error) {
        console.error('Error fetching network settings:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// PUT /site-information/network-settings
exports.updateNetworkSettings = async (req, res) => {
    try {
        const { ip, port } = req.body;
        
        // ✅ FIX: Parse ID to integer
        const adminId = parseInt(req.user.id);
        
        const updatedAdmin = await prisma.admin.update({
            where: { id: adminId },
            data: { networkSettings: { ip, port } }
        });
        
        res.status(200).json({ 
            success: true, 
            data: updatedAdmin.networkSettings 
        });
    } catch (error) {
        console.error('Error updating network settings:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};