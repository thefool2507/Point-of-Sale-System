const ExcelJS = require("exceljs");
const { db } = require("../../db/db");
const { log, LOG_LEVELS } = require("../../helpers/log");
const UAParser = require("ua-parser-js");
const { getClientIP } = require("../../helpers/getClientIP");
const fs = require("fs");
const path = require("path");

// Helper function to create consistent userAgentData
const getUserAgentData = (req) => {
  const parser = new UAParser(req.headers["user-agent"]);
  const result = parser.getResult();
  return {
    deviceType: result.device.type || (result.device.vendor ? "Mobile" : "Desktop"),
    browser: `${result.browser.name} ${result.browser.version}`,
    platform: `${result.os.name} ${result.os.version}`,
  };
};

// Helper function to log activity
const logActivity = async (userId, activity, req) => {
  try {
    const userAgentData = getUserAgentData(req);
    const clientIP = getClientIP(req);
    
    await db.execute(
      `INSERT INTO activity_logs (user_id, activity, ip_address, device_type, browser, platform) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, activity, clientIP, userAgentData.deviceType, userAgentData.browser, userAgentData.platform]
    );
  } catch (error) {
    console.error("Error logging activity:", error);
  }
};

// Helper function untuk format currency
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR'
  }).format(amount);
};

// Page Controllers
const getReturIndexPage = async (req, res) => { // PERBAIKAN: Tambah async
  try {
    const [returList] = await db.query(
      `SELECT r.id, r.transaction_id, c.nama AS customer_nama, u.username AS user_username,
              r.tanggal_retur, r.alasan, r.total_pengembalian, r.status
       FROM retur r
       JOIN customers c ON r.customer_id = c.id
       JOIN users u ON r.user_id = u.id
       ORDER BY r.tanggal_retur DESC`
    );

    res.render("pages/retur/index", {
      returList,
      success: req.flash("success"),
      error: req.flash("error")
    });
  } catch (error) {
    console.error("Error fetching retur data:", error);
    req.flash("error", "Gagal mengambil data retur");
    res.redirect("/");
  }
};

const downloadRetur = async (req, res) => {
  try {
    // PERBAIKAN: Tambah validasi session user
    if (!req.session.user || !req.session.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    const [data] = await db.query(`
      SELECT r.id, r.transaction_id, c.nama AS customer_nama, u.username AS user_username,
             r.tanggal_retur, r.alasan, r.total_pengembalian, r.status
      FROM retur r
      JOIN customers c ON r.customer_id = c.id
      JOIN users u ON r.user_id = u.id
      ORDER BY r.tanggal_retur DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data Retur");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Transaction ID", key: "transaction_id", width: 15 },
      { header: "Customer", key: "customer_nama", width: 25 },
      { header: "User", key: "user_username", width: 20 },
      { header: "Tanggal Retur", key: "tanggal_retur", width: 20 },
      { header: "Alasan", key: "alasan", width: 30 },
      { header: "Total Pengembalian", key: "total_pengembalian", width: 20 },
      { header: "Status", key: "status", width: 15 }
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
    res.setHeader("Content-Disposition", "attachment; filename=data-retur.xlsx");

    await workbook.xlsx.write(res);

    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    await log(
      `${req.session.user.username} DOWNLOADED RETUR data`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.end();
  } catch (error) {
    console.error("Error Generating Excel File:", error.message, error.stack);
    res.status(500).send("Gagal Mendownload Data Retur");
  }
};

const getReturBaruPage = (req, res) => {
  try {
    res.render("pages/retur/baru", {
      title: "Retur Baru",
      user: req.session.user,
      currentPage: "retur"
    });
  } catch (error) {
    console.error("Error rendering retur baru page:", error);
    res.status(500).send("Internal Server Error");
  }
};

// API Controllers

// Get all retur with pagination and search
const getAllRetur = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "" } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT r.*, c.nama as customer_nama, u.username as user_nama
      FROM retur r
      LEFT JOIN customers c ON r.customer_id = c.id
      LEFT JOIN users u ON r.user_id = u.id
    `;
    
    let countQuery = `SELECT COUNT(*) as total FROM retur r LEFT JOIN customers c ON r.customer_id = c.id`;
    let params = [];

    if (search) {
      query += ` WHERE c.nama LIKE ? OR r.id LIKE ? OR r.alasan LIKE ?`;
      countQuery += ` WHERE c.nama LIKE ? OR r.id LIKE ? OR r.alasan LIKE ?`;
      const searchParam = `%${search}%`;
      params = [searchParam, searchParam, searchParam];
    }

    query += ` ORDER BY r.tanggal_retur DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await db.execute(query, params);
    const [countRows] = await db.execute(countQuery, params.slice(0, -2));

    // Get retur details for each retur
    for (let retur of rows) {
      const [details] = await db.execute(`
        SELECT rd.*, b.nama as barang_nama, b.SKU 
        FROM retur_detail rd
        JOIN barangs b ON rd.barang_id = b.id
        WHERE rd.retur_id = ?
      `, [retur.id]);
      retur.details = details;
    }

    res.json({
      success: true,
      data: rows,
      pagination: {
        total: countRows[0].total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countRows[0].total / limit)
      }
    });

  } catch (error) {
    console.error("Error getting retur:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil data retur",
      error: error.message
    });
  }
};

