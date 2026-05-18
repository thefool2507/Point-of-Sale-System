// ===== FRONTEND IMPROVEMENTS =====

class DashboardPOS {
  constructor(options = {}) {
    // Konfigurasi yang bisa disesuaikan
    this.config = {
      refreshInterval: options.refreshInterval || 5 * 60 * 1000,
      lowStockThreshold: options.lowStockThreshold || 15,
      animationDuration: options.animationDuration || 1000,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 2000,
      ...options
    };
    
    this.chartInstance = null;
    this.isLoading = false;
    this.refreshTimer = null;
    this.retryCount = 0;
    this.abortController = null; // Untuk cancel requests
    
    this.init();
  }

  init() {
    this.loadInitialData();
    this.setupEventListeners();
    this.setupAutoRefresh();
    this.updateSystemTime();
    
    // Cleanup saat page unload
    window.addEventListener('beforeunload', () => this.cleanup());
  }

  // Improved data loading dengan retry mechanism
  async loadInitialData() {
    if (this.isLoading) return;
    
    try {
      this.showLoadingState();
      
      // Cancel previous request jika ada
      if (this.abortController) {
        this.abortController.abort();
      }
      
      this.abortController = new AbortController();
      
      const response = await fetch('/api/dashboard', {
        signal: this.abortController.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        this.updateDashboard(result.data);
        this.showToast('Dashboard berhasil dimuat', 'success');
        this.retryCount = 0; // Reset counter setelah sukses
      } else {
        throw new Error(result.message || 'Failed to load dashboard data');
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Request was cancelled');
        return;
      }
      
      console.error('Error loading dashboard:', error);
      
      // Retry mechanism
      if (this.retryCount < this.config.maxRetries) {
        this.retryCount++;
        this.showToast(`Mencoba ulang... (${this.retryCount}/${this.config.maxRetries})`, 'warning');
        
        setTimeout(() => {
          this.loadInitialData();
        }, this.config.retryDelay * this.retryCount);
        
        return;
      }
      
      // Jika sudah melebihi max retries
      this.showToast('Gagal memuat data dashboard. Menggunakan data fallback.', 'error');
      this.loadFallbackData();
    } finally {
      this.hideLoadingState();
      this.abortController = null;
    }
  }

  // Improved chart handling
  updateSalesChart(salesData) {
    const ctx = document.getElementById('salesChart');
    if (!ctx) return;

    try {
      // Destroy existing chart dengan proper cleanup
      if (this.chartInstance) {
        this.chartInstance.destroy();
        this.chartInstance = null;
      }

      if (!salesData || salesData.length === 0) {
        ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
        return;
      }

      const labels = salesData.map(item => item.formatted_date);
      const data = salesData.map(item => parseFloat(item.daily_sales) || 0);
      const transactionCounts = salesData.map(item => parseInt(item.transaction_count) || 0);

      this.chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Penjualan (Rp)',
            data: data,
            borderColor: '#4e73df',
            backgroundColor: 'rgba(78, 115, 223, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#4e73df',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: '#4e73df',
          }, {
            label: 'Jumlah Transaksi',
            data: transactionCounts,
            borderColor: '#1cc88a',
            backgroundColor: 'rgba(28, 200, 138, 0.1)',
            borderWidth: 2,
            fill: false,
            tension: 0.4,
            yAxisID: 'y1',
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            intersect: false,
            mode: 'index'
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  if (context.datasetIndex === 0) {
                    return 'Penjualan: ' + new Intl.NumberFormat('id-ID', {
                      style: 'currency',
                      currency: 'IDR',
                      minimumFractionDigits: 0
                    }).format(context.raw);
                  } else {
                    return 'Transaksi: ' + context.raw + ' kali';
                  }
                }
              }
            }
          },
          scales: {
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return new Intl.NumberFormat('id-ID', {
                    style: 'currency',
                    currency: 'IDR',
                    minimumFractionDigits: 0,
                    notation: 'compact'
                  }).format(value);
                }
              }
            },
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              beginAtZero: true,
              grid: {
                drawOnChartArea: false,
              },
            },
          }
        }
      });
    } catch (error) {
      console.error('Error updating chart:', error);
      this.showToast('Gagal memperbarui grafik', 'error');
    }
  }

  // Improved auto refresh
  setupAutoRefresh() {
    // Clear existing timer
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    
    this.refreshTimer = setInterval(() => {
      if (!this.isLoading && document.visibilityState === 'visible') {
        this.loadInitialData();
      }
    }, this.config.refreshInterval);
    
    // Pause refresh saat tab tidak aktif
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.isLoading) {
        // Refresh data saat kembali ke tab
        this.loadInitialData();
      }
    });
  }

  // Improved error handling untuk network issues
  async handleNetworkError(error) {
    if (!navigator.onLine) {
      this.showToast('Tidak ada koneksi internet', 'error');
      return;
    }
    
    // Specific error handling
    if (error.message.includes('fetch')) {
      this.showToast('Server tidak dapat dijangkau', 'error');
    } else if (error.message.includes('timeout')) {
      this.showToast('Request timeout', 'error');
    } else {
      this.showToast('Terjadi kesalahan jaringan', 'error');
    }
  }

  // Cleanup method
  cleanup() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }
    
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  // Improved toast with better UX
  showToast(message, type = 'info', duration = 5000) {
    // Remove existing toasts of the same type
    document.querySelectorAll(`.toast-${type}`).forEach(toast => toast.remove());
    
    const toast = document.createElement('div');
    toast.className = `alert alert-${type === 'error' ? 'danger' : type} alert-dismissible fade show position-fixed toast-${type}`;
    toast.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);';
    
    const icon = {
      success: '✓',
      error: '✗',
      warning: '⚠',
      info: 'ℹ'
    }[type] || 'ℹ';
    
    toast.innerHTML = `
      <div class="d-flex align-items-center">
        <span class="me-2">${icon}</span>
        <span>${message}</span>
        <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert"></button>
      </div>
    `;
    
    document.body.appendChild(toast);
    
    // Auto remove
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 150);
      }
    }, duration);
  }
}

