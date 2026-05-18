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

// Enhanced validation function
const validateCustomerData = (customer) => {
  const errors = [];
  
  // Validate nama (required, min 2 characters)
  if (!customer.nama || customer.nama.trim().length < 2) {
    errors.push("Nama harus diisi minimal 2 karakter");
  }
  
  // Validate email (required, valid format)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!customer.email || !emailRegex.test(customer.email)) {
    errors.push("Email tidak valid");
  }
  
  // Validate telepon (optional, but if provided must be valid)
  if (customer.telepon) {
    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    if (!phoneRegex.test(customer.telepon)) {
      errors.push("Format nomor telepon tidak valid");
    }
  }
  
  return errors;
};

const getAllCustomer = async (req, res) => {
  try {
    const [customers] = await db.query(`
      SELECT 
        c.id, 
        c.nama, 
        c.email, 
        c.telepon, 
        c.alamat, 
        c.created_at, 
        c.updated_at,
        COUNT(t.id) as total_transactions,
        COUNT(r.id) as total_returns
      FROM customers c
      LEFT JOIN transactions t ON c.id = t.customer_id
      LEFT JOIN retur r ON c.id = r.customer_id
      GROUP BY c.id, c.nama, c.email, c.telepon, c.alamat, c.created_at, c.updated_at
      ORDER BY c.created_at DESC
    `);
    res.render("pages/customer/index", { customers });
  } catch (error) {
    console.error("Error fetching all customer:", error);
    req.flash("error", "Gagal mengambil data customer");
    res.redirect("/dashboard");
  }
};

// Function to check if customer can be safely deleted
const checkCustomerDeletability = async (customerId) => {
  try {
    // Check for related transactions
    const [transactions] = await db.query(
      "SELECT COUNT(*) as count FROM transactions WHERE customer_id = ? AND status = 'selesai'",
      [customerId]
    );
    
    // Check for related returns
    const [returns] = await db.query(
      "SELECT COUNT(*) as count FROM retur WHERE customer_id = ?",
      [customerId]
    );
    
    return {
      canDelete: transactions[0].count === 0 && returns[0].count === 0,
      transactionCount: transactions[0].count,
      returnCount: returns[0].count
    };
  } catch (error) {
    throw new Error("Error checking customer deletability: " + error.message);
  }
};

