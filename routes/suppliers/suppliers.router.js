const express = require("express");
const router = express.Router();
const suppliers = require("./suppliers.controller");
const multer = require("multer");
const path = require("path");

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

const upload = multer({ storage: storage });

router.get("/suppliers/index", suppliers.getAllSuppliers);
router.post("/suppliers/delete/:id", suppliers.deleteSuppliers);
router.post("/suppliers/update", suppliers.updateSuppliers);
router.get("/suppliers/download", suppliers.downloadSuppliers);
router.post("/suppliers/tambah", suppliers.tambahSuppliers);
router.get("/suppliers/download-template", suppliers.downloadSuppliersTemplate);

router.post("/suppliers/upload", upload.single("fileUpload"), suppliers.uploadNewSuppliers);

module.exports = router;