// ===== BACKEND IMPROVEMENTS =====

const mysql = require("mysql2/promise");
const ExcelJS = require("exceljs");
const UAParser = require("ua-parser-js");
const { getClientIP } = require("../../helpers/getClientIP");
const { log, LOG_LEVELS } = require("../../helpers/log");

// Improved database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'omniflow_db',
  port: parseInt(process.env.DB_PORT) || 3306,
  
  // Pool configuration
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  
  // MySQL specific options
  charset: 'utf8mb4',
  timezone: '+07:00',
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: false,
  debug: process.env.NODE_ENV === 'development',
  multipleStatements: false
};

const pool = mysql.createPool(dbConfig);

// Configurable constants
const CONFIG = {
  CACHE_TTL: parseInt(process.env.DASHBOARD_CACHE_TTL) || 5 * 60 * 1000,
  LOW_STOCK_THRESHOLD: parseInt(process.env.LOW_STOCK_THRESHOLD) || 15,
  CRITICAL_STOCK_THRESHOLD: parseInt(process.env.CRITICAL_STOCK_THRESHOLD) || 5,
  MAX_RECENT_TRANSACTIONS: parseInt(process.env.MAX_RECENT_TRANSACTIONS) || 5,
  MAX_TOP_PRODUCTS: parseInt(process.env.MAX_TOP_PRODUCTS) || 5,
  MAX_LOW_STOCK_ITEMS: parseInt(process.env.MAX_LOW_STOCK_ITEMS) || 10,
  CHART_DAYS: parseInt(process.env.CHART_DAYS) || 7
};

// Improved cache with better memory management
class DashboardCache {
  constructor() {
    this.data = null;
    this.timestamp = null;
    this.ttl = CONFIG.CACHE_TTL;
    this.isUpdating = false;
  }
  
  isValid() {
    return this.data && this.timestamp && 
           (Date.now() - this.timestamp) < this.ttl;
  }
  
  set(data) {
    this.data = data;
    this.timestamp = Date.now();
    this.isUpdating = false;
  }
  
  clear() {
    this.data = null;
    this.timestamp = null;
    this.isUpdating = false;
  }
  
  shouldUpdate() {
    return !this.isUpdating && !this.isValid();
  }
  
  setUpdating(status) {
    this.isUpdating = status;
  }
}

const dashboardCache = new DashboardCache();

