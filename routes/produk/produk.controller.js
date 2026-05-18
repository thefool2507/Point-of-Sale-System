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
    browser: `${result.browser.name || 'Unknown'} ${result.browser.version || ''}`.trim(),
    platform: `${result.os.name || 'Unknown'} ${result.os.version || ''}`.trim(),
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

// Helper function to validate category exists
const validateCategory = async (kategoriId) => {
  if (!kategoriId) return true;
  
  try {
    const [categories] = await db.execute(
      `SELECT id FROM kategori_produk WHERE id = ?`,
      [kategoriId]
    );
    return categories.length > 0;
  } catch (error) {
    console.error("Error validating category:", error);
    return false;
  }
};

// Test database connection
const testDatabaseConnection = async () => {
  try {
    const [result] = await db.execute('SELECT 1 as test');
    console.log('Database connection OK');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
};

// Get all products with improved error handling
const getAllProduk = async (req, res) => {
  try {
    // Test database connection first
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected) {
      throw new Error('Database connection failed');
    }

    // Validate and sanitize parameters
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const search = (req.query.search || '').toString().trim();
    const offset = (page - 1) * limit;

    console.log('Query parameters:', { page, limit, search, offset });

    // Build queries
    let baseQuery = `FROM barangs b LEFT JOIN kategori_produk kp ON b.kategori_id = kp.id`;
    let whereClause = '';
    let countParams = [];
    let dataParams = [];

    if (search) {
      whereClause = ` WHERE (b.nama LIKE ? OR b.SKU LIKE ? OR b.deskripsi LIKE ?)`;
      const searchParam = `%${search}%`;
      countParams = [searchParam, searchParam, searchParam];
      dataParams = [searchParam, searchParam, searchParam];
    }

    const countQuery = `SELECT COUNT(*) as total ${baseQuery}${whereClause}`;
    const dataQuery = `SELECT b.*, kp.nama as kategori_nama ${baseQuery}${whereClause} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`;
    
    dataParams.push(limit, offset);

    // Execute queries with error handling
    let totalProducts = 0;
    let products = [];
    let categories = [];

    try {
      const [countResult] = await db.execute(countQuery, countParams);
      totalProducts = parseInt(countResult[0]?.total) || 0;
    } catch (error) {
      console.error("Error executing count query:", error);
      throw new Error("Failed to get product count");
    }

    try {
      const [productResult] = await db.execute(dataQuery, dataParams);
      products = productResult || [];
    } catch (error) {
      console.error("Error executing data query:", error);
      throw new Error("Failed to get products");
    }

    try {
      const [categoryResult] = await db.execute(`SELECT id, nama FROM kategori_produk ORDER BY nama ASC`);
      categories = categoryResult || [];
    } catch (error) {
      console.error("Error getting categories:", error);
      // Categories is not critical, continue without them
    }

    const totalPages = Math.ceil(totalProducts / limit);

    // Log activity
    const userId = req.session?.user?.id;
    if (userId) {
      try {
        await logActivity(userId, 'Melihat daftar produk', req);
      } catch (logError) {
        console.warn('Failed to log activity:', logError.message);
      }
    }

    // Render response
    if (req.accepts('html')) {
      res.render("pages/produk/index", {
        title: "Daftar Produk",
        products,
        categories,
        currentPage: page,
        totalPages,
        totalProducts,
        search,
        limit,
        user: req.session?.user || null
      });
    } else {
      res.json({
        products,
        categories,
        pagination: {
          currentPage: page,
          totalPages,
          totalProducts,
          limit
        }
      });
    }

  } catch (error) {
    console.error("Error in getAllProduk:", error);
    
    // Log error
    try {
      const userId = req.session?.user?.id || null;
      const errorMessage = `Error getting products: ${error.message}`;
      await log(LOG_LEVELS.ERROR, errorMessage, { userId });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
    
    // Send error response
    if (req.accepts('html')) {
      res.status(500).render('pages/produk/index', {
        title: 'Daftar Produk',
        products: [],
        categories: [],
        currentPage: 1,
        totalPages: 0,
        totalProducts: 0,
        search: '',
        limit: 10,
        error: 'Terjadi kesalahan saat mengambil data produk',
        user: req.session?.user || null
      });
    } else {
      res.status(500).json({ 
        message: "Terjadi kesalahan saat mengambil data produk",
        error: error.message
      });
    }
  }
};

// Get product by ID with better validation
const getProdukById = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ message: "ID produk tidak valid" });
    }

    const productId = parseInt(id);
    if (productId <= 0) {
      return res.status(400).json({ message: "ID produk harus lebih dari 0" });
    }

    const [products] = await db.execute(
      `SELECT b.*, kp.nama as kategori_nama 
       FROM barangs b 
       LEFT JOIN kategori_produk kp ON b.kategori_id = kp.id 
       WHERE b.id = ?`, 
      [productId]
    );

    if (products.length === 0) {
      return res.status(404).json({ message: "Produk tidak ditemukan" });
    }

    const userId = req.session?.user?.id || null;
    if (userId) {
      await logActivity(userId, `Melihat detail produk: ${products[0].nama}`, req);
    }
    
    res.json(products[0]);
  } catch (error) {
    console.error("Error in getProdukById:", error);
    await log(LOG_LEVELS.ERROR, "Error getting product by ID", { error: error.message });
    res.status(500).json({ 
      message: "Terjadi kesalahan saat mengambil data produk",
      error: error.message 
    });
  }
};

