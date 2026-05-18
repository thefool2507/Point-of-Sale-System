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

const getAllTransaksi = async (req, res) => {
  try {
    // Join transactions with customers and users to get the names
    const [transaksis] = await db.query(`
      SELECT 
        t.id, 
        t.customer_id, 
        c.nama AS customer_name, 
        t.user_id, 
        u.username AS user_name,
        t.tanggal_transaksi, 
        t.total_harga, 
        t.status,
        t.payment_method
      FROM 
        transactions t
      LEFT JOIN 
        customers c ON t.customer_id = c.id
      LEFT JOIN 
        users u ON t.user_id = u.id
      ORDER BY t.tanggal_transaksi DESC
    `);
    
    // Fetch related customers and users for the dropdowns
    const [customers] = await db.query("SELECT id, nama FROM customers");
    const [users] = await db.query("SELECT id, username FROM users");
    
    // Add barangs for compatibility with the template
    const [barangs] = await db.query("SELECT * FROM barangs");

    const [todayStats] = await db.query(`
  SELECT COUNT(*) as today_count
  FROM transactions 
  WHERE DATE(tanggal_transaksi) = CURDATE()
`);
    
    res.render("pages/transaksi/index", { 
      transaksis,
      customers,
      users,
      barangs,
      todayCount: todayStats[0]?.today_count || 0
    });
  } catch (error) {
    console.error("Error fetching all transaksi:", error);
    req.flash("error", "Gagal mengambil data transaksi");
    res.redirect("/dashboard");
  }
};

// Combined POS page function that gets both the page and the data
// Ganti bagian ini di function getPosPage:

const getPosPage = async (req, res) => {
  try {
    // Get all products/barangs for the POS system
    const [barangs] = await db.query("SELECT * FROM barangs WHERE jumlah_stok > 0");
    
    // Get customers for dropdown
    const [customers] = await db.query("SELECT id, nama, email FROM customers");
    
    // PERBAIKAN: Get today's statistics dengan timezone Indonesia (WIB)
    // Buat tanggal hari ini dalam timezone Indonesia
    const today = new Date();
    const indonesiaOffset = 7 * 60; // WIB = UTC+7 (dalam menit)
    const indonesiaTime = new Date(today.getTime() + (indonesiaOffset * 60 * 1000));
    const todayIndonesia = indonesiaTime.toISOString().split('T')[0];
    
    console.log('UTC Date:', today.toISOString().split('T')[0]);
    console.log('Indonesia Date (WIB):', todayIndonesia);
    
    const [todayStats] = await db.query(`
      SELECT 
        COALESCE(SUM(total_harga), 0) as today_sales,
        COUNT(*) as today_transactions
      FROM transactions 
      WHERE DATE(tanggal_transaksi) = ? AND status IN ('selesai', 'completed')
    `, [todayIndonesia]);
    
    const [customerCount] = await db.query("SELECT COUNT(*) as total_customers FROM customers");
    const [stockCount] = await db.query("SELECT SUM(jumlah_stok) as total_stock FROM barangs");
    
    res.render("pages/transaksi/pos", { 
      barangs,
      customers,
      stats: {
        today_sales: todayStats[0]?.today_sales || 0,
        today_transactions: todayStats[0]?.today_transactions || 0,
        total_customers: customerCount[0]?.total_customers || 0,
        total_stock: stockCount[0]?.total_stock || 0
      }
    });
  } catch (error) {
    console.error("Error fetching POS data:", error);
    req.flash("error", "Gagal mengambil data POS");
    res.redirect("/dashboard");
  }
};

const getTransactionDetail = async (req, res) => {
  try {
    const transactionId = req.params.id;
    
    const [transaction] = await db.query(`
      SELECT t.*, c.nama AS customer_name, u.username AS user_name
      FROM transactions t
      LEFT JOIN customers c ON t.customer_id = c.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.id = ?
    `, [transactionId]);

    const [items] = await db.query(`
      SELECT td.*, b.nama AS product_name
      FROM transaction_details td
      JOIN barangs b ON td.barang_id = b.id
      WHERE td.transaction_id = ?
    `, [transactionId]);

    if (!transaction.length) {
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    }

    res.json({
      success: true,
      transaction: {
        ...transaction[0],
        items
      }
    });
  } catch (error) {
    console.error("Error fetching transaction detail:", error);
    res.status(500).json({ success: false, message: 'Gagal mengambil detail transaksi' });
  }
};

