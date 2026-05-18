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

// GET - Halaman index pembelian (untuk /pembelian/index)
const getPembelianIndexPage = async (req, res) => {
  try {
      const [pembelianList] = await db.query(
        `SELECT p.id, s.nama AS supplier_nama, u.username AS user_username, 
                p.tanggal_pembelian, p.total_harga, p.status, p.created_at, p.updated_at
         FROM pembelian p
         JOIN suppliers s ON p.supplier_id = s.id
         JOIN users u ON p.user_id = u.id
         ORDER BY p.created_at DESC`
      );
  
      res.render("pages/pembelian/index", {
        pembelianList,
        success: req.flash("success"),
        error: req.flash("error")
      });
    } catch (error) {
      console.error("Error fetching pembelian data:", error);
      req.flash("error", "Gagal mengambil data pembelian");
      res.redirect("/");
    }
  };
  
  const downloadPembelian = async (req, res) => {
    try {
      const [data] = await db.query(
        `SELECT p.id, s.nama AS supplier_nama, u.username AS user_username, 
                p.tanggal_pembelian, p.total_harga, p.status, p.created_at, p.updated_at
         FROM pembelian p
         JOIN suppliers s ON p.supplier_id = s.id
         JOIN users u ON p.user_id = u.id
         ORDER BY p.created_at DESC`
      );
  
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Data Pembelian");
  
      worksheet.columns = [
        { header: "ID", key: "id", width: 10 },
        { header: "Supplier", key: "supplier_nama", width: 25 },
        { header: "User", key: "user_username", width: 20 },
        { header: "Tanggal Pembelian", key: "tanggal_pembelian", width: 20 },
        { header: "Total Harga", key: "total_harga", width: 15 },
        { header: "Status", key: "status", width: 15 },
        { header: "Created At", key: "created_at", width: 20 },
        { header: "Updated At", key: "updated_at", width: 20 }
      ];
  
      worksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "000000" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "D9D9D9" },
        };
      });
  
      data.forEach((item) => {
        worksheet.addRow(item);
      });
  
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", "attachment; filename=data-pembelian.xlsx");
  
      await workbook.xlsx.write(res);
  
      const ip = getClientIP(req);
      const userAgentData = getUserAgentData(req);
  
      await log(
        `${req.session.user.username} DOWNLOADED PEMBELIAN data`,
        LOG_LEVELS.INFO,
        req.session.user.id,
        userAgentData,
        ip
      );
  
      res.end();
    } catch (error) {
      console.error("Error Generating Excel File:", error);
      res.status(500).send("Gagal Mendownload Data Pembelian");
    }
  };

// GET - Halaman pembelian baru (untuk /pembelian/baru)
const getPembelianBaruPage = async (req, res) => {
  try {
    // Get suppliers
    const [suppliers] = await db.execute(
      "SELECT id, nama, email, telepon, alamat FROM suppliers ORDER BY nama ASC"
    );

    // Get barangs
    const [barangs] = await db.execute(
      "SELECT id, nama, SKU, harga_beli, jumlah_stok FROM barangs ORDER BY nama ASC"
    );

    // Get recent purchases (5 terbaru)
    const [recentPurchases] = await db.execute(`
      SELECT 
        p.id, 
        p.tanggal_pembelian, 
        p.total_harga, 
        p.status,
        s.nama as supplier_nama,
        u.username
      FROM pembelian p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.tanggal_pembelian DESC 
      LIMIT 5
    `);

    res.render("pages/pembelian/baru", {
      title: "Pembelian Baru",
      suppliers,
      barangs,
      recentPurchases
    });
  } catch (error) {
    console.error("Error loading pembelian baru page:", error);
    res.status(500).render("error", { 
      title: "Error",
      message: "Gagal memuat halaman pembelian baru" 
    });
  }
};

