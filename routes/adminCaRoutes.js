const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authMiddleware').authenticateToken;
const ctrl = require('../controllers/adminCaController');

// ==========================================================
// 🔍 STARTUP DIAGNOSTIC — shows exactly what the controller exports
// ==========================================================
console.log('🧩 adminCaController exports:', Object.keys(ctrl).join(', '));

// ==========================================================
// 🛡️ RESOLVER — picks the first method name that actually exists
// on the controller; falls back to a safe 501 stub so the server
// never crashes with "argument handler must be a function".
// ==========================================================
const resolve = (...candidates) => {
    for (const name of candidates) {
        if (typeof ctrl[name] === 'function') {
            console.log(`✅ adminCaRoutes mapped → ctrl.${name}`);
            return ctrl[name];
        }
    }
    console.warn(`⚠️  adminCaRoutes: none of [${candidates.join(', ')}] exist in controller — returning 501 stub`);
    return (req, res) => res.status(501).json({
        success: false,
        message: `Not implemented: controller must export one of [${candidates.join(', ')}]`,
    });
};

// ==========================================================
// FILTERS / META
// Frontend: adminCAAPI.getFilterOptions({ status })
//           → GET /admin/ca/filter-options
// ==========================================================
router.get('/filter-options',   authenticateToken, resolve('getFilterOptions', 'filterOptions', 'getFilters'));
router.get('/teacher-progress', authenticateToken, resolve('getTeacherProgress', 'teacherProgress'));

// ==========================================================
// LISTING (paged) — registered BEFORE any /:id patterns
// Frontend: adminCAAPI.getAssessments({...})   → GET /admin/ca/all
// Frontend: adminCAAPI.getAllApproved({...})   → GET /admin/ca/all-approved
// ==========================================================
router.get('/all',          authenticateToken, resolve('getAssessments', 'getAllCAs', 'getAll', 'getAllAssessments', 'listAssessments', 'index'));
router.get('/all-approved', authenticateToken, resolve('getAllApproved', 'getAllApprovedCAs', 'listApproved', 'approvedCAs'));

// ==========================================================
// SINGLE APPROVE / UNAPPROVE
// Frontend: continuousAssessmentsAPI.approve(id)
//           → PUT /admin/ca/:id/approve
// Frontend: continuousAssessmentsAPI.unapprove(id)
//           → PUT /admin/ca/:id/unapprove
// ==========================================================
router.put('/:id/approve',   authenticateToken, resolve('approveCA', 'approve'));
router.put('/:id/unapprove', authenticateToken, resolve('unapproveCA', 'unapprove'));

// ==========================================================
// BULK
// Frontend: continuousAssessmentsAPI.bulkApproveByFilters(filters)
//           → POST /admin/ca/bulk/approve-by-filters
// Frontend: continuousAssessmentsAPI.bulkUnapprove(data)
//           → POST /admin/ca/bulk/unapprove
// Frontend: continuousAssessmentsAPI.bulkReapprove(ids)
//           → POST /admin/ca/bulk/approve-by-ids   body: { ids: [...] }
// ==========================================================
router.post('/bulk/approve-by-ids',      authenticateToken, resolve('bulkApproveByIds', 'bulkApprove'));
router.post('/bulk/approve-by-filters',  authenticateToken, resolve('bulkApproveByFilters', 'bulkApprove'));
router.post('/bulk/unapprove',           authenticateToken, resolve('bulkUnapprove'));

// ==========================================================
// CLEAR APPROVAL STATUS PANEL
// Frontend: adminCAAPI.getClassesWithApproved({ termId, sessionId })
//           → GET /admin/ca/classes-with-approved
// ==========================================================
router.get('/classes-with-approved', authenticateToken,
    resolve('getClassesWithApproved', 'getClassesWithApprovedCAs', 'classesWithApproved'));

// Frontend: adminCAAPI.getSubjectsWithApproved(classId, { termId, sessionId })
//           → GET /admin/ca/classes/:classId/subjects-with-approved
router.get('/classes/:classId/subjects-with-approved', authenticateToken,
    resolve('getSubjectsWithApproved', 'subjectsWithApproved'));

// Frontend: adminCAAPI.previewClearApproval({...})   ← GET
//           → GET /admin/ca/clear-approval-status/preview
router.get('/clear-approval-status/preview', authenticateToken,
    resolve('previewClearApproval', 'previewClear'));

// Frontend: adminCAAPI.clearApprovalStatus({...})    ← PATCH
//           → PATCH /admin/ca/clear-approval-status
router.patch('/clear-approval-status', authenticateToken,
    resolve('clearApprovalStatus', 'clearApproval'));

// Frontend: adminCAAPI.clearApprovalByIds([...], 'draft')  ← PATCH
//           → PATCH /admin/ca/clear-approval-status/by-ids
//           body: { assessmentIds: [...], resetTo: 'draft' }
router.patch('/clear-approval-status/by-ids', authenticateToken,
    resolve('clearApprovalByIds', 'clearApprovalByIdsBulk'));


    // PUT /admin/ca/:id — edit scores (recalculates totalCA, totalScore, grade)
router.put('/:id', authenticateToken, resolve('updateCA'));

// ==========================================
// TEMPORARY FIX ROUTE — DELETE AFTER USING
// Prisma-based: resets currentStudentCount for a given admin id
// Frontend/backend call: GET /admin/ca/fix-count/:adminId
// ==========================================
router.get('/fix-count/:id', authenticateToken, resolve('fixStudentCount'));

module.exports = router;