// Process transaction from POS
const processTransaction = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { 
      customer_id, 
      payment_method, 
      items, // Array of {product_id, quantity, price}
      subtotal,
      tax,
      total 
    } = req.body;
    
    // Validate inputs
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }
    
    if (!total || total <= 0) {
      return res.status(400).json({ success: false, message: "Invalid total amount" });
    }
    
    if (!payment_method) {
      return res.status(400).json({ success: false, message: "Payment method is required" });
    }
    
    // Validate user session
    if (!req.session.user?.id) {
      return res.status(401).json({ success: false, message: "User session not found" });
    }
    
    // Insert transaction
    const [transactionResult] = await connection.query(`
      INSERT INTO transactions (customer_id, user_id, tanggal_transaksi, total_harga, status, payment_method)
      VALUES (?, ?, NOW(), ?, 'selesai', ?)
    `, [customer_id || null, req.session.user.id, total, payment_method]);
    
    const transactionId = transactionResult.insertId;
    
    // Process each item
    for (const item of items) {
      // Validate item data
      if (!item.product_id || !item.quantity || item.quantity <= 0 || !item.price || item.price <= 0) {
        throw new Error(`Invalid item data: ${JSON.stringify(item)}`);
      }
      
      // Check current stock before processing
      const [currentStock] = await connection.query(
        "SELECT jumlah_stok, nama FROM barangs WHERE id = ?", 
        [item.product_id]
      );
      
      if (!currentStock.length) {
        throw new Error(`Product not found: ${item.product_id}`);
      }
      
      if (currentStock[0].jumlah_stok < item.quantity) {
        throw new Error(`Insufficient stock for ${currentStock[0].nama}. Available: ${currentStock[0].jumlah_stok}, Required: ${item.quantity}`);
      }
      
      // Insert transaction detail
      await connection.query(`
        INSERT INTO transaction_details (transaction_id, barang_id, jumlah, harga_satuan, subtotal)
        VALUES (?, ?, ?, ?, ?)
      `, [transactionId, item.product_id, item.quantity, item.price, item.price * item.quantity]);
      
      // Update stock
      const [updateResult] = await connection.query(`
        UPDATE barangs 
        SET jumlah_stok = jumlah_stok - ? 
        WHERE id = ? AND jumlah_stok >= ?
      `, [item.quantity, item.product_id, item.quantity]);
      
      // Verify stock update was successful
      if (updateResult.affectedRows === 0) {
        throw new Error(`Failed to update stock for product ID: ${item.product_id}`);
      }
      
      // Add stock history record
      await connection.query(`
        INSERT INTO stock_history (barang_id, jumlah, tipe, reference_id, reference_type, keterangan, user_id)
        VALUES (?, ?, 'keluar', ?, 'penjualan', 'Penjualan melalui POS', ?)
      `, [item.product_id, item.quantity, transactionId, req.session.user.id]);
    }
    
    await connection.commit();
    
    // Log the transaction
    log(LOG_LEVELS.INFO, "Transaction processed", {
      transaction_id: transactionId,
      user_id: req.session.user.id,
      total: total,
      items_count: items.length,
      ip: getClientIP(req),
      userAgent: getUserAgentData(req)
    });
    
    res.json({ 
      success: true, 
      message: "Transaction processed successfully",
      transaction_id: transactionId
    });
    
  } catch (error) {
    await connection.rollback();
    console.error("Error processing transaction:", error);
    
    // Log error
    log(LOG_LEVELS.ERROR, "Transaction failed", {
      error: error.message,
      user_id: req.session.user?.id,
      ip: getClientIP(req)
    });
    
    res.status(500).json({ 
      success: false, 
      message: error.message || "Failed to process transaction" 
    });
  } finally {
    connection.release();
  }
};

const getLaporanPenjualanPage = async (req, res) => {
  try {
    // Get initial data for the page load
    const salesData = await getSalesAnalytics(req.query);
    res.render("pages/transaksi/laporan_penjualan", { 
      initialData: salesData 
    });
  } catch (error) {
    console.error("Error loading sales report page:", error);
    req.flash("error", "Gagal memuat halaman laporan penjualan");
    res.redirect("/dashboard");
  }
};

