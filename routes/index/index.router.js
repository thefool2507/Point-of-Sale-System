const express = require("express");
const router = express.Router();
const index = require("./index.controller");

// Middleware untuk authentication (sesuaikan dengan sistem auth Anda)
const requireAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }
  // Jika tidak ada session, redirect ke login
  return res.redirect('/login');
};

// Middleware untuk role-based access (opsional)
const requireRole = (roles) => {
  return (req, res, next) => {
    if (req.user && roles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).render('error/403', { 
      message: 'Access denied',
      user: req.user 
    });
  };
};

// Dashboard utama
router.route("/")
  .get(requireAuth, index.getAdminPage);

// API endpoint untuk update dashboard secara real-time
router.route("/api/dashboard")
  .get(requireAuth, index.getDashboardAPI);

// Export dashboard report
router.route("/export/dashboard")
  .get(requireAuth, requireRole(['Admin', 'Manager']), index.exportDashboardReport);

// Sub pages
router.route("/admin/overview")
  .get(requireAuth, index.getOverviewPage);

router.route("/index/submodule")
  .get(requireAuth, requireRole(['Admin']), index.getSubModulePage);

module.exports = router;