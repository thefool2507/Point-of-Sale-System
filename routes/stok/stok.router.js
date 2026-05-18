const express = require("express");
const router = express.Router();
const multer = require("multer");

const stok = require("./stok.controller");

const upload = multer({ dest: "uploads/" });

router.get("/stok/index", stok.getAllStok);
router.post("/stok/delete/:id", stok.deleteBarang);
router.post("/stok/update", stok.updateBarang);
router.get("/stok/download", stok.downloadStok);
router.get("/stok/download-template", stok.downloadStokTemplate);
router.post("/stok/tambah", stok.tambahBarang);
router.post("/stok/upload", upload.single("fileUpload"), stok.uploadNewStok);

module.exports = router;