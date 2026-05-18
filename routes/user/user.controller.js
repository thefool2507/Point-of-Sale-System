const Excel = require("exceljs");
const { db } = require("../../db/db");
const bcrypt = require("bcrypt");
const { log, LOG_LEVELS } = require("../../helpers/log");
const UAParser = require("ua-parser-js");
const { getClientIP } = require("../../helpers/getClientIP");
const fs = require("fs");
const path = require("path");

// Validation helpers
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validateRole = (role) => {
  const validRoles = ['Admin', 'Manager', 'User'];
  return validRoles.includes(role);
};

const validateUsername = (username) => {
  return username && username.trim().length >= 3 && username.trim().length <= 50;
};

// Get user agent data helper
const getUserAgentData = (req) => {
  const parser = new UAParser(req.headers["user-agent"]);
  const result = parser.getResult();
  return {
    deviceType: result.device.type || (result.device.vendor ? "Mobile" : "Desktop"),
    browser: `${result.browser.name || 'Unknown'} ${result.browser.version || ''}`.trim(),
    platform: `${result.os.name || 'Unknown'} ${result.os.version || ''}`.trim(),
  };
};

// Get default password by role
const getDefaultPassword = (role) => {
  const passwords = {
    'Admin': 'Admin12345.',
    'Manager': 'Manager1234.',
    'User': 'User12345.'
  };
  return passwords[role] || 'User12345.';
};

