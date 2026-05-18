const ExcelJS = require("exceljs");
const { db } = require("../../db/db");
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

const getAllKategoriProduk = async (req, res) => {
  try {
    const [kategoriList] = await db.query("SELECT * FROM kategori_produk");
    res.render("pages/kategori-produk/index", { kategoriList });
  } catch (error) {
    console.error("Error fetching kategori produk:", error);
    res.status(500).send("Internal Server Error");
  }
};

const deleteKategoriProduk = async (req, res) => {
  try {
    const { id } = req.params;

    const [[existingKategori]] = await db.query("SELECT nama FROM kategori_produk WHERE id = ?", [id]);
    if (!existingKategori) {
      return res.status(404).json({ message: "Kategori tidak ditemukan!" });
    }

    await db.query("DELETE FROM kategori_produk WHERE id = ?", [id]);

    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    await log(
      `Kategori Produk dengan nama ${existingKategori.nama} telah dihapus oleh ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", "Berhasil Hapus Kategori Produk.");
    res.redirect("/kategori-produk/index");
  } catch (error) {
    console.error("Error Deleting Kategori:", error);

    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    await log(
      `${req.session.user.username} gagal menghapus kategori: ${error.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.status(500).send("Gagal Menghapus Kategori Produk.");
  }
};

const updateKategoriProduk = async (req, res) => {
  const { id, nama, deskripsi } = req.body;

  try {
    const [[existingKategori]] = await db.query("SELECT nama FROM kategori_produk WHERE id = ?", [id]);

    if (!existingKategori) {
      req.flash("error", "Kategori tidak ditemukan!");
      return res.redirect("/kategori-produk/index");
    }

    await db.query(
      "UPDATE kategori_produk SET nama = ?, deskripsi = ?, updated_at = NOW() WHERE id = ?",
      [nama, deskripsi, id]
    );

    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    await log(
      `Kategori dengan ID ${id} (${existingKategori.nama}) telah diperbarui oleh ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", "Berhasil Edit Kategori Produk.");
    res.redirect("/kategori-produk/index");
  } catch (error) {
    console.error("Error Updating Kategori:", error);

    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    await log(
      `${req.session.user.username} gagal mengupdate kategori: ${error.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.status(500).send("Gagal Memperbarui Data Kategori Produk.");
  }
};

const downloadKategoriProduk = async (req, res) => {
  try {
    const [kategori] = await db.query("SELECT * FROM kategori_produk");

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data Kategori Produk");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Nama", key: "nama", width: 25 },
      { header: "Deskripsi", key: "deskripsi", width: 40 },
      { header: "Created At", key: "created_at", width: 20 },
      { header: "Updated At", key: "updated_at", width: 20 },
    ];

    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "000000" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "D9D9D9" },
      };
    });

    kategori.forEach((item) => {
      worksheet.addRow(item);
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=data-kategori-produk.xlsx");

    await workbook.xlsx.write(res);

    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    await log(
      `${req.session.user.username} DOWNLOADED KATEGORI PRODUK data`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.end();
  } catch (error) {
    console.error("Error Generating Excel File:", error);
    res.status(500).send("Gagal Mendownload Data Kategori Produk");
  }
};

const tambahKategoriProduk = async (req, res) => {
  try {
    const { nama, deskripsi } = req.body;

    if (!nama || !deskripsi) {
      req.flash("error", "Semua field wajib diisi.");
      return res.redirect("/kategori-produk/tambah");
    }

    await db.query(
      "INSERT INTO kategori_produk (nama, deskripsi, created_at, updated_at) VALUES (?, ?, NOW(), NOW())",
      [nama, deskripsi]
    );

    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    await log(
      `Kategori Produk baru dengan nama ${nama} telah ditambahkan oleh ${req.session.user.username}`,
      LOG_LEVELS.INFO,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("success", "Berhasil Tambah Kategori Produk.");
    res.redirect("/kategori-produk/index");
  } catch (error) {
    console.error("Error Adding Kategori:", error);

    const ip = getClientIP(req);
    const userAgentData = getUserAgentData(req);

    await log(
      `${req.session.user.username} gagal menambahkan kategori: ${error.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );

    res.status(500).send("Gagal Menambahkan Kategori Produk.");
  }
};

const downloadKategoriProdukTemplate = async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Template Kategori Produk");

    worksheet.columns = [
      { header: "Nama Kategori (Wajib)", key: "nama", width: 25 },
      { header: "Deskripsi (Opsional)", key: "deskripsi", width: 40 },
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
      nama: "Contoh Kategori",
      deskripsi: "Deskripsi Contoh",
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="KategoriProdukTemplate.xlsx"');

    await workbook.xlsx.write(res);
  } catch (err) {
    console.error("Error generating kategori produk template:", err);
    req.flash("error", "Gagal membuat template kategori produk");
    res.redirect("/kategori-produk/index");
  }
};

const uploadNewKategoriProduk = async (req, res) => {
  const ip = getClientIP(req);
  const userAgentData = getUserAgentData(req);

  if (!req.file) {
    req.flash("error", "File upload is required");
    return res.redirect("/kategori-produk/index");
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
      return res.redirect("/kategori-produk/index");
    }

    const kategoriList = [];

    worksheet.eachRow((row, rowNumber) => {
      const rowValues = row.values.filter(Boolean);
      if (rowNumber === 1) return;

      if (rowValues.length >= 1) {
        const [nama, deskripsi] = rowValues.map((value) => {
          if (value && typeof value === "object" && value.text) {
            return value.text;
          }
          return value;
        });

        if (nama) {
          kategoriList.push({
            nama,
            deskripsi: deskripsi || "",
          });
        }
      }
    });

    if (kategoriList.length === 0) {
      req.flash("error", "No valid kategori data found in the uploaded file.");
      fs.unlink(filePath, (err) => {
        if (err) console.error("Error deleting file:", err);
      });
      return res.redirect("/kategori-produk/index");
    }

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    for (const kategori of kategoriList) {
      await db.query(
        "INSERT INTO kategori_produk (nama, deskripsi, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [kategori.nama, kategori.deskripsi, now, now]
      );

      await log(
        `Kategori Produk ${kategori.nama} created by ${req.session.user.username}`,
        LOG_LEVELS.INFO,
        req.session.user.id,
        userAgentData,
        ip
      );
    }

    req.flash("success", "Data kategori produk baru sudah di-upload!");

    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting file:", err);
    });

    return res.redirect("/kategori-produk/index");
  } catch (err) {
    await log(
      `Error creating kategori produk from Excel: ${err.message}`,
      LOG_LEVELS.ERROR,
      req.session.user.id,
      userAgentData,
      ip
    );

    req.flash("error", `An error occurred while processing the file: ${err.message}`);
    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting file:", err);
    });

    return res.redirect("/kategori-produk/index");
  }
};

module.exports = {
  getAllKategoriProduk,
  deleteKategoriProduk,
  updateKategoriProduk,
  downloadKategoriProduk,
  tambahKategoriProduk,
  downloadKategoriProdukTemplate,
  uploadNewKategoriProduk,
};