// Fix untuk createPembelian function
const createPembelian = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { supplier_id, items } = req.body;
    
    // DEBUG: Log incoming request
    console.log('=== DEBUG PEMBELIAN ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Session user:', req.session.user);
    console.log('Full session:', req.session);
    
    // FIX: Gunakan req.session.user.id (bukan req.user.id)
    const user_id = req.session.user?.id || req.session.userId;
    
    console.log('Extracted user_id:', user_id);
    
    // Validasi input
    if (!supplier_id) {
        console.log('ERROR: supplier_id missing');
        return res.status(400).json({
            success: false,
            message: "Supplier ID tidak boleh kosong"
        });
    }
    
    if (!user_id) {
        console.log('ERROR: user_id missing');
        console.log('Available session data:', Object.keys(req.session));
        return res.status(400).json({
            success: false,
            message: "User tidak terautentikasi. Silakan login kembali."
        });
    }
    
    if (!items || items.length === 0) {
        console.log('ERROR: items missing or empty');
        return res.status(400).json({
            success: false,
            message: "Items tidak boleh kosong"
        });
    }

    // Validasi setiap item
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.barang_id || !item.jumlah || !item.harga_satuan) {
            console.log(`ERROR: Item ${i} tidak lengkap:`, item);
            return res.status(400).json({
                success: false,
                message: `Item ke-${i+1} tidak lengkap`
            });
        }
    }

    // Hitung total harga
    let totalHarga = 0;
    for (const item of items) {
      totalHarga += item.jumlah * item.harga_satuan;
    }
    
    console.log('Total harga calculated:', totalHarga);

    // Insert pembelian
    const [pembelianResult] = await connection.execute(
      `INSERT INTO pembelian (supplier_id, user_id, tanggal_pembelian, total_harga, status) 
       VALUES (?, ?, NOW(), ?, 'pending')`,
      [supplier_id, user_id, totalHarga]
    );

    const pembelianId = pembelianResult.insertId;
    console.log('Pembelian ID created:', pembelianId);

    // PERBAIKAN: Ganti nama tabel dari detail_pembelian menjadi pembelian_detail
    for (const item of items) {
      await connection.execute(
        `INSERT INTO pembelian_detail (pembelian_id, barang_id, jumlah, harga_satuan, subtotal) 
         VALUES (?, ?, ?, ?, ?)`,
        [pembelianId, item.barang_id, item.jumlah, item.harga_satuan, item.jumlah * item.harga_satuan]
      );
    }

    await connection.commit();
    
    console.log('Transaction committed successfully');
    
    // Log activity - gunakan req.session.user.id
    await logActivity(user_id, `Membuat pembelian baru #${pembelianId}`, req);

    res.json({
      success: true,
      message: "Pembelian berhasil disimpan",
      data: { id: pembelianId }
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error creating pembelian:", error);
    res.status(500).json({
      success: false,
      message: "Gagal menyimpan pembelian: " + error.message
    });
  } finally {
    connection.release();
  }
};

// Fix untuk updatePembelianStatus function
const updatePembelianStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // FIX: Gunakan req.session.user.id (bukan req.user.id)
    const userId = req.session.user?.id || req.session.userId;
    
    // Validasi status
    if (!['pending', 'selesai', 'batal'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status tidak valid"
      });
    }

    // Update status
    await db.execute(
      "UPDATE pembelian SET status = ? WHERE id = ?",
      [status, id]
    );

    // Jika status selesai, update stok barang
    if (status === 'selesai') {
      // PERBAIKAN: Ganti nama tabel dari detail_pembelian menjadi pembelian_detail
      const [detailPembelian] = await db.execute(
        "SELECT barang_id, jumlah FROM pembelian_detail WHERE pembelian_id = ?",
        [id]
      );

      for (const detail of detailPembelian) {
        await db.execute(
          "UPDATE barangs SET jumlah_stok = jumlah_stok + ? WHERE id = ?",
          [detail.jumlah, detail.barang_id]
        );

        // OPTIONAL: Tambahkan record ke stock_history untuk tracking
        await db.execute(
          `INSERT INTO stock_history (barang_id, jumlah, tipe, reference_id, reference_type, keterangan, user_id) 
           VALUES (?, ?, 'masuk', ?, 'pembelian', 'Pembelian barang masuk', ?)`,
          [detail.barang_id, detail.jumlah, id, userId]
        );
      }
    }

    // Log activity
    if (userId) {
      await logActivity(userId, `Mengubah status pembelian #${id} menjadi ${status}`, req);
    }

    res.json({
      success: true,
      message: `Status berhasil diubah menjadi ${status}`
    });

  } catch (error) {
    console.error("Error updating pembelian status:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengubah status"
    });
  }
};

// GET - Get pembelian list (API endpoint untuk DataTables)
const getPembelianList = async (req, res) => {
  try {
    const { start = 0, length = 10, search = '', supplier_id = '', user_id = '', status = '' } = req.query;
    
    let whereClause = "WHERE 1=1";
    let params = [];

    // Add search filter
    if (search) {
      whereClause += " AND (s.nama LIKE ? OR u.username LIKE ? OR p.id LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Add supplier filter
    if (supplier_id) {
      whereClause += " AND p.supplier_id = ?";
      params.push(supplier_id);
    }

    // Add user filter
    if (user_id) {
      whereClause += " AND p.user_id = ?";
      params.push(user_id);
    }

    // Add status filter
    if (status) {
      whereClause += " AND p.status = ?";
      params.push(status);
    }

    // Get total records
    const [totalResult] = await db.execute(`
      SELECT COUNT(*) as total 
      FROM pembelian p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u ON p.user_id = u.id
      ${whereClause}
    `, params);

    const totalRecords = totalResult[0].total;

    // Get filtered data
    const [data] = await db.execute(`
      SELECT 
        p.id, 
        p.tanggal_pembelian, 
        p.total_harga, 
        p.status,
        s.nama as supplier_nama,
        u.username
      FROM pembelian p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u ON p.user_id = u.id
      ${whereClause}
      ORDER BY p.tanggal_pembelian DESC
      LIMIT ${parseInt(length)} OFFSET ${parseInt(start)}
    `, params);

    res.json({
      draw: parseInt(req.query.draw) || 1,
      recordsTotal: totalRecords,
      recordsFiltered: totalRecords,
      data: data
    });

  } catch (error) {
    console.error("Error getting pembelian list:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil data pembelian"
    });
  }
};

module.exports = {
  getPembelianIndexPage,
  getPembelianBaruPage,
  createPembelian,
  updatePembelianStatus,
  getPembelianList
};