const getUserOverviewPage = async (req, res) => {
  try {
    // Get total users
    const [totalUsers] = await db.query("SELECT COUNT(*) as total FROM users");

    // Get count of users by role
    const [roleStats] = await db.query(`
      SELECT role, COUNT(*) as count 
      FROM users 
      GROUP BY role
      ORDER BY role
    `);

    // Get recent user activities (last 10)
    const [recentUsers] = await db.query(`
      SELECT username, email, role, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    res.render("pages/user/overview", {
      totalUsers: totalUsers[0].total,
      roleStats,
      recentUsers
    });
  } catch (error) {
    console.error("Error fetching user statistics:", error);
    req.flash("error", "Gagal memuat statistik pengguna");
    res.status(500).render("pages/error", { 
      message: "Internal Server Error",
      error: process.env.NODE_ENV === 'development' ? error : {}
    });
  }
};

const getAllUsersPage = async (req, res) => {
  try {
    // Add pagination and search functionality
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const roleFilter = req.query.role || '';
    const offset = (page - 1) * limit;

    let query = `
      SELECT id, username, email, role, created_at, updated_at 
      FROM users 
      WHERE 1=1
    `;
    let countQuery = "SELECT COUNT(*) as total FROM users WHERE 1=1";
    const queryParams = [];
    const countParams = [];

    // Add search filter
    if (search) {
      query += " AND (username LIKE ? OR email LIKE ?)";
      countQuery += " AND (username LIKE ? OR email LIKE ?)";
      queryParams.push(`%${search}%`, `%${search}%`);
      countParams.push(`%${search}%`, `%${search}%`);
    }

    // Add role filter
    if (roleFilter) {
      query += " AND role = ?";
      countQuery += " AND role = ?";
      queryParams.push(roleFilter);
      countParams.push(roleFilter);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    queryParams.push(limit, offset);

    const [users] = await db.query(query, queryParams);
    const [totalCount] = await db.query(countQuery, countParams);
    
    const totalPages = Math.ceil(totalCount[0].total / limit);

    res.render("pages/user/index", { 
      users,
      currentPage: page,
      totalPages,
      totalUsers: totalCount[0].total,
      search,
      roleFilter,
      limit
    });
  } catch (error) {
    console.error("Error fetching all users:", error);
    req.flash("error", "Gagal memuat daftar pengguna");
    res.status(500).render("pages/error", { 
      message: "Internal Server Error",
      error: process.env.NODE_ENV === 'development' ? error : {}
    });
  }
};

const downloadUserData = async (req, res) => {
  try {
    // Query database untuk mendapatkan semua user dengan informasi lengkap
    const [users] = await db.query(`
      SELECT 
        id, 
        username, 
        email, 
        role,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') as updated_at
      FROM users
      ORDER BY id
    `);

    // Buat workbook dan worksheet baru
    const workbook = new Excel.Workbook();
    const worksheet = workbook.addWorksheet("Users");

    // Definisikan kolom dengan lebih detail
    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Username", key: "username", width: 25 },
      { header: "Email", key: "email", width: 35 },
      { header: "Role", key: "role", width: 15 },
      { header: "Created At", key: "created_at", width: 20 },
      { header: "Updated At", key: "updated_at", width: 20 },
    ];

    // Style untuk header
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: 'FF4F81BD' },
    };
    headerRow.alignment = { horizontal: 'center' };

    // Tambahkan data
    users.forEach(user => {
      worksheet.addRow(user);
    });

    // Style untuk data rows
    for (let i = 2; i <= users.length + 1; i++) {
      const row = worksheet.getRow(i);
      if (i % 2 === 0) {
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: 'FFF2F2F2' },
        };
      }
    }

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      column.alignment = { horizontal: 'left' };
    });

    // Set response header
    const filename = `users-data-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${filename}`
    );

    await workbook.xlsx.write(res);

    // Log activity
    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    await log(
      `${req.session.user.username} downloaded user data (${users.length} records)`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.end();
  } catch (error) {
    console.error("Error downloading user data:", error);
    req.flash("error", "Gagal mengunduh data pengguna");
    res.status(500).send("Internal Server Error");
  }
};

const uploadNewUser = async (req, res) => {
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);

  if (!req.file) {
    req.flash("error", "File upload diperlukan");
    return res.redirect("/user/index");
  }

  const filePath = req.file.path;

  try {
    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) {
      req.flash("error", "Format file tidak valid. Worksheet tidak ditemukan.");
      fs.unlink(filePath, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
      return res.redirect("/user/index");
    }

    const users = [];
    const errors = [];
    let rowNumber = 0;

    worksheet.eachRow((row, currentRowNumber) => {
      rowNumber = currentRowNumber;
      
      // Skip header row
      if (rowNumber === 1) return;

      const rowValues = row.values.slice(1); // Remove first empty element
      
      if (rowValues.length >= 4) {
        const [username, email, role, password] = rowValues.map((value) => {
          if (value && typeof value === "object" && value.text) {
            return value.text.toString().trim();
          }
          return value ? value.toString().trim() : '';
        });

        // Validate data
        const rowErrors = [];
        
        if (!validateUsername(username)) {
          rowErrors.push(`Username tidak valid (minimal 3 karakter, maksimal 50 karakter)`);
        }
        
        if (!validateEmail(email)) {
          rowErrors.push(`Email tidak valid`);
        }
        
        if (!validateRole(role)) {
          rowErrors.push(`Role tidak valid (harus: Admin, Manager, atau User)`);
        }
        
        if (!password || password.length < 6) {
          rowErrors.push(`Password tidak valid (minimal 6 karakter)`);
        }

        if (rowErrors.length > 0) {
          errors.push(`Baris ${rowNumber}: ${rowErrors.join(', ')}`);
        } else {
          users.push({
            username,
            email,
            role,
            password,
            rowNumber
          });
        }
      } else {
        errors.push(`Baris ${rowNumber}: Data tidak lengkap`);
      }
    });

    if (errors.length > 0) {
      req.flash("error", `Kesalahan validasi:<br>${errors.join('<br>')}`);
      fs.unlink(filePath, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
      return res.redirect("/user/index");
    }

    if (users.length === 0) {
      req.flash("error", "Tidak ada data valid yang ditemukan dalam file.");
      fs.unlink(filePath, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
      return res.redirect("/user/index");
    }

    const duplicateEmails = [];
    const successfulInserts = [];
    const failedInserts = [];

    // Process each user
    for (const user of users) {
      try {
        // Check for duplicate email
        const [existingUser] = await db.query(
          "SELECT id FROM users WHERE email = ?",
          [user.email]
        );
        
        if (existingUser.length > 0) {
          duplicateEmails.push(`${user.email} (baris ${user.rowNumber})`);
          continue;
        }

        // Check for duplicate username
        const [existingUsername] = await db.query(
          "SELECT id FROM users WHERE username = ?",
          [user.username]
        );
        
        if (existingUsername.length > 0) {
          failedInserts.push(`Username ${user.username} sudah ada (baris ${user.rowNumber})`);
          continue;
        }

        const hashedPassword = await bcrypt.hash(user.password, 12); // Increased salt rounds
        
        await db.query(
          "INSERT INTO users (username, email, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())",
          [user.username, user.email, user.role, hashedPassword]
        );

        successfulInserts.push(user.username);

        await log(
          `User ${user.username} (${user.role}) created via Excel upload by ${req.session.user.username}`,
          LOG_LEVELS.INFO,
          req.session.user.id,
          userAgentData,
          ip
        );
      } catch (insertError) {
        console.error(`Error inserting user ${user.username}:`, insertError);
        failedInserts.push(`${user.username}: ${insertError.message}`);
      }
    }

    // Generate flash messages
    const messages = [];
    if (successfulInserts.length > 0) {
      messages.push(`${successfulInserts.length} pengguna berhasil ditambahkan: ${successfulInserts.join(', ')}`);
    }
    
    if (duplicateEmails.length > 0) {
      messages.push(`Email duplikat ditemukan: ${duplicateEmails.join(', ')}`);
    }
    
    if (failedInserts.length > 0) {
      messages.push(`Gagal menambahkan: ${failedInserts.join(', ')}`);
    }

    if (successfulInserts.length > 0) {
      req.flash("success", messages.join('<br>'));
    } else {
      req.flash("error", messages.join('<br>'));
    }

    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting file:", err);
    });
    
    return res.redirect("/user/index");
    
  } catch (err) {
    console.error("Error processing Excel file:", err);
    
    await log(
      `Error creating users from Excel: ${err.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );
    
    req.flash("error", `Terjadi kesalahan saat memproses file: ${err.message}`);
    
    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting file:", err);
    });
    
    return res.redirect("/user/index");
  }
};

