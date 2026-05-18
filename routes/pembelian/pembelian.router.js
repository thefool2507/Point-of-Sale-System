const express = require("express");
const router = express.Router();

const pembelian = require("./pembelian.controller"); // Perbaiki nama import

// Routes untuk halaman
router.get("/pembelian/index", pembelian.getPembelianIndexPage);
router.get("/pembelian/baru", pembelian.getPembelianBaruPage);

// API routes yang dibutuhkan oleh frontend
router.post("/api/pembelian", pembelian.createPembelian);
router.put("/api/pembelian/:id/status", pembelian.updatePembelianStatus);
router.get("/api/pembelian", pembelian.getPembelianList); // untuk tabel di index

module.exports = router;