// API endpoint for getting sales analytics data
const getSalesAnalyticsAPI = async (req, res) => {
  try {
    const salesData = await getSalesAnalytics(req.query);
    res.json({
      success: true,
      data: salesData
    });
  } catch (error) {
    console.error("Error getting sales analytics API:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get sales analytics data"
    });
  }
};

// New function to get sales analytics data
const getSalesAnalytics = async (filters = {}) => {
  try {
    const {
      tanggal_mulai = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      tanggal_selesai = new Date().toISOString().split('T')[0],
      status_filter = '',
      payment_filter = ''
    } = filters;

    // Validate date range
    if (new Date(tanggal_mulai) > new Date(tanggal_selesai)) {
      throw new Error("Start date cannot be later than end date");
    }

    // Helper function to build WHERE conditions
    const buildWhereConditions = (includeStatus = true) => {
      let whereConditions = [`DATE(t.tanggal_transaksi) BETWEEN ? AND ?`];
      let queryParams = [tanggal_mulai, tanggal_selesai];

      if (status_filter) {
        whereConditions.push('t.status = ?');
        queryParams.push(status_filter);
      } else if (includeStatus) {
        // Default to completed transactions only
        whereConditions.push("t.status IN ('completed', 'selesai')");
      }

      if (payment_filter) {
        whereConditions.push('t.payment_method = ?');
        queryParams.push(payment_filter);
      }

      return {
        whereClause: whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '',
        queryParams
      };
    };

    // Get summary statistics
    const summaryWhere = buildWhereConditions(false);
    const [summaryStats] = await db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN t.status IN ('completed', 'selesai') THEN t.total_harga ELSE 0 END), 0) as total_penjualan,
        COUNT(CASE WHEN t.status IN ('completed', 'selesai') THEN 1 END) as total_transaksi,
        COUNT(DISTINCT CASE WHEN t.status IN ('completed', 'selesai') THEN t.customer_id END) as pelanggan_aktif,
        COALESCE(AVG(CASE WHEN t.status IN ('completed', 'selesai') THEN t.total_harga END), 0) as rata_rata_transaksi,
        COALESCE(SUM(CASE WHEN t.status IN ('completed', 'selesai') THEN td.jumlah ELSE 0 END), 0) as produk_terjual
      FROM transactions t
      LEFT JOIN transaction_details td ON t.id = td.transaction_id
      ${summaryWhere.whereClause}
    `, summaryWhere.queryParams);

    // Get daily sales trend (last 7 days from end date)
    const dailyWhere = buildWhereConditions(false);
    const startDate = new Date(tanggal_selesai);
    startDate.setDate(startDate.getDate() - 6);
    const dailyStartDate = startDate.toISOString().split('T')[0];

    const [dailySales] = await db.query(`
      SELECT 
        DATE(t.tanggal_transaksi) as tanggal,
        COALESCE(SUM(CASE WHEN t.status IN ('completed', 'selesai') THEN t.total_harga ELSE 0 END), 0) as total_harian,
        COUNT(CASE WHEN t.status IN ('completed', 'selesai') THEN 1 END) as transaksi_harian
      FROM transactions t
      WHERE DATE(t.tanggal_transaksi) BETWEEN ? AND ?
        ${status_filter ? 'AND t.status = ?' : ''}
        ${payment_filter ? 'AND t.payment_method = ?' : ''}
      GROUP BY DATE(t.tanggal_transaksi)
      ORDER BY DATE(t.tanggal_transaksi)
    `, [
      dailyStartDate, 
      tanggal_selesai,
      ...(status_filter ? [status_filter] : []),
      ...(payment_filter ? [payment_filter] : [])
    ]);

    // Get top selling products
    const productWhere = buildWhereConditions(true);
    const [topProducts] = await db.query(`
      SELECT 
        b.nama as product_name,
        b.SKU as product_sku,
        SUM(td.jumlah) as total_qty,
        SUM(td.subtotal) as total_sales,
        AVG(td.harga_satuan) as avg_price
      FROM transaction_details td
      JOIN transactions t ON td.transaction_id = t.id
      JOIN barangs b ON td.barang_id = b.id
      ${productWhere.whereClause}
      GROUP BY td.barang_id, b.nama, b.SKU
      ORDER BY total_sales DESC
      LIMIT 10
    `, productWhere.queryParams);

    // Get payment method distribution
    const paymentWhere = buildWhereConditions(true);
    const [paymentMethods] = await db.query(`
      SELECT 
        t.payment_method,
        COUNT(*) as jumlah_transaksi,
        SUM(t.total_harga) as total_nilai,
        ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER()), 2) as percentage
      FROM transactions t
      ${paymentWhere.whereClause}
      GROUP BY t.payment_method
      ORDER BY total_nilai DESC
    `, paymentWhere.queryParams);

    // Get detailed transactions with pagination support
    const page = parseInt(filters.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    
    const detailWhere = buildWhereConditions(false);
    const [detailedTransactions] = await db.query(`
      SELECT 
        t.id,
        t.tanggal_transaksi,
        COALESCE(c.nama, 'Guest') as customer_name,
        t.total_harga,
        t.payment_method,
        t.status,
        u.username as kasir_name,
        COUNT(td.id) as items_count
      FROM transactions t
      LEFT JOIN customers c ON t.customer_id = c.id
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN transaction_details td ON t.id = td.transaction_id
      ${detailWhere.whereClause}
      GROUP BY t.id, t.tanggal_transaksi, c.nama, t.total_harga, t.payment_method, t.status, u.username
      ORDER BY t.tanggal_transaksi DESC
      LIMIT ? OFFSET ?
    `, [...detailWhere.queryParams, limit, offset]);

    // Calculate percentage changes (comparing with previous period)
    const periodDays = Math.ceil((new Date(tanggal_selesai) - new Date(tanggal_mulai)) / (1000 * 60 * 60 * 24)) + 1;
    const previousStartDate = new Date(new Date(tanggal_mulai).getTime() - periodDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const previousEndDate = new Date(new Date(tanggal_mulai).getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [previousStats] = await db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN t.status IN ('completed', 'selesai') THEN t.total_harga ELSE 0 END), 0) as prev_total_penjualan,
        COUNT(CASE WHEN t.status IN ('completed', 'selesai') THEN 1 END) as prev_total_transaksi,
        COUNT(DISTINCT CASE WHEN t.status IN ('completed', 'selesai') THEN t.customer_id END) as prev_pelanggan_aktif,
        COALESCE(SUM(CASE WHEN t.status IN ('completed', 'selesai') THEN td.jumlah ELSE 0 END), 0) as prev_produk_terjual
      FROM transactions t
      LEFT JOIN transaction_details td ON t.id = td.transaction_id
      WHERE DATE(t.tanggal_transaksi) BETWEEN ? AND ?
        ${status_filter ? 'AND t.status = ?' : ''}
        ${payment_filter ? 'AND t.payment_method = ?' : ''}
    `, [
      previousStartDate, 
      previousEndDate,
      ...(status_filter ? [status_filter] : []),
      ...(payment_filter ? [payment_filter] : [])
    ]);

    // Fixed percentage calculation
    const calculatePercentageChange = (current, previous) => {
      if (previous === 0) {
        return current > 0 ? 100 : 0;
      }
      return Math.round((current - previous) / previous * 100 * 10) / 10;
    };

    const stats = summaryStats[0];
    const prevStats = previousStats[0];

    return {
      summary: {
        total_penjualan: parseFloat(stats.total_penjualan),
        total_transaksi: parseInt(stats.total_transaksi),
        pelanggan_aktif: parseInt(stats.pelanggan_aktif),
        produk_terjual: parseInt(stats.produk_terjual),
        rata_rata_transaksi: parseFloat(stats.rata_rata_transaksi),
        changes: {
          penjualan_change: calculatePercentageChange(stats.total_penjualan, prevStats.prev_total_penjualan),
          transaksi_change: calculatePercentageChange(stats.total_transaksi, prevStats.prev_total_transaksi),
          pelanggan_change: calculatePercentageChange(stats.pelanggan_aktif, prevStats.prev_pelanggan_aktif),
          produk_change: calculatePercentageChange(stats.produk_terjual, prevStats.prev_produk_terjual)
        }
      },
      daily_sales: dailySales,
      top_products: topProducts,
      payment_methods: paymentMethods,
      detailed_transactions: detailedTransactions,
      filters: {
        tanggal_mulai,
        tanggal_selesai,
        status_filter,
        payment_filter,
        page
      }
    };

  } catch (error) {
    console.error("Error getting sales analytics:", error);
    throw error;
  }
};

