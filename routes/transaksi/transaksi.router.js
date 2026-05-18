const express = require("express");
const router = express.Router();
// const multer = require("multer");

const transaksi = require("./transaksi.controller");

// const upload = multer({ dest: "uploads/" });

// Transaction routes
router.get("/transaksi/index", transaksi.getAllTransaksi);
router.get("/transaksi/pos", transaksi.getPosPage);
router.post("/transaksi/process", transaksi.processTransaction);

// Sales report routes
router.get("/transaksi/laporan_penjualan", transaksi.getLaporanPenjualanPage);
router.get("/transaksi/analytics", transaksi.getSalesAnalyticsAPI); // API endpoint for analytics data
router.get("/transaksi/export", transaksi.exportSalesReport); // Export to Excel

module.exports = router;