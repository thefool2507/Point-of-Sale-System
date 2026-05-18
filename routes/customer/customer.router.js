const express = require("express");
const router = express.Router();
const path = require("path");
const multer = require("multer");

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  }
});

// File filter to only allow Excel files
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel' // .xls
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File harus berformat Excel (.xlsx atau .xls)'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Import controller
const customer = require("./customer.controller");

// Routes
// GET - Display all customers
router.get("/customer/index", customer.getAllCustomer);

// POST - Create single customer
router.post("/customer/tambah", customer.createSingleCustomer);

// POST - Update customer
router.post("/customer/edit/:id", customer.updateCustomer);

// POST - Delete customer (hard delete)
router.post("/customer/delete/:id", customer.deleteCustomer);

// POST - Soft delete customer (alternative)
router.post("/customer/soft-delete/:id", customer.softDeleteCustomer);

// POST - Upload customers from Excel
router.post("/customer/upload", upload.single("fileUpload"), customer.uploadNewCustomer);

// GET - Download customer data as Excel
router.get("/customer/download", customer.downloadCustomerData);

// GET - Download customer Excel template
router.get("/customer/download-template", customer.downloadCustomerTemplate);

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      req.flash("error", "File terlalu besar. Maksimal 5MB");
    } else {
      req.flash("error", "Error upload file: " + error.message);
    }
    return res.redirect("/customer/index");
  } else if (error) {
    req.flash("error", error.message);
    return res.redirect("/customer/index");
  }
  next();
});

module.exports = router;