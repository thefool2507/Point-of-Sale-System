const express = require("express");
const router = express.Router();
const produk = require("./produk.controller");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept Excel files only
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel') {
    cb(null, true);
  } else {
    cb(new Error('Only Excel files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
};

// Middleware to check admin/manager role
const requireAdminOrManager = (req, res, next) => {
  if (!req.session.user || (req.session.user.role !== 'Admin' && req.session.user.role !== 'Manager')) {
    return res.status(403).json({ message: 'Akses ditolak. Hanya Admin atau Manager yang dapat melakukan aksi ini.' });
  }
  next();
};

// Routes - PENTING: Route statis harus di atas route dinamis
router.get("/produk/index", requireAuth, produk.getAllProduk);
router.get("/produk/export/excel", requireAuth, produk.exportProduk);
router.post("/produk/import/excel", requireAuth, requireAdminOrManager, upload.single('file'), produk.importProduk);

// Route dinamis di bawah
router.get("/produk/:id", requireAuth, produk.getProdukById);

// CRUD operations
router.post("/produk", requireAuth, requireAdminOrManager, produk.createProduk);
router.put("/produk/:id", requireAuth, requireAdminOrManager, produk.updateProduk);
router.delete("/produk/:id", requireAuth, requireAdminOrManager, produk.deleteProduk);

module.exports = router;