// Create new product with better validation
const createProduk = async (req, res) => {
  try {
    const { nama, deskripsi, SKU, jumlah_stok, kategori_id, harga_beli, harga_jual } = req.body;

    // Validate required fields
    if (!nama || !nama.trim()) {
      return res.status(400).json({ message: "Nama produk wajib diisi" });
    }
    if (!SKU || !SKU.trim()) {
      return res.status(400).json({ message: "SKU wajib diisi" });
    }

    // Validate and sanitize inputs
    const sanitizedData = {
      nama: nama.trim(),
      deskripsi: deskripsi ? deskripsi.trim() : null,
      SKU: SKU.trim().toUpperCase(), // Standardize SKU format
      jumlah_stok: Math.max(0, parseInt(jumlah_stok) || 0),
      kategori_id: kategori_id && kategori_id !== '' ? parseInt(kategori_id) : null,
      harga_beli: Math.max(0, parseFloat(harga_beli) || 0),
      harga_jual: Math.max(0, parseFloat(harga_jual) || 0)
    };

    // Additional validations
    if (sanitizedData.nama.length > 255) {
      return res.status(400).json({ message: "Nama produk terlalu panjang (maksimal 255 karakter)" });
    }
    if (sanitizedData.SKU.length > 50) {
      return res.status(400).json({ message: "SKU terlalu panjang (maksimal 50 karakter)" });
    }
    if (sanitizedData.deskripsi && sanitizedData.deskripsi.length > 1000) {
      return res.status(400).json({ message: "Deskripsi terlalu panjang (maksimal 1000 karakter)" });
    }

    // Validate category exists if provided
    if (sanitizedData.kategori_id) {
      const categoryExists = await validateCategory(sanitizedData.kategori_id);
      if (!categoryExists) {
        return res.status(400).json({ message: "Kategori tidak ditemukan" });
      }
    }

    // Check if SKU already exists
    const [existingSKU] = await db.execute(`SELECT id FROM barangs WHERE SKU = ?`, [sanitizedData.SKU]);
    if (existingSKU.length > 0) {
      return res.status(400).json({ message: "SKU sudah digunakan" });
    }

    // Insert new product
    const [result] = await db.execute(
      `INSERT INTO barangs (nama, deskripsi, SKU, jumlah_stok, kategori_id, harga_beli, harga_jual) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        sanitizedData.nama, 
        sanitizedData.deskripsi, 
        sanitizedData.SKU, 
        sanitizedData.jumlah_stok, 
        sanitizedData.kategori_id, 
        sanitizedData.harga_beli, 
        sanitizedData.harga_jual
      ]
    );

    const userId = req.session?.user?.id || null;
    if (userId) {
      await logActivity(userId, `Menambah produk baru: ${sanitizedData.nama}`, req);
    }
    
    res.json({ 
      message: "Produk berhasil ditambahkan", 
      id: result.insertId,
      product: sanitizedData
    });
  } catch (error) {
    console.error("Error in createProduk:", error);
    await log(LOG_LEVELS.ERROR, "Error creating product", { error: error.message });
    
    // Handle specific database errors
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ message: "SKU sudah digunakan" });
    } else if (error.code === 'ER_BAD_NULL_ERROR') {
      res.status(400).json({ message: "Ada field wajib yang tidak diisi" });
    } else {
      res.status(500).json({ 
        message: "Terjadi kesalahan saat menambah produk",
        error: error.message 
      });
    }
  }
};

// Update product with transaction
const updateProduk = async (req, res) => {
  try {
    const { id } = req.params;
    const { nama, deskripsi, SKU, jumlah_stok, kategori_id, harga_beli, harga_jual } = req.body;

    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ message: "ID produk tidak valid" });
    }

    const productId = parseInt(id);

    // Check if product exists first
    const [existingProduct] = await db.execute(`SELECT * FROM barangs WHERE id = ?`, [productId]);
    if (existingProduct.length === 0) {
      return res.status(404).json({ message: "Produk tidak ditemukan" });
    }

    // Validate required fields
    if (!nama || !nama.trim()) {
      return res.status(400).json({ message: "Nama produk wajib diisi" });
    }
    if (!SKU || !SKU.trim()) {
      return res.status(400).json({ message: "SKU wajib diisi" });
    }

    // Validate and sanitize inputs
    const sanitizedData = {
      nama: nama.trim(),
      deskripsi: deskripsi ? deskripsi.trim() : null,
      SKU: SKU.trim().toUpperCase(),
      jumlah_stok: Math.max(0, parseInt(jumlah_stok) || 0),
      kategori_id: kategori_id && kategori_id !== '' ? parseInt(kategori_id) : null,
      harga_beli: Math.max(0, parseFloat(harga_beli) || 0),
      harga_jual: Math.max(0, parseFloat(harga_jual) || 0)
    };

    // Validate category exists if provided
    if (sanitizedData.kategori_id) {
      const categoryExists = await validateCategory(sanitizedData.kategori_id);
      if (!categoryExists) {
        return res.status(400).json({ message: "Kategori tidak ditemukan" });
      }
    }

    // Check if SKU already exists for other products
    const [existingSKU] = await db.execute(
      `SELECT id FROM barangs WHERE SKU = ? AND id != ?`, 
      [sanitizedData.SKU, productId]
    );
    if (existingSKU.length > 0) {
      return res.status(400).json({ message: "SKU sudah digunakan oleh produk lain" });
    }

    // Update product
    const [result] = await db.execute(
      `UPDATE barangs SET nama = ?, deskripsi = ?, SKU = ?, jumlah_stok = ?, 
       kategori_id = ?, harga_beli = ?, harga_jual = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [
        sanitizedData.nama, 
        sanitizedData.deskripsi, 
        sanitizedData.SKU, 
        sanitizedData.jumlah_stok, 
        sanitizedData.kategori_id, 
        sanitizedData.harga_beli, 
        sanitizedData.harga_jual,
        productId
      ]
    );

    const userId = req.session?.user?.id || null;
    if (userId) {
      await logActivity(userId, `Mengubah produk: ${sanitizedData.nama}`, req);
    }
    
    res.json({ 
      message: "Produk berhasil diperbarui",
      product: sanitizedData
    });
  } catch (error) {
    console.error("Error in updateProduk:", error);
    await log(LOG_LEVELS.ERROR, "Error updating product", { error: error.message });
    res.status(500).json({ 
      message: "Terjadi kesalahan saat mengubah produk",
      error: error.message 
    });
  }
};