const createNewUser = async (req, res) => {
  const { username, email, role } = req.body;
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);

  try {
    // Validation
    if (!validateUsername(username)) {
      req.flash("error", "Username tidak valid (minimal 3 karakter, maksimal 50 karakter)");
      return res.redirect("/user/index");
    }

    if (!validateEmail(email)) {
      req.flash("error", "Format email tidak valid");
      return res.redirect("/user/index");
    }

    if (!validateRole(role)) {
      req.flash("error", "Role tidak valid");
      return res.redirect("/user/index");
    }

    // Check for duplicate email
    const [existingEmail] = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existingEmail.length > 0) {
      await log(
        `Failed to create user with email ${email} - email already exists by: ${req.session.user.username}`,
        LOG_LEVELS.WARN,
        req.session.user.id,
        userAgentData,
        ip
      );
      req.flash("error", "Email sudah terdaftar!");
      return res.redirect("/user/index");
    }

    // Check for duplicate username
    const [existingUsername] = await db.query(
      "SELECT id FROM users WHERE username = ?",
      [username]
    );

    if (existingUsername.length > 0) {
      await log(
        `Failed to create user with username ${username} - username already exists by: ${req.session.user.username}`,
        LOG_LEVELS.WARN,
        req.session.user.id,
        userAgentData,
        ip
      );
      req.flash("error", "Username sudah terdaftar!");
      return res.redirect("/user/index");
    }

    const password = getDefaultPassword(role);
    const hashedPassword = await bcrypt.hash(password, 12);

    await db.query(
      "INSERT INTO users (username, email, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())",
      [username, email, role, hashedPassword]
    );

    await log(
      `New user created: ${username} (${role}) by ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", `Pengguna berhasil dibuat! Password default: ${password}`);
    res.redirect("/user/index");
    
  } catch (err) {
    console.error("Error creating user:", err);
    
    await log(
      `${req.session.user.username} failed to create user ${username}: ${err.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );
    
    req.flash("error", "Terjadi kesalahan saat membuat pengguna");
    res.redirect("/user/index");
  }
};

