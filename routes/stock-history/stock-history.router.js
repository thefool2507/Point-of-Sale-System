const express = require("express");
const router = express.Router();
const stockhistory = require("./stock-history.controller");
const multer = require("multer");
const path = require("path");

router.get("/stock-history/index", stockhistory.getAllStockhistory);
router.get("/stock-history/download", stockhistory.downloadStockhistory);

module.exports = router;