// Delete product with proper checks
const deleteProduk = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ message: "ID produk tidak valid" });
    }

    const productId = parseInt(id);

    // Get product info before deleting
    const [products] = await db.execute(`SELECT nama FROM barangs WHERE id = ?`, [productId]);
    if (products.length === 0) {
      return res.status(404).json({ message: "Produk tidak ditemukan" });
    }

    // Check if product is used in transactions
    const [transactionCheck] = await db.execute(
      `SELECT COUNT(*) as count FROM transaction_details WHERE barang_id = ?`,
      [productId]
    );

    if (transactionCheck[0].count > 0) {
      return res.status(400).json({ 
        message: "Produk tidak dapat dihapus karena sudah digunakan dalam transaksi" 
      });
    }

    // Delete product
    const [result] = await db.execute(`DELETE FROM barangs WHERE id = ?`, [productId]);

    const userId = req.session?.user?.id || null;
    if (userId) {
      await logActivity(userId, `Menghapus produk: ${products[0].nama}`, req);
    }
    
    res.json({ message: "Produk berhasil dihapus" });
  } catch (error) {
    console.error("Error in deleteProduk:", error);
    await log(LOG_LEVELS.ERROR, "Error deleting product", { error: error.message });
    res.status(500).json({ 
      message: "Terjadi kesalahan saat menghapus produk",
      error: error.message 
    });
  }
};