const downloadUserTemplate = (req, res) => {
  try {
    const filePath = path.join(__dirname, "../../templates/data/user.xlsx");

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      req.flash("error", "Template file tidak ditemukan");
      return res.redirect("/user/index");
    }

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="user_template.xlsx"'
    );

    res.sendFile(filePath);
  } catch (err) {
    console.error("Error downloading user template:", err);
    req.flash("error", "Gagal mengunduh template");
    res.status(500).redirect("/user/index");
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: "ID pengguna tidak valid" });
    }

    const [user] = await db.query(
      "SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?", 
      [id]
    );
    
    if (user.length === 0) {
      return res.status(404).json({ error: "Pengguna tidak ditemukan" });
    }    
    
    res.json(user[0]);
  } catch (error) {
    console.error("Error fetching user by ID:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const updateUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role } = req.body;
    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    // Validation
    if (!id || isNaN(id)) {
      req.flash("error", "ID pengguna tidak valid");
      return res.redirect("/user/index");
    }

    if (!validateUsername(username)) {
      req.flash("error", "Username tidak valid (minimal 3 karakter, maksimal 50 karakter)");
      return res.redirect("/user/index");
    }

    if (!validateEmail(email)) {
      req.flash("error", "Format email tidak valid");
      return res.redirect("/user/index");
    }

    if (!validateRole(role)) {
      req.flash("error", "Role tidak valid");
      return res.redirect("/user/index");
    }

    // Check if user exists
    const [existingUser] = await db.query("SELECT username FROM users WHERE id = ?", [id]);
    if (existingUser.length === 0) {
      req.flash("error", "Pengguna tidak ditemukan");
      return res.redirect("/user/index");
    }

    // Check for duplicate email (excluding current user)
    const [duplicateEmail] = await db.query(
      "SELECT id FROM users WHERE email = ? AND id != ?", 
      [email, id]
    );
    if (duplicateEmail.length > 0) {
      req.flash("error", "Email sudah digunakan oleh pengguna lain");
      return res.redirect("/user/index");
    }

    // Check for duplicate username (excluding current user)
    const [duplicateUsername] = await db.query(
      "SELECT id FROM users WHERE username = ? AND id != ?", 
      [username, id]
    );
    if (duplicateUsername.length > 0) {
      req.flash("error", "Username sudah digunakan oleh pengguna lain");
      return res.redirect("/user/index");
    }

    // Update user data
    await db.query(
      "UPDATE users SET username = ?, email = ?, role = ?, updated_at = NOW() WHERE id = ?", 
      [username, email, role, id]
    );

    await log(
      `User ID ${id} (${existingUser[0].username}) updated to ${username} (${role}) by ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", "Pengguna berhasil diperbarui!");
    res.redirect("/user/index");

  } catch (error) {
    console.error("Error updating user:", error);
    req.flash("error", "Terjadi kesalahan saat memperbarui pengguna");
    res.redirect("/user/index");
  }
};

const deleteUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    // Validation
    if (!id || isNaN(id)) {
      req.flash("error", "ID pengguna tidak valid");
      return res.redirect("/user/index");
    }

    // Prevent self-deletion
    if (parseInt(id) === req.session.user.id) {
      req.flash("error", "Anda tidak dapat menghapus akun sendiri");
      return res.redirect("/user/index");
    }

    // Check if user exists
    const [existingUser] = await db.query("SELECT username FROM users WHERE id = ?", [id]);
    if (existingUser.length === 0) {
      req.flash("error", "Pengguna tidak ditemukan");
      return res.redirect("/user/index");
    }

    // Check if user has related transactions (prevent deletion if has transactions)
    const [userTransactions] = await db.query(
      "SELECT COUNT(*) as count FROM transactions WHERE user_id = ?", 
      [id]
    );
    
    if (userTransactions[0].count > 0) {
      req.flash("error", "Tidak dapat menghapus pengguna yang memiliki riwayat transaksi");
      return res.redirect("/user/index");
    }

    // Delete user from database
    await db.query("DELETE FROM users WHERE id = ?", [id]);

    await log(
      `User ${existingUser[0].username} (ID: ${id}) deleted by ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", "Pengguna berhasil dihapus!");
    res.redirect("/user/index");

  } catch (error) {
    console.error("Error deleting user:", error);
    req.flash("error", "Terjadi kesalahan saat menghapus pengguna");
    res.redirect("/user/index");
  }
};

// New function to reset user password
const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    if (!id || isNaN(id)) {
      req.flash("error", "ID pengguna tidak valid");
      return res.redirect("/user/index");
    }

    const [user] = await db.query("SELECT username, role FROM users WHERE id = ?", [id]);
    if (user.length === 0) {
      req.flash("error", "Pengguna tidak ditemukan");
      return res.redirect("/user/index");
    }

    const newPassword = getDefaultPassword(user[0].role);
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await db.query(
      "UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?",
      [hashedPassword, id]
    );

    await log(
      `Password reset for user ${user[0].username} (ID: ${id}) by ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", `Password berhasil direset! Password baru: ${newPassword}`);
    res.redirect("/user/index");

  } catch (error) {
    console.error("Error resetting password:", error);
    req.flash("error", "Terjadi kesalahan saat mereset password");
    res.redirect("/user/index");
  }
};

module.exports = {
  getAllUsersPage,
  getUserOverviewPage,
  downloadUserData,
  downloadUserTemplate,
  uploadNewUser,
  createNewUser,
  getUserById,
  updateUserById,
  deleteUserById,
  resetUserPassword, // New function
};