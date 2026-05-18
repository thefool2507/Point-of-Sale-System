const mysql = require("mysql2/promise");
const ExcelJS = require("exceljs");
const UAParser = require("ua-parser-js");
const { getClientIP } = require("../../helpers/getClientIP");
const { log, LOG_LEVELS } = require("../../helpers/log");

// Database connection pool untuk performa lebih baik
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'omniflow_db',
  port: process.env.DB_PORT || 3306,
  
  // Konfigurasi pool yang benar untuk MySQL2
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  
  // Tambahan opsi yang valid
  charset: 'utf8mb4',
  timezone: '+07:00', // Untuk timezone Jakarta
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: false,
  debug: false,
  multipleStatements: false
});

// Cache untuk dashboard data (5 menit)
let dashboardCache = {
  data: null,
  timestamp: null,
  ttl: 5 * 60 * 1000 // 5 minutes
};

const getUserAgentData = (req) => {
  const parser = new UAParser(req.headers["user-agent"]);
  const result = parser.getResult();
  return {
    deviceType: result.device.type || (result.device.vendor ? "Mobile" : "Desktop"),
    browser: `${result.browser.name || 'Unknown'} ${result.browser.version || ''}`.trim(),
    platform: `${result.os.name || 'Unknown'} ${result.os.version || ''}`.trim(),
  };
};