// Export products to Excel with better error handling
const exportProduk = async (req, res) => {
  try {
    const [products] = await db.execute(
      `SELECT b.*, kp.nama as kategori_nama 
       FROM barangs b 
       LEFT JOIN kategori_produk kp ON b.kategori_id = kp.id 
       ORDER BY b.created_at DESC`
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Daftar Produk');

    // Add headers
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Nama Produk', key: 'nama', width: 30 },
      { header: 'SKU', key: 'SKU', width: 20 },
      { header: 'Deskripsi', key: 'deskripsi', width: 40 },
      { header: 'Kategori', key: 'kategori_nama', width: 20 },
      { header: 'Stok', key: 'jumlah_stok', width: 15 },
      { header: 'Harga Beli', key: 'harga_beli', width: 15 },
      { header: 'Harga Jual', key: 'harga_jual', width: 15 },
      { header: 'Dibuat', key: 'created_at', width: 20 }
    ];

    // Add data with proper formatting
    products.forEach(product => {
      worksheet.addRow({
        id: product.id,
        nama: product.nama,
        SKU: product.SKU,
        deskripsi: product.deskripsi || '',
        kategori_nama: product.kategori_nama || '',
        jumlah_stok: product.jumlah_stok,
        harga_beli: parseFloat(product.harga_beli),
        harga_jual: parseFloat(product.harga_jual),
        created_at: product.created_at
      });
    });

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6E6FA' }
    };

    // Ensure uploads directory exists
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const fileName = `produk_${new Date().toISOString().split('T')[0]}_${Date.now()}.xlsx`;
    const filePath = path.join(uploadsDir, fileName);

    await workbook.xlsx.writeFile(filePath);

    const userId = req.session?.user?.id || null;
    if (userId) {
      await logActivity(userId, 'Export data produk ke Excel', req);
    }

    res.download(filePath, `produk_${new Date().toISOString().split('T')[0]}.xlsx`, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        if (!res.headersSent) {
          res.status(500).json({ message: "Error saat download file" });
        }
      }
      // Delete file after download
      setTimeout(() => {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
        });
      }, 1000);
    });
  } catch (error) {
    console.error("Error in exportProduk:", error);
    await log(LOG_LEVELS.ERROR, "Error exporting products", { error: error.message });
    res.status(500).json({ 
      message: "Terjadi kesalahan saat export data",
      error: error.message 
    });
  }
};