// Enhanced delete function with proper FK handling
const deleteCustomer = async (req, res) => {
  const customerId = req.params.id;
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);
  const connection = await db.getConnection();

  try {
    // Start transaction
    await connection.beginTransaction();

    // Get customer info before deletion
    const [customerInfo] = await connection.query(
      "SELECT nama, email FROM customers WHERE id = ?",
      [customerId]
    );

    if (customerInfo.length === 0) {
      req.flash("error", "Customer tidak ditemukan");
      return res.redirect("/customer/index");
    }

    const customer = customerInfo[0];

    // Check deletability
    const deletabilityCheck = await checkCustomerDeletability(customerId);
    
    if (!deletabilityCheck.canDelete) {
      let message = "Customer tidak dapat dihapus karena masih memiliki ";
      const issues = [];
      
      if (deletabilityCheck.transactionCount > 0) {
        issues.push(`${deletabilityCheck.transactionCount} transaksi selesai`);
      }
      if (deletabilityCheck.returnCount > 0) {
        issues.push(`${deletabilityCheck.returnCount} retur`);
      }
      
      message += issues.join(" dan ");
      req.flash("error", message);
      await connection.rollback();
      return res.redirect("/customer/index");
    }

    // If we reach here, customer can be safely deleted
    // The database constraints will handle FK relationships:
    // - transactions.customer_id will be set to NULL (ON DELETE SET NULL)
    // - retur records should be handled carefully

    // First, update any pending transactions to set customer_id to NULL
    await connection.query(
      "UPDATE transactions SET customer_id = NULL WHERE customer_id = ? AND status = 'pending'",
      [customerId]
    );

    // Handle retur records - update to set customer_id to NULL
    await connection.query(
      "UPDATE retur SET customer_id = NULL WHERE customer_id = ?",
      [customerId]
    );

    // Now safely delete the customer
    await connection.query("DELETE FROM customers WHERE id = ?", [customerId]);

    await connection.commit();

    // Log the deletion
    await log(
      `Customer ${customer.nama} (${customer.email}) deleted by ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", `Customer ${customer.nama} berhasil dihapus`);
    
  } catch (error) {
    await connection.rollback();
    console.error("Error deleting customer:", error);
    
    await log(
      `Error deleting customer ID ${customerId}: ${error.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("error", "Gagal menghapus customer: " + error.message);
  } finally {
    connection.release();
  }

  res.redirect("/customer/index");
};

// Soft delete alternative (recommended for business data)
const softDeleteCustomer = async (req, res) => {
  const customerId = req.params.id;
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);

  try {
    // Get customer info
    const [customerInfo] = await db.query(
      "SELECT nama, email FROM customers WHERE id = ?",
      [customerId]
    );

    if (customerInfo.length === 0) {
      req.flash("error", "Customer tidak ditemukan");
      return res.redirect("/customer/index");
    }

    const customer = customerInfo[0];

    // Add deleted_at column if not exists (you need to add this to your schema)
    // ALTER TABLE customers ADD COLUMN deleted_at TIMESTAMP NULL;
    
    await db.query(
      "UPDATE customers SET deleted_at = NOW() WHERE id = ?",
      [customerId]
    );

    await log(
      `Customer ${customer.nama} (${customer.email}) soft deleted by ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", `Customer ${customer.nama} berhasil dinonaktifkan`);
    
  } catch (error) {
    console.error("Error soft deleting customer:", error);
    req.flash("error", "Gagal menonaktifkan customer");
  }

  res.redirect("/customer/index");
};

// Update customer function
const updateCustomer = async (req, res) => {
  const customerId = req.params.id;
  const { nama, email, telepon, alamat } = req.body;
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);

  try {
    const customer = { nama, email, telepon, alamat };
    const errors = validateCustomerData(customer);
    
    if (errors.length > 0) {
      req.flash("error", errors.join(", "));
      return res.redirect("/customer/index");
    }

    // Check if email already exists for other customers
    const [existingCustomer] = await db.query(
      "SELECT id FROM customers WHERE email = ? AND id != ?",
      [email, customerId]
    );
    
    if (existingCustomer.length > 0) {
      req.flash("error", "Email sudah digunakan customer lain");
      return res.redirect("/customer/index");
    }

    await db.query(
      "UPDATE customers SET nama = ?, email = ?, telepon = ?, alamat = ?, updated_at = NOW() WHERE id = ?",
      [nama, email, telepon || "", alamat || "", customerId]
    );

    await log(
      `Customer ID ${customerId} updated by ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", "Customer berhasil diupdate");
    res.redirect("/customer/index");
    
  } catch (error) {
    console.error("Error updating customer:", error);
    req.flash("error", "Gagal mengupdate customer");
    res.redirect("/customer/index");
  }
};

const uploadNewCustomer = async (req, res) => {
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);

  if (!req.file) {
    req.flash("error", "File upload diperlukan");
    return res.redirect("/customer/index");
  }

  const filePath = req.file.path;
  const connection = await db.getConnection();

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) {
      req.flash("error", "Format file tidak valid. Worksheet tidak ditemukan.");
      fs.unlink(filePath, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
      return res.redirect("/customer/index");
    }

    const customers = [];
    const validationErrors = [];
    const duplicateEmails = [];

    // Parse Excel data
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header row

      const rowValues = row.values.slice(1); // Remove first empty element
      
      if (rowValues.length >= 2) { // At least nama and email
        const [nama, email, telepon, alamat] = rowValues.map((value) => {
          if (value && typeof value === "object" && value.text) {
            return value.text.toString().trim();
          }
          return value ? value.toString().trim() : "";
        });

        const customer = { nama, email, telepon, alamat };
        const errors = validateCustomerData(customer);
        
        if (errors.length > 0) {
          validationErrors.push(`Baris ${rowNumber}: ${errors.join(", ")}`);
        } else {
          customers.push(customer);
        }
      }
    });

    if (customers.length === 0) {
      req.flash("error", "Tidak ada data valid yang ditemukan dalam file.");
      fs.unlink(filePath, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
      return res.redirect("/customer/index");
    }

    // Check for duplicate emails in database (batch check)
    const emails = customers.map(c => c.email);
    const [existingEmails] = await db.query(
      `SELECT email FROM customers WHERE email IN (${emails.map(() => '?').join(',')})`,
      emails
    );
    
    const existingEmailSet = new Set(existingEmails.map(row => row.email));
    const validCustomers = customers.filter(customer => {
      if (existingEmailSet.has(customer.email)) {
        duplicateEmails.push(customer.email);
        return false;
      }
      return true;
    });

    if (validCustomers.length === 0) {
      req.flash("error", "Semua email sudah ada dalam database.");
      fs.unlink(filePath, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
      return res.redirect("/customer/index");
    }

    // Start transaction
    await connection.beginTransaction();

    try {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      
      // Batch insert
      const insertQuery = `
        INSERT INTO customers (nama, email, telepon, alamat, created_at, updated_at) 
        VALUES ?
      `;
      
      const values = validCustomers.map(customer => [
        customer.nama,
        customer.email,
        customer.telepon,
        customer.alamat,
        now,
        now
      ]);

      await connection.query(insertQuery, [values]);
      await connection.commit();

      // Log successful upload
      await log(
        `${validCustomers.length} customers uploaded by ${req.session.user.username}`,
        LOG_LEVELS.INFO,
        req.session.user.id,
        userAgentData,
        ip
      );

      let message = `Berhasil mengupload ${validCustomers.length} customer baru!`;
      
      if (duplicateEmails.length > 0) {
        message += ` ${duplicateEmails.length} email duplikat dilewati.`;
      }
      
      if (validationErrors.length > 0) {
        message += ` ${validationErrors.length} baris dengan error dilewati.`;
      }

      req.flash("success", message);

    } catch (insertError) {
      await connection.rollback();
      throw insertError;
    }

  } catch (err) {
    await log(
      `Error uploading customers: ${err.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );
    req.flash("error", `Terjadi kesalahan: ${err.message}`);
  } finally {
    connection.release();
    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting file:", err);
    });
  }

  return res.redirect("/customer/index");
};

const downloadCustomerTemplate = async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Template Customer");

    // Setup columns with better descriptions
    worksheet.columns = [
      { header: "Nama Customer*", key: "nama", width: 25 },
      { header: "Email*", key: "email", width: 30 },
      { header: "No. Telepon", key: "telepon", width: 20 },
      { header: "Alamat", key: "alamat", width: 40 },
    ];

    // Style header
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "366092" },
      };
      cell.alignment = { horizontal: "center" };
    });

    // Add example data
    worksheet.addRows([
      {
        nama: "Fahreza Rizky Pradana",
        email: "fahreza@gmail.com",
        telepon: "089520124809",
        alamat: "Jl. Wuluhan No. 123, Jember"
      },
      {
        nama: "Andi Pratama",
        email: "andi@email.com",
        telepon: "081234567890",
        alamat: "Jl. Merdeka No. 10"
      }
    ]);

    // Add instructions worksheet
    const instructionSheet = workbook.addWorksheet("Petunjuk");
    instructionSheet.columns = [
      { header: "Kolom", key: "column", width: 20 },
      { header: "Keterangan", key: "description", width: 50 },
    ];

    instructionSheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "D9D9D9" },
      };
    });

    instructionSheet.addRows([
      { column: "Nama Customer*", description: "Wajib diisi, minimal 2 karakter" },
      { column: "Email*", description: "Wajib diisi, format email yang valid, tidak boleh duplikat" },
      { column: "No. Telepon", description: "Opsional, hanya angka, spasi, tanda +, -, (, )" },
      { column: "Alamat", description: "Opsional, alamat lengkap customer" },
    ]);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template_customer.xlsx"'
    );

    return workbook.xlsx.write(res).then(() => {
      res.end();
    });
  } catch (err) {
    console.error("Error generating customer template:", err);
    req.flash("error", "Gagal membuat template customer");
    res.redirect("/customer/index");
  }
};

const downloadCustomerData = async (req, res) => {
  try {
    const [customers] = await db.query(`
      SELECT 
        id, 
        nama, 
        email, 
        telepon, 
        alamat,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as tanggal_dibuat,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') as tanggal_diupdate
      FROM customers
      WHERE deleted_at IS NULL
      ORDER BY id ASC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data Customer");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Nama", key: "nama", width: 30 },
      { header: "Email", key: "email", width: 30 },
      { header: "Telepon", key: "telepon", width: 20 },
      { header: "Alamat", key: "alamat", width: 40 },
      { header: "Tanggal Dibuat", key: "tanggal_dibuat", width: 20 },
      { header: "Tanggal Diupdate", key: "tanggal_diupdate", width: 20 },
    ];

    // Style header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "366092" },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFF" } };

    // Add data
    worksheet.addRows(customers);

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      if (column.eachCell) {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const columnLength = cell.value ? cell.value.toString().length : 10;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = maxLength < 10 ? 10 : maxLength + 2;
      }
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="data_customer_${new Date().toISOString().split('T')[0]}.xlsx"`
    );

    await workbook.xlsx.write(res);

    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    await log(
      `Customer data downloaded by ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.end();
  } catch (error) {
    console.error("Error downloading customer data:", error);
    res.status(500).send("Internal Server Error");
  }
};

