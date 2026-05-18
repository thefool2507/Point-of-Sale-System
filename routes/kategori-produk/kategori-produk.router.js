const express = require("express");
const router = express.Router();
const kategoriproduk = require("./kategori-produk.controller");
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

router.get("/kategori-produk/index", kategoriproduk.getAllKategoriProduk);
router.post("/kategori-produk/delete/:id", kategoriproduk.deleteKategoriProduk);
router.post("/kategori-produk/update", kategoriproduk.updateKategoriProduk);
router.get("/kategori-produk/download", kategoriproduk.downloadKategoriProduk);
router.post("/kategori-produk/tambah", kategoriproduk.tambahKategoriProduk);
router.get("/kategori-produk/download-template", kategoriproduk.downloadKategoriProdukTemplate);

router.post("/kategori-produk/upload", upload.single("fileUpload"), kategoriproduk.uploadNewKategoriProduk);

module.exports = router;