const getAdminPage = async (req, res) => {
  try {
    const userAgentData = getUserAgentData(req);
    const clientIP = getClientIP(req);
    
    // Check cache first
    const now = Date.now();
    if (dashboardCache.data && dashboardCache.timestamp && 
        (now - dashboardCache.timestamp) < dashboardCache.ttl) {
      
      // Log dashboard access
      if (req.user?.id) {
        logActivity(req.user.id, 'Dashboard Access (Cached)', clientIP, userAgentData);
      }
      
      return res.render("pages/index/index", { 
        dashboardData: dashboardCache.data,
        user: req.user || null,
        title: 'Dashboard - OmniFlow POS',
        lastUpdated: new Date(dashboardCache.timestamp).toLocaleTimeString('id-ID'),
        // Tambahkan currentDateTime untuk template
        currentDateTime: new Date().toLocaleString('id-ID', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      });
    }
    
    // Fetch fresh data
    const dashboardData = await getDashboardStatistics();
    
    // Update cache
    dashboardCache.data = dashboardData;
    dashboardCache.timestamp = now;
    
    // Log dashboard access
    if (req.user?.id) {
      logActivity(req.user.id, 'Dashboard Access', clientIP, userAgentData);
    }
    
    res.render("pages/index/index", { 
      dashboardData,
      user: req.user || null,
      title: 'Dashboard - OmniFlow POS',
      lastUpdated: new Date().toLocaleTimeString('id-ID'),
      // Tambahkan currentDateTime untuk template
      currentDateTime: new Date().toLocaleString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    
    // Log error
    if (req.user?.id) {
      logActivity(req.user.id, 'Dashboard Error', getClientIP(req), getUserAgentData(req));
    }
    
    res.render("pages/index/index", { 
      dashboardData: getDefaultDashboardData(),
      user: req.user || null,
      title: 'Dashboard - OmniFlow POS',
      error: 'Terjadi kesalahan saat memuat dashboard',
      lastUpdated: new Date().toLocaleTimeString('id-ID'),
      currentDateTime: new Date().toLocaleString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    });
  }
};

const getDashboardStatistics = async () => {
  const connection = await pool.getConnection();
  
  try {
    // Parallel execution untuk performa lebih baik
    const [
      todaySalesResult,
      totalProductsResult,
      lowStockResult,
      totalCustomersResult,
      recentTransactions,
      lowStockItems,
      topProducts,
      salesChartResult,
      monthlySalesResult
    ] = await Promise.all([
      // Today's sales
      connection.execute(`
        SELECT COALESCE(SUM(total_harga), 0) as total_sales,
               COUNT(*) as transaction_count
        FROM transactions 
        WHERE DATE(tanggal_transaksi) = CURDATE() 
        AND status = 'selesai'
      `),
      
      // Total products and stock - DIPERBAIKI: Hapus kondisi deleted_at
      connection.execute(`
        SELECT COUNT(*) as total_products,
               COALESCE(SUM(jumlah_stok), 0) as total_stock
        FROM barangs
      `),
      
      // Low stock items count - DIPERBAIKI: Hapus kondisi deleted_at
      connection.execute(`
        SELECT COUNT(*) as low_stock_count
        FROM barangs 
        WHERE jumlah_stok < 15
      `),
      
      // Total customers - DIPERBAIKI: Hapus kondisi deleted_at
      connection.execute(`
        SELECT COUNT(*) as total_customers
        FROM customers
      `),
      
      // Recent transactions
      connection.execute(`
        SELECT t.id, t.total_harga, t.status, t.tanggal_transaksi,
               COALESCE(c.nama, 'Walk-in Customer') as customer_name
        FROM transactions t
        LEFT JOIN customers c ON t.customer_id = c.id
        WHERE DATE(t.tanggal_transaksi) = CURDATE()
        ORDER BY t.tanggal_transaksi DESC
        LIMIT 5
      `),
      
      // Low stock items detail - DIPERBAIKI: Hapus kondisi deleted_at
      connection.execute(`
        SELECT id, nama, SKU, jumlah_stok, harga_beli
        FROM barangs 
        WHERE jumlah_stok < 15
        ORDER BY jumlah_stok ASC
        LIMIT 10
      `),
      
      // Top selling products - DIPERBAIKI: Hapus kondisi deleted_at
      connection.execute(`
        SELECT b.nama, b.harga_jual, 
               COALESCE(SUM(td.jumlah), 0) as total_sold,
               COALESCE(SUM(td.subtotal), 0) as total_revenue
        FROM barangs b
        LEFT JOIN transaction_details td ON b.id = td.barang_id
        LEFT JOIN transactions t ON td.transaction_id = t.id 
        WHERE t.status = 'selesai'
        AND t.tanggal_transaksi >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY b.id, b.nama, b.harga_jual
        HAVING total_sold > 0
        ORDER BY total_sold DESC
        LIMIT 5
      `),
      
      // Sales chart data
      connection.execute(`
        SELECT DATE(tanggal_transaksi) as date,
               COALESCE(SUM(total_harga), 0) as daily_sales,
               COUNT(*) as transaction_count
        FROM transactions 
        WHERE tanggal_transaksi >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
        AND status = 'selesai'
        GROUP BY DATE(tanggal_transaksi)
        ORDER BY date ASC
      `),
      
      // Monthly sales comparison
      connection.execute(`
        SELECT 
          COALESCE(SUM(CASE 
            WHEN MONTH(tanggal_transaksi) = MONTH(CURDATE()) 
            AND YEAR(tanggal_transaksi) = YEAR(CURDATE()) 
            THEN total_harga END), 0) as current_month,
          COALESCE(SUM(CASE 
            WHEN MONTH(tanggal_transaksi) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) 
            AND YEAR(tanggal_transaksi) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) 
            THEN total_harga END), 0) as previous_month
        FROM transactions 
        WHERE tanggal_transaksi >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH)
        AND status = 'selesai'
      `)
    ]);

    const todaySales = todaySalesResult[0][0] || { total_sales: 0, transaction_count: 0 };
    const totalProducts = totalProductsResult[0][0] || { total_products: 0, total_stock: 0 };
    const lowStock = lowStockResult[0][0] || { low_stock_count: 0 };
    const totalCustomers = totalCustomersResult[0][0] || { total_customers: 0 };
    const monthlySales = monthlySalesResult[0][0] || { current_month: 0, previous_month: 0 };

    // Fill missing dates for chart
    const salesChart = fillMissingDates(salesChartResult[0], 7);

    // Calculate growth percentage
    const salesGrowth = calculateGrowthPercentage(
      monthlySales.current_month, 
      monthlySales.previous_month
    );

    return {
      todaySales: parseFloat(todaySales.total_sales) || 0,
      todayTransactionCount: parseInt(todaySales.transaction_count) || 0,
      totalProducts: parseInt(totalProducts.total_products) || 0,
      totalStock: parseInt(totalProducts.total_stock) || 0,
      lowStockCount: parseInt(lowStock.low_stock_count) || 0,
      totalCustomers: parseInt(totalCustomers.total_customers) || 0,
      recentTransactions: recentTransactions[0] || [],
      lowStockItems: lowStockItems[0] || [],
      topProducts: topProducts[0] || [],
      salesChart: salesChart || [],
      monthlySales: {
        current_month: parseFloat(monthlySales.current_month) || 0,
        previous_month: parseFloat(monthlySales.previous_month) || 0,
        growth_percentage: salesGrowth
      },
      lastUpdated: new Date().toISOString()
    };
  } finally {
    connection.release();
  }
};

// Helper functions
const fillMissingDates = (data, days) => {
  const result = [];
  const today = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const existingData = data.find(item => {
      const itemDate = new Date(item.date);
      return itemDate.toISOString().split('T')[0] === dateStr;
    });
    
    const formattedDate = date.toLocaleDateString('id-ID', { 
      weekday: 'short', 
      day: 'numeric', 
      month: 'short' 
    });
    
    result.push({
      date: dateStr,
      daily_sales: existingData ? parseFloat(existingData.daily_sales) || 0 : 0,
      transaction_count: existingData ? parseInt(existingData.transaction_count) || 0 : 0,
      formatted_date: formattedDate
    });
  }
  
  return result;
};

const calculateGrowthPercentage = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
};

const getDefaultDashboardData = () => ({
  todaySales: 0,
  todayTransactionCount: 0,
  totalProducts: 0,
  totalStock: 0,
  lowStockCount: 0,
  totalCustomers: 0,
  recentTransactions: [],
  lowStockItems: [],
  topProducts: [],
  salesChart: [],
  monthlySales: { current_month: 0, previous_month: 0, growth_percentage: 0 },
  lastUpdated: new Date().toISOString()
});

// Async logging untuk performa
const logActivity = async (userId, activity, ipAddress, userAgentData) => {
  try {
    const connection = await pool.getConnection();
    await connection.execute(`
      INSERT INTO activity_logs (user_id, activity, ip_address, device_type, browser, platform) 
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      userId,
      activity,
      ipAddress,
      userAgentData.deviceType,
      userAgentData.browser,
      userAgentData.platform
    ]);
    connection.release();
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
};

// API endpoint untuk real-time updates
const getDashboardAPI = async (req, res) => {
  try {
    // Force refresh untuk API calls
    dashboardCache.timestamp = null;
    
    const dashboardData = await getDashboardStatistics();
    
    // Update cache
    dashboardCache.data = dashboardData;
    dashboardCache.timestamp = Date.now();
    
    res.json({
      success: true,
      data: dashboardData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      data: getDefaultDashboardData(),
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Enhanced Excel export
const exportDashboardReport = async (req, res) => {
  try {
    const dashboardData = await getDashboardStatistics();
    
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OmniFlow POS';
    workbook.created = new Date();
    
    // Summary Sheet
    const summarySheet = workbook.addWorksheet('Ringkasan Dashboard');
    
    // Style untuk header
    const headerStyle = {
      font: { bold: true, color: { argb: 'FFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: '4472C4' } },
      alignment: { horizontal: 'center' }
    };
    
    // Header utama
    summarySheet.mergeCells('A1:D1');
    summarySheet.getCell('A1').value = `Dashboard Report - ${new Date().toLocaleDateString('id-ID')}`;
    summarySheet.getCell('A1').style = headerStyle;
    
    // Data summary
    summarySheet.addRow([]);
    summarySheet.addRow(['Metrik', 'Nilai', 'Keterangan', 'Status']);
    summarySheet.getRow(3).eachCell(cell => cell.style = headerStyle);
    
    const summaryData = [
      ['Penjualan Hari Ini', `Rp ${dashboardData.todaySales.toLocaleString('id-ID')}`, `${dashboardData.todayTransactionCount} transaksi`, dashboardData.todaySales > 0 ? 'Aktif' : 'Belum Ada'],
      ['Total Produk', dashboardData.totalProducts, `${dashboardData.totalStock.toLocaleString('id-ID')} total stok`, 'Normal'],
      ['Stok Menipis', dashboardData.lowStockCount, 'Produk < 15 stok', dashboardData.lowStockCount > 0 ? 'Perlu Perhatian' : 'Aman'],
      ['Total Pelanggan', dashboardData.totalCustomers, 'Pelanggan terdaftar', 'Normal'],
      ['Pertumbuhan Bulanan', `${dashboardData.monthlySales.growth_percentage}%`, 'vs bulan lalu', dashboardData.monthlySales.growth_percentage >= 0 ? 'Positif' : 'Negatif']
    ];
    
    summaryData.forEach(row => {
      summarySheet.addRow(row);
    });
    
    // Auto-fit columns
    summarySheet.columns.forEach(column => {
      column.width = 20;
    });
    
    // Top Products Sheet jika ada data
    if (dashboardData.topProducts.length > 0) {
      const productsSheet = workbook.addWorksheet('Produk Terlaris');
      productsSheet.addRow(['Ranking', 'Nama Produk', 'Total Terjual', 'Total Pendapatan']);
      productsSheet.getRow(1).eachCell(cell => cell.style = headerStyle);
      
      dashboardData.topProducts.forEach((product, index) => {
        productsSheet.addRow([
          index + 1,
          product.nama,
          product.total_sold,
          `Rp ${product.total_revenue.toLocaleString('id-ID')}`
        ]);
      });
      
      productsSheet.columns.forEach(column => {
        column.width = 20;
      });
    }
    
    // Low Stock Sheet jika ada data
    if (dashboardData.lowStockItems.length > 0) {
      const stockSheet = workbook.addWorksheet('Stok Menipis');
      stockSheet.addRow(['Nama Produk', 'SKU', 'Jumlah Stok', 'Status']);
      stockSheet.getRow(1).eachCell(cell => cell.style = headerStyle);
      
      dashboardData.lowStockItems.forEach(item => {
        const row = stockSheet.addRow([
          item.nama,
          item.SKU,
          item.jumlah_stok,
          item.jumlah_stok < 5 ? 'Kritis' : 'Rendah'
        ]);
        
        // Highlight critical stock
        if (item.jumlah_stok < 5) {
          row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6' } };
          });
        }
      });
      
      stockSheet.columns.forEach(column => {
        column.width = 20;
      });
    }
    
    // Set response headers
    const filename = `dashboard-report-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    
    await workbook.xlsx.write(res);
    res.end();
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export dashboard report'
    });
  }
};

// Clean up cache periodically
setInterval(() => {
  const now = Date.now();
  if (dashboardCache.timestamp && (now - dashboardCache.timestamp) > dashboardCache.ttl) {
    dashboardCache.data = null;
    dashboardCache.timestamp = null;
  }
}, 60000); // Check every minute

const getOverviewPage = (req, res) => {
  res.render("pages/index/overview", {
    user: req.user || null,
    title: 'Overview - OmniFlow POS'
  });
};

const getSubModulePage = (req, res) => {
  res.render("pages/index/subModule", {
    user: req.user || null,
    title: 'Sub Module - OmniFlow POS'
  });
};

// Test koneksi database
pool.getConnection()
  .then(connection => {
    console.log('✅ Database connected successfully');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

// PERBAIKAN: Export yang benar
module.exports = {
  getAdminPage,
  getDashboardAPI,
  exportDashboardReport,
  getOverviewPage,
  getSubModulePage,
  pool // Export pool jika diperlukan di tempat lain
};