// Additional function for single customer creation
const createSingleCustomer = async (req, res) => {
  const { nama, email, telepon, alamat } = req.body;
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);

  try {
    const customer = { nama, email, telepon, alamat };
    const errors = validateCustomerData(customer);
    
    if (errors.length > 0) {
      req.flash("error", errors.join(", "));
      return res.redirect("/customer/index");
    }

    // Check if email already exists
    const [existingCustomer] = await db.query(
      "SELECT id FROM customers WHERE email = ?",
      [email]
    );
    
    if (existingCustomer.length > 0) {
      req.flash("error", "Email sudah terdaftar");
      return res.redirect("/customer/index");
    }

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    
    await db.query(
      "INSERT INTO customers (nama, email, telepon, alamat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [nama, email, telepon || "", alamat || "", now, now]
    );

    await log(
      `Customer ${nama} created by ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", "Customer berhasil ditambahkan");
    res.redirect("/customer/index");
  } catch (error) {
    console.error("Error creating customer:", error);
    req.flash("error", "Gagal menambahkan customer");
    res.redirect("/customer/index");
  }
};

module.exports = {
  getAllCustomer,
  uploadNewCustomer,
  downloadCustomerTemplate,
  downloadCustomerData,
  createSingleCustomer,
  deleteCustomer,
  softDeleteCustomer,
  updateCustomer,
  checkCustomerDeletability
};