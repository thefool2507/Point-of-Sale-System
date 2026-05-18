const express = require("express");
const router = express.Router();

const returController = require("./retur.controller");

// Routes untuk halaman
router.get("/retur/index", returController.getReturIndexPage);
router.get("/retur/baru", returController.getReturBaruPage);
router.get("/retur/download", returController.downloadRetur); // PERBAIKAN: Ganti 'retur' menjadi 'returController'

// Export untuk laporan - PERBAIKAN: Pindah sebelum API routes dengan parameter
router.get("/api/retur/export/excel", returController.exportReturToExcel);

// API Routes
router.get("/api/retur", returController.getAllRetur);
router.get("/api/retur/:id", returController.getReturById);
router.post("/api/retur", returController.createRetur);
router.put("/api/retur/:id", returController.updateRetur);
router.delete("/api/retur/:id", returController.deleteRetur);

// API untuk pencarian transaksi
router.get("/api/transactions/search", returController.searchTransactions);
router.get("/api/transactions/:id/details", returController.getTransactionDetails);

// API untuk mengubah status retur
router.put("/api/retur/:id/status", returController.updateReturStatus);

module.exports = router;