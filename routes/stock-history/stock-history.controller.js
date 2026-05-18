const ExcelJS = require("exceljs");
const { db } = require("../../db/db");
const { log, LOG_LEVELS } = require("../../helpers/log");
const UAParser = require("ua-parser-js");
const { getClientIP } = require("../../helpers/getClientIP");
const fs = require("fs");
const path = require("path");

const getUserAgentData = (req) => {
  const parser = new UAParser(req.headers["user-agent"]);
  const result = parser.getResult();
  return {
    deviceType: result.device.type || (result.device.vendor ? "Mobile" : "Desktop"),
    browser: `${result.browser.name} ${result.browser.version}`,
    platform: `${result.os.name} ${result.os.version}`,
  };
};

const getAllStockhistory = async (req, res) => {
  try {
    const [stockList] = await db.query(
      `SELECT sh.id, b.nama AS barang_nama, sh.jumlah, sh.tipe, sh.reference_id, sh.reference_type,
              sh.keterangan, u.username AS user_username, sh.created_at
       FROM stock_history sh
       JOIN barangs b ON sh.barang_id = b.id
       JOIN users u ON sh.user_id = u.id
       ORDER BY sh.created_at DESC`
    );

    res.render("pages/stock-history/index", {
      stockList,
      success: req.flash("success"),
      error: req.flash("error")
    });
  } catch (error) {
    console.error("Error fetching stock history:", error);
    req.flash("error", "Gagal mengambil data riwayat stok");
    res.redirect("/");
  }
};

const downloadStockhistory = async (req, res) => {
  try {
    const [data] = await db.query(`
      SELECT sh.id, b.nama AS barang_nama, sh.jumlah, sh.tipe, sh.reference_id, sh.reference_type,
             sh.keterangan, u.username AS user_username, sh.created_at
      FROM stock_history sh
      JOIN barangs b ON sh.barang_id = b.id
      JOIN users u ON sh.user_id = u.id
      ORDER BY sh.created_at DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Stock History");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Barang", key: "barang_nama", width: 25 },
      { header: "Jumlah", key: "jumlah", width: 10 },
      { header: "Tipe", key: "tipe", width: 12 },
      { header: "Reference ID", key: "reference_id", width: 15 },
      { header: "Reference Type", key: "reference_type", width: 20 },
      { header: "Keterangan", key: "keterangan", width: 30 },
      { header: "User", key: "user_username", width: 20 },
      { header: "Created At", key: "created_at", width: 20 }
    ];

    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "D9D9D9" },
      };
    });

    data.forEach(row => worksheet.addRow(row));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=stock-history.xlsx");

    await workbook.xlsx.write(res);

    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    await log(
      `${req.session.user.username} DOWNLOADED STOCK HISTORY data`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.end();
  } catch (error) {
    console.error("Error Generating Excel File:", error.message, error.stack);
    res.status(500).send("Gagal Mendownload Data Riwayat Stok");
  }
};

module.exports = {
  getAllStockhistory,
  downloadStockhistory,
};