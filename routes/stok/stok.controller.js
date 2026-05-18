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

// Helper function to record stock history
const recordStockHistory = async (barangId, jumlah, tipe, userId, keterangan, referenceType = null, referenceId = null) => {
  try {
    await db.query(
      `INSERT INTO stock_history 
       (barang_id, jumlah, tipe, reference_id, reference_type, keterangan, user_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [barangId, jumlah, tipe, referenceId, referenceType, keterangan, userId, new Date()]
    );
  } catch (error) {
    console.error("Error recording stock history:", error);
  }
};

const getAllStok = async (req, res) => {
  try {
    // Enhanced query with category information and better formatting
    const query = `
      SELECT 
        b.id,
        b.nama,
        b.deskripsi,
        b.SKU,
        b.jumlah_stok,
        b.harga_beli,
        b.harga_jual,
        b.created_at,
        b.updated_at,
        b.kategori_id,
        COALESCE(kp.nama, 'Tidak Ada Kategori') as kategori_nama,
        CASE 
          WHEN b.jumlah_stok <= 5 THEN 'low'
          WHEN b.jumlah_stok <= 20 THEN 'medium'
          ELSE 'high'
        END as stock_level,
        COALESCE(b.harga_jual - b.harga_beli, 0) as profit_margin
      FROM barangs b
      LEFT JOIN kategori_produk kp ON b.kategori_id = kp.id
      ORDER BY b.nama ASC
    `;
    
    // Query untuk mengambil semua kategori
    const kategoriQuery = `
      SELECT id, nama 
      FROM kategori_produk 
      ORDER BY nama ASC
    `;
    
    const [barangs] = await db.query(query);
    const [kategoris] = await db.query(kategoriQuery);
    
    // Calculate total stock value
    const totalStockValue = barangs.reduce((total, barang) => 
      total + (parseFloat(barang.harga_beli) * barang.jumlah_stok), 0
    );
    
    // Count low stock items
    const lowStockCount = barangs.filter(barang => barang.jumlah_stok <= 5).length;
    
    res.render("pages/stok/index", { 
      barangs,
      kategoris, // Pass categories to the view
      totalStockValue,
      lowStockCount,
      totalItems: barangs.length
    });
  } catch (error) {
    console.error("Error fetching all barang:", error);
    req.flash("error", "Gagal mengambil data barang");
    res.redirect("/dashboard");
  }
};

const downloadStok = async (req, res) => {
  try {
    // Enhanced query with more details for export
    const query = `
      SELECT 
        b.id,
        b.nama,
        b.deskripsi,
        b.SKU,
        b.jumlah_stok,
        b.harga_beli,
        b.harga_jual,
        COALESCE(kp.nama, 'Tidak Ada Kategori') as kategori,
        b.created_at,
        b.updated_at,
        (b.harga_jual - b.harga_beli) as profit_per_unit,
        (b.jumlah_stok * b.harga_beli) as total_investment,
        (b.jumlah_stok * b.harga_jual) as potential_revenue
      FROM barangs b
      LEFT JOIN kategori_produk kp ON b.kategori_id = kp.id
      ORDER BY b.nama ASC
    `;
    
    const [barangs] = await db.query(query);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data Stok Barang");

    // Enhanced columns with more business insights
    worksheet.columns = [
      { header: "ID", key: "id", width: 8 },
      { header: "Nama Barang", key: "nama", width: 25 },
      { header: "Deskripsi", key: "deskripsi", width: 30 },
      { header: "SKU", key: "SKU", width: 20 },
      { header: "Kategori", key: "kategori", width: 20 },
      { header: "Stok", key: "jumlah_stok", width: 10 },
      { header: "Harga Beli", key: "harga_beli", width: 15 },
      { header: "Harga Jual", key: "harga_jual", width: 15 },
      { header: "Profit/Unit", key: "profit_per_unit", width: 15 },
      { header: "Total Investasi", key: "total_investment", width: 18 },
      { header: "Potensi Pendapatan", key: "potential_revenue", width: 20 },
      { header: "Dibuat", key: "created_at", width: 18 },
    ];

    // Style header
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "4472C4" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    // Add data with formatting
    barangs.forEach((barang, index) => {
      const row = worksheet.addRow({
        ...barang,
        created_at: new Date(barang.created_at).toLocaleDateString('id-ID')
      });
      
      // Color coding for low stock
      if (barang.jumlah_stok <= 5) {
        row.getCell('jumlah_stok').fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE6E6" }
        };
      }
      
      // Format currency columns
      ['harga_beli', 'harga_jual', 'profit_per_unit', 'total_investment', 'potential_revenue'].forEach(col => {
        row.getCell(col).numFmt = '"Rp"#,##0.00';
      });
    });

    // Add summary row
    const summaryRow = worksheet.addRow({
      nama: "TOTAL",
      jumlah_stok: barangs.reduce((sum, b) => sum + b.jumlah_stok, 0),
      total_investment: barangs.reduce((sum, b) => sum + parseFloat(b.total_investment), 0),
      potential_revenue: barangs.reduce((sum, b) => sum + parseFloat(b.potential_revenue), 0)
    });
    
    summaryRow.font = { bold: true };
    summaryRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "F2F2F2" }
    };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition", 
      `attachment; filename=stok-barang-${new Date().toISOString().split('T')[0]}.xlsx`
    );

    await workbook.xlsx.write(res);
    
    // Log download activity
    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);
    await log(
      `${req.session.user.username} exported stock data (${barangs.length} items)`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );
    
    res.end();

  } catch (error) {
    console.error("Error Generating Excel File:", error);
    req.flash("error", "Gagal mendownload data stok");
    res.redirect("/stok/index");
  }
};

const uploadNewStok = async (req, res) => {
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);
  let filePath = null;

  try {
    if (!req.file) {
      req.flash("error", "File upload diperlukan");
      return res.redirect("/stok/index");
    }

    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    if (fileExtension !== '.xlsx' && fileExtension !== '.xls') {
      req.flash("error", "File harus berformat Excel (.xlsx atau .xls)");
      return res.redirect("/stok/index");
    }

    filePath = req.file.path;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) {
      req.flash("error", "Format file tidak valid. Worksheet tidak ditemukan.");
      cleanupFile(filePath);
      return res.redirect("/stok/index");
    }

    const barangs = [];
    const duplicateSKUs = [];
    const errors = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const rowValues = row.values.slice(1); // Remove empty first element
      
      if (rowValues.length >= 6) { // nama, deskripsi, SKU, stok, harga_beli, harga_jual
        const [nama, deskripsi, SKU, jumlah_stok, harga_beli, harga_jual] = rowValues.map((value) => {
          if (value && typeof value === "object" && value.text) {
            return value.text;
          }
          return value;
        });

        // Enhanced validation
        if (!nama || !SKU || !jumlah_stok) {
          errors.push(`Baris ${rowNumber}: Nama, SKU, dan jumlah stok wajib diisi`);
          return;
        }

        const parsedStok = parseInt(jumlah_stok);
        const parsedHargaBeli = parseFloat(harga_beli) || 0;
        const parsedHargaJual = parseFloat(harga_jual) || 0;

        if (isNaN(parsedStok) || parsedStok < 0) {
          errors.push(`Baris ${rowNumber}: Jumlah stok harus berupa angka positif`);
          return;
        }

        if (parsedHargaBeli < 0 || parsedHargaJual < 0) {
          errors.push(`Baris ${rowNumber}: Harga tidak boleh negatif`);
          return;
        }

        barangs.push({
          nama: nama.toString().trim(),
          deskripsi: (deskripsi || "").toString().trim(),
          SKU: SKU.toString().trim(),
          jumlah_stok: parsedStok,
          harga_beli: parsedHargaBeli,
          harga_jual: parsedHargaJual,
          rowNumber
        });
      }
    });

    if (errors.length > 0) {
      req.flash("error", `Kesalahan validasi: ${errors.join('; ')}`);
      cleanupFile(filePath);
      return res.redirect("/stok/index");
    }

    if (barangs.length === 0) {
      req.flash("error", "Tidak ada data valid yang ditemukan dalam file.");
      cleanupFile(filePath);
      return res.redirect("/stok/index");
    }

    // Start database transaction
    await db.query('START TRANSACTION');

    try {
      const now = new Date();
      let successCount = 0;

      for (const barang of barangs) {
        const [existingBarang] = await db.query(
          "SELECT id FROM barangs WHERE SKU = ?",
          [barang.SKU]
        );

        if (existingBarang.length > 0) {
          duplicateSKUs.push(`${barang.SKU} (baris ${barang.rowNumber})`);
          continue;
        }

        const [result] = await db.query(
          `INSERT INTO barangs 
           (nama, deskripsi, SKU, jumlah_stok, harga_beli, harga_jual, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [barang.nama, barang.deskripsi, barang.SKU, barang.jumlah_stok, 
           barang.harga_beli, barang.harga_jual, now, now]
        );

        // Record stock history
        await recordStockHistory(
          result.insertId,
          barang.jumlah_stok,
          'masuk',
          req.session.user.id,
          `Stok awal dari upload Excel: ${barang.nama}`,
          'adjustment'
        );

        await log(
          `Barang ${barang.nama} (SKU: ${barang.SKU}) ditambahkan via upload Excel`,
          LOG_LEVELS.INFO,
          req.session.user.id,
          userAgentData,
          ip
        );

        successCount++;
      }

      await db.query('COMMIT');

      let message = `Berhasil mengupload ${successCount} barang`;
      if (duplicateSKUs.length > 0) {
        message += `. SKU duplikat dilewati: ${duplicateSKUs.join(', ')}`;
      }

      req.flash("success", message);

    } catch (dbError) {
      await db.query('ROLLBACK');
      throw dbError;
    }

    cleanupFile(filePath);
    return res.redirect("/stok/index");

  } catch (err) {
    await log(
      `Error upload stok Excel: ${err.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );
    
    req.flash("error", `Terjadi kesalahan: ${err.message}`);
    
    if (filePath) {
      cleanupFile(filePath);
    }
    
    return res.redirect("/stok/index");
  }
};

const downloadStokTemplate = (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Template Stok");

    // Enhanced template with price fields
    worksheet.columns = [
      { header: "Nama Barang *", key: "nama", width: 25 },
      { header: "Deskripsi", key: "deskripsi", width: 30 },
      { header: "SKU *", key: "SKU", width: 20 },
      { header: "Jumlah Stok *", key: "jumlah_stok", width: 15 },
      { header: "Harga Beli", key: "harga_beli", width: 15 },
      { header: "Harga Jual", key: "harga_jual", width: 15 },
    ];

    // Style header
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "4472C4" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    // Add example data
    worksheet.addRow({
      nama: "Laptop Gaming ASUS ROG",
      deskripsi: "Laptop gaming dengan spesifikasi tinggi",
      SKU: "ASUS-ROG-002",
      jumlah_stok: 5,
      harga_beli: 12000000,
      harga_jual: 15000000
    });

    worksheet.addRow({
      nama: "Mouse Wireless Logitech",
      deskripsi: "Mouse wireless dengan sensor presisi tinggi",
      SKU: "LOGI-MX-001",
      jumlah_stok: 25,
      harga_beli: 150000,
      harga_jual: 200000
    });

    // Add instructions
    const instructionRow = worksheet.addRow({});
    instructionRow.getCell(1).value = "PETUNJUK PENGISIAN:";
    instructionRow.getCell(1).font = { bold: true, color: { argb: "FF0000" } };

    worksheet.addRow({ nama: "- Kolom dengan tanda * wajib diisi" });
    worksheet.addRow({ nama: "- SKU harus unik (tidak boleh sama)" });
    worksheet.addRow({ nama: "- Jumlah stok harus berupa angka" });
    worksheet.addRow({ nama: "- Harga dalam format angka (tanpa Rp atau .)" });
    worksheet.addRow({ nama: "- Hapus baris contoh dan petunjuk ini sebelum upload" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template-stok-barang.xlsx"'
    );

    return workbook.xlsx.write(res).then(() => {
      res.end();
    });
  } catch (err) {
    console.error("Error generating template:", err);
    req.flash("error", "Gagal membuat template");
    res.redirect("/stok/index");
  }
};

const tambahBarang = async (req, res) => {
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);
  
  try {
    const { nama, deskripsi, SKU, jumlah_stok, harga_beli, harga_jual, kategori_id } = req.body;
    
    // Enhanced validation
    if (!nama || !SKU || !jumlah_stok) {
      req.flash("error", "Nama, SKU, dan jumlah stok wajib diisi.");
      return res.redirect("/stok/tambah");
    }

    const parsedStok = parseInt(jumlah_stok);
    const parsedHargaBeli = parseFloat(harga_beli) || 0;
    const parsedHargaJual = parseFloat(harga_jual) || 0;

    if (isNaN(parsedStok) || parsedStok < 0) {
      req.flash("error", "Jumlah stok harus berupa angka positif.");
      return res.redirect("/stok/tambah");
    }

    if (parsedHargaBeli < 0 || parsedHargaJual < 0) {
      req.flash("error", "Harga tidak boleh negatif.");
      return res.redirect("/stok/tambah");
    }

    // Check duplicate SKU
    const [existingSKU] = await db.query("SELECT id FROM barangs WHERE SKU = ?", [SKU]);
    if (existingSKU.length > 0) {
      req.flash("error", `SKU ${SKU} sudah digunakan.`);
      return res.redirect("/stok/tambah");
    }

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      const now = new Date();
      const [result] = await db.query(
        `INSERT INTO barangs 
         (nama, deskripsi, SKU, jumlah_stok, harga_beli, harga_jual, kategori_id, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nama, deskripsi, SKU, parsedStok, parsedHargaBeli, parsedHargaJual, 
         kategori_id || null, now, now]
      );

      // Record initial stock
      await recordStockHistory(
        result.insertId,
        parsedStok,
        'masuk',
        req.session.user.id,
        `Stok awal barang: ${nama}`,
        'adjustment'
      );

      await db.query('COMMIT');

      await log(
        `Barang baru '${nama}' (SKU: ${SKU}) ditambahkan dengan stok ${parsedStok}`,
        LOG_LEVELS.INFO,
        req.session.user.id,
        userAgentData,
        ip
      );

      req.flash("success", "Berhasil menambahkan barang baru.");
      res.redirect("/stok/index");

    } catch (dbError) {
      await db.query('ROLLBACK');
      throw dbError;
    }

  } catch (error) {
    console.error("Error adding barang:", error);
    
    await log(
      `Gagal menambahkan barang: ${error.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );
    
    req.flash("error", "Gagal menambahkan barang.");
    res.redirect("/stok/tambah");
  }
};

const updateBarang = async (req, res) => {
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);
  
  try {
    const { id, nama, deskripsi, SKU, jumlah_stok, harga_beli, harga_jual, kategori_id } = req.body;
    
    // Validation
    if (!id || !nama || !SKU || !jumlah_stok) {
      req.flash("error", "ID, Nama, SKU, dan jumlah stok wajib diisi.");
      return res.redirect("/stok/index");
    }

    const parsedStok = parseInt(jumlah_stok);
    const parsedHargaBeli = parseFloat(harga_beli) || 0;
    const parsedHargaJual = parseFloat(harga_jual) || 0;

    if (isNaN(parsedStok) || parsedStok < 0) {
      req.flash("error", "Jumlah stok harus berupa angka positif.");
      return res.redirect("/stok/index");
    }

    // Get existing data
    const [existingRows] = await db.query(
      "SELECT nama, SKU, jumlah_stok FROM barangs WHERE id = ?", 
      [id]
    );
    
    if (existingRows.length === 0) {
      req.flash("error", "Barang tidak ditemukan!");
      return res.redirect("/stok/index");
    }
    
    const existing = existingRows[0];
    
    // Check duplicate SKU
    if (SKU !== existing.SKU) {
      const [duplicateSKU] = await db.query(
        "SELECT id FROM barangs WHERE SKU = ? AND id != ?", 
        [SKU, id]
      );
      if (duplicateSKU.length > 0) {
        req.flash("error", `SKU ${SKU} sudah digunakan.`);
        return res.redirect("/stok/index");
      }
    }

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      const now = new Date();
      await db.query(
        `UPDATE barangs 
         SET nama = ?, deskripsi = ?, SKU = ?, jumlah_stok = ?, 
             harga_beli = ?, harga_jual = ?, kategori_id = ?, updated_at = ? 
         WHERE id = ?`,
        [nama, deskripsi, SKU, parsedStok, parsedHargaBeli, parsedHargaJual, 
         kategori_id || null, now, id]
      );

      // Record stock adjustment if stock changed
      if (parsedStok !== existing.jumlah_stok) {
        const difference = parsedStok - existing.jumlah_stok;
        const tipe = difference > 0 ? 'masuk' : 'keluar';
        
        await recordStockHistory(
          id,
          Math.abs(difference),
          tipe,
          req.session.user.id,
          `Penyesuaian stok: ${existing.jumlah_stok} → ${parsedStok}`,
          'adjustment'
        );
      }

      await db.query('COMMIT');

      await log(
        `Barang '${existing.nama}' (ID: ${id}) diperbarui`,
        LOG_LEVELS.INFO,
        req.session.user.id,
        userAgentData,
        ip
      );

      req.flash("success", "Berhasil memperbarui barang.");
      res.redirect("/stok/index");

    } catch (dbError) {
      await db.query('ROLLBACK');
      throw dbError;
    }

  } catch (error) {
    console.error("Error updating barang:", error);
    
    await log(
      `Gagal memperbarui barang: ${error.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );
    
    req.flash("error", "Gagal memperbarui barang.");
    res.redirect("/stok/index");
  }
};