// Export function with better error handling and formatting
const exportSalesReport = async (req, res) => {
  try {
    const analyticsData = await getSalesAnalytics(req.query);
    
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'POS System';
    workbook.created = new Date();
    
    const worksheet = workbook.addWorksheet('Laporan Penjualan');

    // Set worksheet properties
    worksheet.properties.defaultRowHeight = 20;

    // Add title
    worksheet.mergeCells('A1:H1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'LAPORAN PENJUALAN';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FF000000' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6F3FF' }
    };

    // Add date range
    worksheet.mergeCells('A2:H2');
    const dateCell = worksheet.getCell('A2');
    dateCell.value = `Periode: ${analyticsData.filters.tanggal_mulai} s/d ${analyticsData.filters.tanggal_selesai}`;
    dateCell.alignment = { horizontal: 'center', vertical: 'middle' };
    dateCell.font = { bold: true };

    // Add generated info
    worksheet.mergeCells('A3:H3');
    const infoCell = worksheet.getCell('A3');
    infoCell.value = `Dibuat pada: ${new Date().toLocaleString('id-ID')}`;
    infoCell.alignment = { horizontal: 'center' };
    infoCell.font = { italic: true, size: 10 };

    // Add empty row
    worksheet.addRow([]);

    // Add summary section
    const summaryTitleRow = worksheet.addRow(['RINGKASAN']);
    summaryTitleRow.getCell(1).font = { bold: true, size: 12 };
    summaryTitleRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCCCC' }
    };

    worksheet.addRow(['Total Penjualan', '', `Rp ${analyticsData.summary.total_penjualan.toLocaleString('id-ID')}`]);
    worksheet.addRow(['Total Transaksi', '', analyticsData.summary.total_transaksi]);
    worksheet.addRow(['Pelanggan Aktif', '', analyticsData.summary.pelanggan_aktif]);
    worksheet.addRow(['Produk Terjual', '', analyticsData.summary.produk_terjual]);
    worksheet.addRow(['Rata-rata per Transaksi', '', `Rp ${analyticsData.summary.rata_rata_transaksi.toLocaleString('id-ID')}`]);

    // Add empty rows
    worksheet.addRow([]);
    worksheet.addRow([]);

    // Add transaction details header
    const detailTitleRow = worksheet.addRow(['DETAIL TRANSAKSI']);
    detailTitleRow.getCell(1).font = { bold: true, size: 12 };
    detailTitleRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCCCC' }
    };

    // Add headers
    const headerRow = worksheet.addRow([
      'ID Transaksi',
      'Tanggal',
      'Waktu',
      'Pelanggan',
      'Total',
      'Metode Bayar',
      'Status',
      'Kasir'
    ]);
    
    // Style headers
    headerRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Set column widths
    worksheet.columns = [
      { width: 15 }, // ID
      { width: 12 }, // Date
      { width: 10 }, // Time
      { width: 25 }, // Customer
      { width: 15 }, // Total
      { width: 15 }, // Payment
      { width: 12 }, // Status
      { width: 20 }  // Cashier
    ];

    // Add data with formatting
    analyticsData.detailed_transactions.forEach((transaction, index) => {
      const transactionDate = new Date(transaction.tanggal_transaksi);
      const row = worksheet.addRow([
        `#TRX-${String(transaction.id).padStart(3, '0')}`,
        transactionDate.toLocaleDateString('id-ID'),
        transactionDate.toLocaleTimeString('id-ID'),
        transaction.customer_name,
        parseFloat(transaction.total_harga),
        transaction.payment_method,
        transaction.status,
        transaction.kasir_name
      ]);

      // Format currency column
      row.getCell(5).numFmt = '#,##0';
      
      // Alternate row colors
      if (index % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8F9FA' }
          };
        });
      }

      // Add borders
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // Set response headers
    const filename = `laporan-penjualan-${analyticsData.filters.tanggal_mulai}-${analyticsData.filters.tanggal_selesai}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();

    // Log export activity
    log(LOG_LEVELS.INFO, "Sales report exported", {
      user_id: req.session.user?.id,
      date_range: `${analyticsData.filters.tanggal_mulai} to ${analyticsData.filters.tanggal_selesai}`,
      records_count: analyticsData.detailed_transactions.length,
      ip: getClientIP(req)
    });

  } catch (error) {
    console.error("Error exporting sales report:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengexport laporan penjualan"
    });
  }
};

module.exports = {
  getAllTransaksi,
  getPosPage,
  processTransaction,
  getLaporanPenjualanPage,
  getSalesAnalyticsAPI,
  exportSalesReport,
  getTransactionDetail
};