// Get retur by ID
const getReturById = async (req, res) => {
  try {
    const { id } = req.params;

    // PERBAIKAN: Tambah validasi input
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: "ID retur tidak valid"
      });
    }

    const [rows] = await db.execute(`
      SELECT r.*, c.nama as customer_nama, c.email as customer_email, 
             c.telepon as customer_telepon, u.username as user_nama,
             t.tanggal_transaksi
      FROM retur r
      LEFT JOIN customers c ON r.customer_id = c.id
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN transactions t ON r.transaction_id = t.id
      WHERE r.id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Retur tidak ditemukan"
      });
    }

    const retur = rows[0];

    // Get retur details
    const [details] = await db.execute(`
      SELECT rd.*, b.nama as barang_nama, b.SKU, b.harga_jual
      FROM retur_detail rd
      JOIN barangs b ON rd.barang_id = b.id
      WHERE rd.retur_id = ?
    `, [id]);

    retur.details = details;

    res.json({
      success: true,
      data: retur
    });

  } catch (error) {
    console.error("Error getting retur by ID:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil data retur",
      error: error.message
    });
  }
};

// Create new retur
const createRetur = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    const {
      transaction_id,
      customer_id,
      alasan,
      items,
      total_pengembalian
    } = req.body;

    // PERBAIKAN: Tambah validasi session user
    if (!req.session.user || !req.session.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    const user_id = req.session.user.id;

    // Validate required fields
    if (!transaction_id || !customer_id || !alasan || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Data tidak lengkap"
      });
    }

    // PERBAIKAN: Tambah validasi numerik
    if (isNaN(transaction_id) || isNaN(customer_id) || isNaN(total_pengembalian)) {
      return res.status(400).json({
        success: false,
        message: "Format data tidak valid"
      });
    }

    // Check if transaction exists
    const [transactionCheck] = await connection.execute(
      "SELECT id FROM transactions WHERE id = ?",
      [transaction_id]
    );

    if (transactionCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Transaksi tidak ditemukan"
      });
    }

    // PERBAIKAN: Validasi items array
    for (const item of items) {
      if (!item.barang_id || !item.jumlah || !item.harga_satuan || !item.subtotal) {
        return res.status(400).json({
          success: false,
          message: "Data item tidak lengkap"
        });
      }
      
      if (isNaN(item.barang_id) || isNaN(item.jumlah) || isNaN(item.harga_satuan) || isNaN(item.subtotal)) {
        return res.status(400).json({
          success: false,
          message: "Format data item tidak valid"
        });
      }
    }

    // Insert retur
    const [returResult] = await connection.execute(`
      INSERT INTO retur (transaction_id, customer_id, user_id, alasan, total_pengembalian, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `, [transaction_id, customer_id, user_id, alasan, total_pengembalian]);

    const returId = returResult.insertId;

    // Insert retur details and update stock
    for (const item of items) {
      // Insert retur detail
      await connection.execute(`
        INSERT INTO retur_detail (retur_id, barang_id, jumlah, harga_satuan, subtotal)
        VALUES (?, ?, ?, ?, ?)
      `, [returId, item.barang_id, item.jumlah, item.harga_satuan, item.subtotal]);

      // Update stock (tambah stok karena barang dikembalikan)
      await connection.execute(`
        UPDATE barangs SET jumlah_stok = jumlah_stok + ? WHERE id = ?
      `, [item.jumlah, item.barang_id]);

      // Insert stock history
      await connection.execute(`
        INSERT INTO stock_history (barang_id, jumlah, tipe, reference_id, reference_type, keterangan, user_id)
        VALUES (?, ?, 'masuk', ?, 'retur', ?, ?)
      `, [item.barang_id, item.jumlah, returId, `Retur barang - ${alasan}`, user_id]);
    }

    await connection.commit();

    // Log activity
    await logActivity(user_id, `Membuat retur baru #${returId}`, req);

    res.status(201).json({
      success: true,
      message: "Retur berhasil dibuat",
      data: { id: returId }
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error creating retur:", error);
    res.status(500).json({
      success: false,
      message: "Gagal membuat retur",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Update retur
const updateRetur = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const {
      alasan,
      items,
      total_pengembalian,
      status
    } = req.body;

    // PERBAIKAN: Tambah validasi session user dan input
    if (!req.session.user || !req.session.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: "ID retur tidak valid"
      });
    }

    const user_id = req.session.user.id;

    // Check if retur exists
    const [returCheck] = await connection.execute(
      "SELECT * FROM retur WHERE id = ?",
      [id]
    );

    if (returCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Retur tidak ditemukan"
      });
    }

    const currentRetur = returCheck[0];

    // Check if retur can be updated (only pending status can be updated)
    if (currentRetur.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: "Retur yang sudah diproses tidak dapat diubah"
      });
    }

    // Get current retur details to revert stock changes
    const [currentDetails] = await connection.execute(
      "SELECT * FROM retur_detail WHERE retur_id = ?",
      [id]
    );

    // Revert previous stock changes
    for (const detail of currentDetails) {
      await connection.execute(`
        UPDATE barangs SET jumlah_stok = jumlah_stok - ? WHERE id = ?
      `, [detail.jumlah, detail.barang_id]);
    }

    // Delete old retur details
    await connection.execute("DELETE FROM retur_detail WHERE retur_id = ?", [id]);

    // Update retur
    await connection.execute(`
      UPDATE retur SET alasan = ?, total_pengembalian = ?, status = ?
      WHERE id = ?
    `, [alasan, total_pengembalian, status || 'pending', id]);

    // Insert new retur details and update stock
    for (const item of items) {
      // Insert retur detail
      await connection.execute(`
        INSERT INTO retur_detail (retur_id, barang_id, jumlah, harga_satuan, subtotal)
        VALUES (?, ?, ?, ?, ?)
      `, [id, item.barang_id, item.jumlah, item.harga_satuan, item.subtotal]);

      // Update stock (tambah stok karena barang dikembalikan)
      await connection.execute(`
        UPDATE barangs SET jumlah_stok = jumlah_stok + ? WHERE id = ?
      `, [item.jumlah, item.barang_id]);

      // Insert stock history
      await connection.execute(`
        INSERT INTO stock_history (barang_id, jumlah, tipe, reference_id, reference_type, keterangan, user_id)
        VALUES (?, ?, 'masuk', ?, 'retur', ?, ?)
      `, [item.barang_id, item.jumlah, id, `Update retur barang - ${alasan}`, user_id]);
    }

    await connection.commit();

    // Log activity
    await logActivity(user_id, `Mengupdate retur #${id}`, req);

    res.json({
      success: true,
      message: "Retur berhasil diupdate"
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error updating retur:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengupdate retur",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Delete retur
const deleteRetur = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    const { id } = req.params;

    // PERBAIKAN: Tambah validasi session user dan input
    if (!req.session.user || !req.session.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: "ID retur tidak valid"
      });
    }

    const user_id = req.session.user.id;

    // Check if retur exists
    const [returCheck] = await connection.execute(
      "SELECT * FROM retur WHERE id = ?",
      [id]
    );

    if (returCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Retur tidak ditemukan"
      });
    }

    const retur = returCheck[0];

    // Check if retur can be deleted (only pending status can be deleted)
    if (retur.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: "Retur yang sudah diproses tidak dapat dihapus"
      });
    }

    // Get retur details to revert stock changes
    const [details] = await connection.execute(
      "SELECT * FROM retur_detail WHERE retur_id = ?",
      [id]
    );

    // Revert stock changes
    for (const detail of details) {
      await connection.execute(`
        UPDATE barangs SET jumlah_stok = jumlah_stok - ? WHERE id = ?
      `, [detail.jumlah, detail.barang_id]);
    }

    // Delete retur (details will be deleted by CASCADE)
    await connection.execute("DELETE FROM retur WHERE id = ?", [id]);

    // Delete related stock history
    await connection.execute(`
      DELETE FROM stock_history 
      WHERE reference_id = ? AND reference_type = 'retur'
    `, [id]);

    await connection.commit();

    // Log activity
    await logActivity(user_id, `Menghapus retur #${id}`, req);

    res.json({
      success: true,
      message: "Retur berhasil dihapus"
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error deleting retur:", error);
    res.status(500).json({
      success: false,
      message: "Gagal menghapus retur",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Search transactions for retur
const searchTransactions = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 1) {
      return res.json({
        success: true,
        data: []
      });
    }

    const [rows] = await db.execute(`
      SELECT t.*, c.nama as customer_nama, c.email, c.telepon, c.alamat
      FROM transactions t
      JOIN customers c ON t.customer_id = c.id
      WHERE (t.id LIKE ? OR c.nama LIKE ?) 
        AND t.status = 'selesai'
      ORDER BY t.tanggal_transaksi DESC
      LIMIT 10
    `, [`%${q}%`, `%${q}%`]);

    res.json({
      success: true,
      data: rows
    });

  } catch (error) {
    console.error("Error searching transactions:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mencari transaksi",
      error: error.message
    });
  }
};