// Improved database operations with better error handling
const getDashboardStatistics = async () => {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    // Set transaction isolation level untuk consistency
    await connection.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    
    const queries = {
      todaySales: `
        SELECT COALESCE(SUM(total_harga), 0) as total_sales,
               COUNT(*) as transaction_count
        FROM transactions 
        WHERE DATE(tanggal_transaksi) = CURDATE() 
        AND status = 'selesai'
      `,
      
      totalProducts: `
        SELECT COUNT(*) as total_products,
               COALESCE(SUM(jumlah_stok), 0) as total_stock
        FROM barangs
        WHERE deleted_at IS NULL
      `,
      
      lowStock: `
        SELECT COUNT(*) as low_stock_count
        FROM barangs 
        WHERE jumlah_stok < ? AND deleted_at IS NULL
      `,
      
      totalCustomers: `
        SELECT COUNT(*) as total_customers
        FROM customers
        WHERE deleted_at IS NULL
      `,
      
      recentTransactions: `
        SELECT t.id, t.total_harga, t.status, t.tanggal_transaksi,
               COALESCE(c.nama, 'Walk-in Customer') as customer_name
        FROM transactions t
        LEFT JOIN customers c ON t.customer_id = c.id
        WHERE DATE(t.tanggal_transaksi) = CURDATE()
        ORDER BY t.tanggal_transaksi DESC
        LIMIT ?
      `,
      
      lowStockItems: `
        SELECT id, nama, SKU, jumlah_stok, harga_beli
        FROM barangs 
        WHERE jumlah_stok < ? AND deleted_at IS NULL
        ORDER BY jumlah_stok ASC
        LIMIT ?
      `,
      
      topProducts: `
        SELECT b.nama, b.harga_jual, 
               COALESCE(SUM(td.jumlah), 0) as total_sold,
               COALESCE(SUM(td.subtotal), 0) as total_revenue
        FROM barangs b
        LEFT JOIN transaction_details td ON b.id = td.barang_id
        LEFT JOIN transactions t ON td.transaction_id = t.id 
        WHERE t.status = 'selesai'
        AND t.tanggal_transaksi >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND b.deleted_at IS NULL
        GROUP BY b.id, b.nama, b.harga_jual
        HAVING total_sold > 0
        ORDER BY total_sold DESC
        LIMIT ?
      `,
      
      salesChart: `
        SELECT DATE(tanggal_transaksi) as date,
               COALESCE(SUM(total_harga), 0) as daily_sales,
               COUNT(*) as transaction_count
        FROM transactions 
        WHERE tanggal_transaksi >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND status = 'selesai'
        GROUP BY DATE(tanggal_transaksi)
        ORDER BY date ASC
      `,
      
      monthlySales: `
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
      `
    };
    
    // Execute all queries with proper parameters
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
      connection.execute(queries.todaySales),
      connection.execute(queries.totalProducts),
      connection.execute(queries.lowStock, [CONFIG.LOW_STOCK_THRESHOLD]),
      connection.execute(queries.totalCustomers),
      connection.execute(queries.recentTransactions, [CONFIG.MAX_RECENT_TRANSACTIONS]),
      connection.execute(queries.lowStockItems, [CONFIG.LOW_STOCK_THRESHOLD, CONFIG.MAX_LOW_STOCK_ITEMS]),
      connection.execute(queries.topProducts, [CONFIG.MAX_TOP_PRODUCTS]),
      connection.execute(queries.salesChart, [CONFIG.CHART_DAYS - 1]),
      connection.execute(queries.monthlySales)
    ]);

    await connection.commit();

    // Process results with proper error handling
    const processResult = (result, defaultValue = {}) => {
      return result && result[0] && result[0][0] ? result[0][0] : defaultValue;
    };

    const todaySales = processResult(todaySalesResult, { total_sales: 0, transaction_count: 0 });
    const totalProducts = processResult(totalProductsResult, { total_products: 0, total_stock: 0 });
    const lowStock = processResult(lowStockResult, { low_stock_count: 0 });
    const totalCustomers = processResult(totalCustomersResult, { total_customers: 0 });
    const monthlySales = processResult(monthlySalesResult, { current_month: 0, previous_month: 0 });

    // Fill missing dates for chart with better error handling
    const salesChart = fillMissingDates(salesChartResult?.[0] || [], CONFIG.CHART_DAYS);

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
      recentTransactions: recentTransactions?.[0] || [],
      lowStockItems: lowStockItems?.[0] || [],
      topProducts: topProducts?.[0] || [],
      salesChart: salesChart || [],
      monthlySales: {
        current_month: parseFloat(monthlySales.current_month) || 0,
        previous_month: parseFloat(monthlySales.previous_month) || 0,
        growth_percentage: salesGrowth
      },
      lastUpdated: new Date().toISOString(),
      config: {
        lowStockThreshold: CONFIG.LOW_STOCK_THRESHOLD,
        criticalStockThreshold: CONFIG.CRITICAL_STOCK_THRESHOLD
      }
    };
    
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    
    console.error('Database error in getDashboardStatistics:', error);
    throw new Error(`Database operation failed: ${error.message}`);
    
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Improved API endpoint dengan better error handling
const getDashboardAPI = async (req, res) => {
  try {
    let dashboardData;
    
    // Check cache first, kecuali jika ada force refresh
    const forceRefresh = req.query.refresh === 'true';
    
    if (!forceRefresh && dashboardCache.isValid()) {
      dashboardData = dashboardCache.data;
    } else if (dashboardCache.shouldUpdate()) {
      dashboardCache.setUpdating(true);
      
      try {
        dashboardData = await getDashboardStatistics();
        dashboardCache.set(dashboardData);
      } catch (error) {
        dashboardCache.setUpdating(false);
        throw error;
      }
    } else {
      // Sedang updating, return cached data atau fallback
      dashboardData = dashboardCache.data || getDefaultDashboardData();
    }
    
    res.json({
      success: true,
      data: dashboardData,
      timestamp: new Date().toISOString(),
      cached: !forceRefresh && dashboardCache.isValid()
    });
    
  } catch (error) {
    console.error('Dashboard API error:', error);
    
    // Log error untuk monitoring
    if (process.env.NODE_ENV === 'production') {
      // Integrate dengan error monitoring service
      // logger.error('Dashboard API Error', { error: error.message, stack: error.stack });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      data: getDefaultDashboardData(),
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});



module.exports = {
  getAdminPage,
  getDashboardAPI,
  exportDashboardReport,
  getOverviewPage,
  getSubModulePage,
  pool,
  CONFIG // Export config untuk testing
};