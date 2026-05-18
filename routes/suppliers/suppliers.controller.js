const ExcelJS = require("exceljs");
const { db } = require("../../db/db");
const bcrypt = require("bcrypt");
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

const getAllSuppliers = async (req, res) => {
  try {
   const [supplierst] = await db.query("SELECT * FROM suppliers");
   res.render("pages/suppliers/index", { supplierst });
  } catch (error) {
   console.error("Error fetching all barang:", error);
   res.status(500).send("Internal Server Error");
  }
};

const deleteSuppliers = async (req, res) => {
  try {
    const { id } = req.params;

    const [[existingSupplier]] = await db.query("SELECT nama FROM suppliers WHERE id = ?", [id]);
    if (!existingSupplier) {
      return res.status(404).json({ message: "Supplier tidak ditemukan!" });
    }

    await db.query("DELETE FROM suppliers WHERE id = ?", [id]);

    const ip = getClientIP(req);
    const parser = new UAParser(req.headers["user-agent"]);
    const result = parser.getResult();

    const userAgentData = {
      deviceType: result.device.type || (result.device.vendor ? "Mobile" : "Desktop"),
      browser: `${result.browser.name} ${result.browser.version}`,
      platform: `${result.os.name} ${result.os.version}`,
    };

    await log(
      `Supplier dengan nama ${existingSupplier.nama} telah dihapus oleh ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", "Berhasil Hapus Supplier.");
    res.redirect("/suppliers/index");

  } catch (error) {
    console.error("Error Deleting Supplier:", error);

    const ip = getClientIP(req);
    const parser = new UAParser(req.headers["user-agent"]);
    const result = parser.getResult();

    const userAgentData = {
      deviceType: result.device.type || (result.device.vendor ? "Mobile" : "Desktop"),
      browser: `${result.browser.name} ${result.browser.version}`,
      platform: `${result.os.name} ${result.os.version}`,
    };

    await log(
      `${req.session.user.username} gagal menghapus supplier: ${error.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.status(500).send("Gagal Menghapus Supplier.");
  }
};

const updateSuppliers = async (req, res) => {
  const { id, nama, email, telepon, alamat } = req.body;

  try {
    const [[existingSupplier]] = await db.query("SELECT nama FROM suppliers WHERE id = ?", [id]);

    if (!existingSupplier) {
      req.flash("error", "Supplier tidak ditemukan!");
      return res.redirect("/suppliers/index");
    }

    await db.query(
      "UPDATE suppliers SET nama = ?, email = ?, telepon = ?, alamat = ? WHERE id = ?",
      [nama, email, telepon, alamat, id]
    );

    const ip = getClientIP(req);
    const parser = new UAParser(req.headers["user-agent"]);
    const result = parser.getResult();

    const userAgentData = {
      deviceType: result.device.type || (result.device.vendor ? "Mobile" : "Desktop"),
      browser: `${result.browser.name} ${result.browser.version}`,
      platform: `${result.os.name} ${result.os.version}`,
    };

    await log(
      `Supplier dengan ID ${id} (${existingSupplier.nama}) telah diperbarui oleh ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", "Berhasil Edit Supplier.");
    res.redirect("/suppliers/index");
  } catch (error) {
    console.error("Error Updating Supplier:", error);

    const ip = getClientIP(req);
    const parser = new UAParser(req.headers["user-agent"]);
    const result = parser.getResult();

    const userAgentData = {
      deviceType: result.device.type || (result.device.vendor ? "Mobile" : "Desktop"),
      browser: `${result.browser.name} ${result.browser.version}`,
      platform: `${result.os.name} ${result.os.version}`,
    };

    await log(
      `${req.session.user.username} gagal mengupdate supplier: ${error.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.status(500).send("Gagal Memperbarui Data Supplier.");
  }
};

const downloadSuppliers = async (req, res) => {
  try {
    const [suppliers] = await db.query("SELECT * FROM suppliers");

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data Suppliers");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Nama", key: "nama", width: 25 },
      { header: "Email", key: "email", width: 30 },
      { header: "Telepon", key: "telepon", width: 20 },
      { header: "Alamat", key: "alamat", width: 40 },
    ];

    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "000000" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "D9D9D9" },
      };
    });

    suppliers.forEach((supplier) => {
      worksheet.addRow(supplier);
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=data-suppliers.xlsx");

    await workbook.xlsx.write(res);

    const ip = getClientIP(req);
    const parser = new UAParser(req.headers["user-agent"]);
    const result = parser.getResult();

    const userAgentData = {
      deviceType: result.device.type || (result.device.vendor ? "Mobile" : "Desktop"),
      browser: `${result.browser.name} ${result.browser.version}`,
      platform: `${result.os.name} ${result.os.version}`,
    };

    await log(
      `${req.session.user.username} DOWNLOADED SUPPLIER data`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.end();

  } catch (error) {
    console.error("Error Generating Excel File:", error);
    res.status(500).send("Gagal Mendownload Data Supplier");
  }
};

const tambahSuppliers = async (req, res) => {
  try {
    const { nama, email, telepon, alamat } = req.body;

    if (!nama || !email || !telepon || !alamat) {
      req.flash("error", "Semua field wajib diisi.");
      return res.redirect("/suppliers/tambah");
    }

    await db.query(
      "INSERT INTO suppliers (nama, email, telepon, alamat) VALUES (?, ?, ?, ?)",
      [nama, email, telepon, alamat]
    );

    const ip = getClientIP(req);
    const parser = new UAParser(req.headers["user-agent"]);
    const result = parser.getResult();

    const userAgentData = {
      deviceType: result.device.type || (result.device.vendor ? "Mobile" : "Desktop"),
      browser: `${result.browser.name} ${result.browser.version}`,
      platform: `${result.os.name} ${result.os.version}`,
    };

    await log(
      `Supplier baru dengan nama ${nama} telah ditambahkan oleh ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", "Berhasil Tambah Supplier.");
    res.redirect("/suppliers/index");
  } catch (error) {
    console.error("Error Adding Supplier:", error);

    const ip = getClientIP(req);
    const parser = new UAParser(req.headers["user-agent"]);
    const result = parser.getResult();

    const userAgentData = {
      deviceType: result.device.type || (result.device.vendor ? "Mobile" : "Desktop"),
      browser: `${result.browser.name} ${result.browser.version}`,
      platform: `${result.os.name} ${result.os.version}`,
    };

    await log(
      `${req.session.user.username} gagal menambahkan supplier: ${error.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.status(500).send("Gagal Menambahkan Supplier.");
  }
};

const downloadSuppliersTemplate = async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Template Supplier");

    worksheet.columns = [
      { header: "Nama Supplier (Wajib)", key: "nama", width: 25 },
      { header: "Email (Wajib - Format Email)", key: "email", width: 30 },
      { header: "Telepon (Wajib)", key: "telepon", width: 20 },
      { header: "Alamat (Opsional)", key: "alamat", width: 40 },
    ];

    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "000000" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "D9D9D9" },
      };
    });

    worksheet.addRow({
      nama: "PT Contoh Supplier",
      email: "contoh@supplier.com",
      telepon: "08123456789",
      alamat: "Jl. Contoh No. 123, Jakarta",
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="SupplierTemplate.xlsx"'
    );

    await workbook.xlsx.write(res);

  } catch (err) {
    console.error("Error generating supplier template:", err);
    req.flash("error", "Gagal membuat template supplier");
    res.redirect("/suppliers/index");
  }
};