// Get transaction details for retur
const getTransactionDetails = async (req, res) => {
  try {
    const { id } = req.params;

    // PERBAIKAN: Tambah validasi input
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: "ID transaksi tidak valid"
      });
    }

    // Get transaction info
    const [transactionRows] = await db.execute(`
      SELECT t.*, c.nama as customer_nama, c.email, c.telepon, c.alamat
      FROM transactions t
      JOIN customers c ON t.customer_id = c.id
      WHERE t.id = ? AND t.status = 'selesai'
    `, [id]);

    if (transactionRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Transaksi tidak ditemukan atau belum selesai"
      });
    }

    const transaction = transactionRows[0];

    // Get transaction items
    const [itemRows] = await db.execute(`
      SELECT td.*, b.nama as barang_nama, b.SKU, b.harga_jual
      FROM transaction_details td
      JOIN barangs b ON td.barang_id = b.id
      WHERE td.transaction_id = ?
    `, [id]);

    transaction.items = itemRows;

    res.json({
      success: true,
      data: transaction
    });

  } catch (error) {
    console.error("Error getting transaction details:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil detail transaksi",
      error: error.message
    });
  }
};

// Update retur status
const updateReturStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // PERBAIKAN: Tambah validasi session user dan input
    if (!req.session.user || !req.session.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: "ID retur tidak valid"
      });
    }

    const user_id = req.session.user.id;

    // Validate status
    const validStatuses = ['pending', 'selesai', 'batal'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status tidak valid"
      });
    }

    // Check if retur exists
    const [returCheck] = await db.execute(
      "SELECT * FROM retur WHERE id = ?",
      [id]
    );

    if (returCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Retur tidak ditemukan"
      });
    }

    // Update status
    await db.execute(
      "UPDATE retur SET status = ? WHERE id = ?",
      [status, id]
    );

    // Log activity
    await logActivity(user_id, `Mengubah status retur #${id} menjadi ${status}`, req);

    res.json({
      success: true,
      message: "Status retur berhasil diubah"
    });

  } catch (error) {
    console.error("Error updating retur status:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengubah status retur",
      error: error.message
    });
  }
};