const deleteBarang = async (req, res) => {
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);
  
  try {
    const { id } = req.params;

    const [existingRows] = await db.query(
      "SELECT nama, jumlah_stok FROM barangs WHERE id = ?", 
      [id]
    );
    
    if (existingRows.length === 0) {
      req.flash("error", "Barang tidak ditemukan!");
      return res.redirect("/stok/index");
    }
    
    const existing = existingRows[0];

    // Check if item is used in transactions
    const [transactionCheck] = await db.query(
      "SELECT COUNT(*) as count FROM transaction_details WHERE barang_id = ?",
      [id]
    );

    if (transactionCheck[0].count > 0) {
      req.flash("error", "Barang tidak dapat dihapus karena sudah digunakan dalam transaksi.");
      return res.redirect("/stok/index");
    }

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      // Record final stock history
      if (existing.jumlah_stok > 0) {
        await recordStockHistory(
          id,
          existing.jumlah_stok,
          'keluar',
          req.session.user.id,
          `Barang dihapus: ${existing.nama}`,
          'adjustment'
        );
      }

      await db.query("DELETE FROM barangs WHERE id = ?", [id]);
      
      await db.query('COMMIT');

      await log(
        `Barang '${existing.nama}' (ID: ${id}) dihapus`,
        LOG_LEVELS.INFO,
        req.session.user.id,
        userAgentData,
        ip
      );

      req.flash("success", "Berhasil menghapus barang.");
      res.redirect("/stok/index");

    } catch (dbError) {
      await db.query('ROLLBACK');
      throw dbError;
    }

  } catch (error) {
    console.error("Error deleting barang:", error);
    
    await log(
      `Gagal menghapus barang: ${error.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );
    
    req.flash("error", "Gagal menghapus barang.");
    res.redirect("/stok/index");
  }
};

// New function to get stock history
const getStockHistory = async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT 
        sh.id,
        sh.jumlah,
        sh.tipe,
        sh.reference_type,
        sh.keterangan,
        sh.created_at,
        u.username as user_name,
        b.nama as barang_nama
      FROM stock_history sh
      LEFT JOIN users u ON sh.user_id = u.id
      LEFT JOIN barangs b ON sh.barang_id = b.id
      WHERE sh.barang_id = ?
      ORDER BY sh.created_at DESC
      LIMIT 50
    `;
    
    const [history] = await db.query(query, [id]);
    
    res.json({
      success: true,
      data: history
    });
    
  } catch (error) {
    console.error("Error fetching stock history:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil riwayat stok"
    });
  }
};

// Helper function for file cleanup
const cleanupFile = (filePath) => {
  fs.unlink(filePath, (err) => {
    if (err) console.error("Error deleting file:", err);
  });
};

module.exports = {
  getAllStok,
  tambahBarang,
  deleteBarang,
  updateBarang,
  downloadStok,
  uploadNewStok,
  downloadStokTemplate,
  getStockHistory,
};