const uploadNewSuppliers = async (req, res) => {
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);

  if (!req.file) {
    req.flash("error", "File upload is required");
    return res.redirect("/suppliers/index");
  }

  const filePath = req.file.path;

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) {
      req.flash("error", "Invalid file format. Worksheet not found.");
      fs.unlink(filePath, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
      return res.redirect("/suppliers/index");
    }

    const suppliers = [];
    const duplicateEmails = [];

    worksheet.eachRow((row, rowNumber) => {
      const rowValues = row.values.filter(Boolean);
      if (rowNumber === 1) return;

      if (rowValues.length >= 3) {
        const [nama, email, telepon, alamat] = rowValues.map((value) => {
          if (value && typeof value === "object" && value.text) {
            return value.text;
          }
          return value;
        });

        if (nama && email) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (emailRegex.test(email)) {
            suppliers.push({
              nama,
              email,
              telepon: telepon || "",
              alamat: alamat || ""
            });
          }
        }
      }
    });

    if (suppliers.length === 0) {
      req.flash("error", "No valid supplier data found in the uploaded file.");
      fs.unlink(filePath, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
      return res.redirect("/suppliers/index");
    }

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    for (const supplier of suppliers) {
      const [existingSupplier] = await db.query(
        "SELECT id FROM suppliers WHERE email = ?",
        [supplier.email]
      );

      if (existingSupplier.length > 0) {
        duplicateEmails.push(supplier.email);
        continue;
      }

      await db.query(
        "INSERT INTO suppliers (nama, email, telepon, alamat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [supplier.nama, supplier.email, supplier.telepon, supplier.alamat, now, now]
      );

      await log(
        `Supplier ${supplier.nama} created by ${req.session.user.username}`,
        LOG_LEVELS.INFO,
        req.session.user.id,
        userAgentData,
        ip
      );
    }

    if (duplicateEmails.length > 0) {
      req.flash(
        "error",
        `Duplicate emails found: ${duplicateEmails.join(", ")}. Supplier creation skipped for these.`
      );
    } else {
      req.flash("success", "Data supplier baru sudah di-upload!");
    }

    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting file:", err);
    });

    return res.redirect("/suppliers/index");
  } catch (err) {
    await log(
      `Error creating suppliers from Excel: ${err.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("error", `An error occurred while processing the file: ${err.message}`);
    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting file:", err);
    });

    return res.redirect("/suppliers/index");
  }
};

module.exports = {
 getAllSuppliers,
 deleteSuppliers,
 updateSuppliers,
 downloadSuppliers,
 tambahSuppliers,
 downloadSuppliersTemplate,
 uploadNewSuppliers,
};