// Export retur to Excel
const exportReturToExcel = async (req, res) => {
  try {
    const { start_date, end_date, status } = req.query;

    // PERBAIKAN: Tambah validasi session user
    if (!req.session.user || !req.session.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    const user_id = req.session.user.id;

    let query = `
      SELECT r.*, c.nama as customer_nama, u.username as user_nama
      FROM retur r
      LEFT JOIN customers c ON r.customer_id = c.id
      LEFT JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;
    let params = [];

    if (start_date && end_date) {
      query += ` AND DATE(r.tanggal_retur) BETWEEN ? AND ?`;
      params.push(start_date, end_date);
    }

    if (status) {
      query += ` AND r.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY r.tanggal_retur DESC`;

    const [rows] = await db.execute(query, params);

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data Retur');

    // Add headers
    worksheet.columns = [
      { header: 'ID Retur', key: 'id', width: 10 },
      { header: 'Customer', key: 'customer_nama', width: 20 },
      { header: 'Tanggal Retur', key: 'tanggal_retur', width: 15 },
      { header: 'Alasan', key: 'alasan', width: 30 },
      { header: 'Total Pengembalian', key: 'total_pengembalian', width: 20 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'User', key: 'user_nama', width: 15 }
    ];

    // Add data
    rows.forEach(row => {
      worksheet.addRow({
        id: row.id,
        customer_nama: row.customer_nama,
        tanggal_retur: new Date(row.tanggal_retur).toLocaleDateString('id-ID'),
        alasan: row.alasan,
        total_pengembalian: formatCurrency(row.total_pengembalian),
        status: row.status,
        user_nama: row.user_nama
      });
    });

    // Style headers
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6E6FA' }
    };

    // Set response headers
    const filename = `retur_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write to response
    await workbook.xlsx.write(res);

    // Log activity
    await logActivity(user_id, 'Export data retur ke Excel', req);

    res.end();

  } catch (error) {
    console.error("Error exporting retur to Excel:", error);
    res.status(500).json({
      success: false,
      message: "Gagal export data retur",
      error: error.message
    });
  }
};

module.exports = {
  getReturIndexPage,
  downloadRetur, // PERBAIKAN: Tambah missing export
  getReturBaruPage,
  getAllRetur,
  getReturById,
  createRetur,
  updateRetur,
  deleteRetur,
  searchTransactions,
  getTransactionDetails,
  updateReturStatus,
  exportReturToExcel
};