// Import products from Excel with better validation
const importProduk = async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ message: "File Excel tidak ditemukan" });
    }

    filePath = req.file.path;

    // Validate file size (max 5MB)
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ message: "File terlalu besar (maksimal 5MB)" });
    }

    // Validate file type
    const allowedTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ message: "Format file tidak didukung. Gunakan file Excel (.xlsx atau .xls)" });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) {
      return res.status(400).json({ message: "Format file Excel tidak valid" });
    }

    const products = [];
    const errors = [];
    let rowCount = 0;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header
      
      // Skip empty rows
      if (!row.hasValues) return;
      
      rowCount++;
      
      // Get values with proper null checking
      const nama = row.getCell(1).value;
      const SKU = row.getCell(2).value;
      const deskripsi = row.getCell(3).value;
      const kategori = row.getCell(4).value;
      const jumlah_stok = row.getCell(5).value;
      const harga_beli = row.getCell(6).value;
      const harga_jual = row.getCell(7).value;

      // Validate required fields
      if (!nama || !SKU) {
        errors.push(`Baris ${rowNumber}: Nama dan SKU wajib diisi`);
        return;
      }

      // Validate data types
      const stockValue = parseInt(jumlah_stok) || 0;
      const buyPrice = parseFloat(harga_beli) || 0;
      const sellPrice = parseFloat(harga_jual) || 0;

      if (stockValue < 0) {
        errors.push(`Baris ${rowNumber}: Jumlah stok tidak boleh negatif`);
        return;
      }

      if (buyPrice < 0 || sellPrice < 0) {
        errors.push(`Baris ${rowNumber}: Harga tidak boleh negatif`);
        return;
      }

      products.push({
        nama: nama.toString().trim(),
        SKU: SKU.toString().trim().toUpperCase(),
        deskripsi: deskripsi ? deskripsi.toString().trim() : null,
        jumlah_stok: stockValue,
        harga_beli: buyPrice,
        harga_jual: sellPrice
      });
    });

    if (rowCount === 0) {
      return res.status(400).json({ message: "File Excel kosong atau tidak memiliki data" });
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: "Ada kesalahan dalam file", errors });
    }

    // Validate maximum number of products
    if (products.length > 1000) {
      return res.status(400).json({ 
        message: "Terlalu banyak produk dalam satu file (maksimal 1000)" 
      });
    }

    // Insert products with transaction
    await db.execute('START TRANSACTION');
    
    try {
      let successCount = 0;
      const duplicateSKUs = new Set();
      
      for (const product of products) {
        try {
          // Check for duplicate SKUs in the same import
          if (duplicateSKUs.has(product.SKU)) {
            errors.push(`SKU ${product.SKU} duplikat dalam file`);
            continue;
          }
          duplicateSKUs.add(product.SKU);

          await db.execute(
            `INSERT INTO barangs (nama, deskripsi, SKU, jumlah_stok, harga_beli, harga_jual) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [product.nama, product.deskripsi, product.SKU, product.jumlah_stok, product.harga_beli, product.harga_jual]
          );
          successCount++;
        } catch (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            errors.push(`SKU ${product.SKU} sudah ada di database`);
          } else {
            errors.push(`Error pada produk ${product.nama}: ${err.message}`);
          }
        }
      }

      if (successCount === 0) {
        await db.execute('ROLLBACK');
        return res.status(400).json({ 
          message: "Tidak ada produk yang berhasil diimport", 
          errors 
        });
      }

      await db.execute('COMMIT');

      const userId = req.session?.user?.id || null;
      if (userId) {
        await logActivity(userId, `Import ${successCount} produk dari Excel`, req);
      }

      res.json({ 
        message: `Berhasil import ${successCount} dari ${products.length} produk`, 
        successCount,
        totalCount: products.length,
        errors: errors.length > 0 ? errors : null 
      });

    } catch (transactionError) {
      await db.execute('ROLLBACK');
      throw transactionError;
    }

  } catch (error) {
    console.error("Error in importProduk:", error);
    await log(LOG_LEVELS.ERROR, "Error importing products", { error: error.message });
    res.status(500).json({ 
      message: "Terjadi kesalahan saat import data",
      error: error.message 
    });
  } finally {
    // Clean up file
    if (filePath) {
      fs.unlink(filePath, (err) => {
        if (err) console.error('Error deleting uploaded file:', err);
      });
    }
  }
};

module.exports = {
  getAllProduk,
  getProdukById,
  createProduk,
  updateProduk,
  deleteProduk,
  exportProduk,
  importProduk,
  testDatabaseConnection
};