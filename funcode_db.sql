-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: May 18, 2026 at 03:28 AM
-- Server version: 8.0.30
-- PHP Version: 8.4.14

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `funcode_db`
--

DELIMITER $$
--
-- Procedures
--
CREATE DEFINER=`root`@`localhost` PROCEDURE `RestoreCustomer` (IN `customer_id` INT, OUT `result_code` INT, OUT `result_message` VARCHAR(255))   BEGIN
    DECLARE customer_name VARCHAR(255) DEFAULT '';
    
    SELECT nama INTO customer_name 
    FROM customers 
    WHERE id = customer_id AND deleted_at IS NOT NULL;
    
    IF customer_name = '' THEN
        SET result_code = 0;
        SET result_message = 'Customer not found or not deleted';
    ELSE
        UPDATE customers 
        SET deleted_at = NULL 
        WHERE id = customer_id;
        
        SET result_code = 1;
        SET result_message = CONCAT('Customer ', customer_name, ' successfully restored');
    END IF;
END$$

CREATE DEFINER=`root`@`localhost` PROCEDURE `SafeDeleteCustomer` (IN `customer_id` INT, OUT `result_code` INT, OUT `result_message` VARCHAR(255))   BEGIN
    DECLARE transaction_count INT DEFAULT 0;
    DECLARE return_count INT DEFAULT 0;
    DECLARE customer_name VARCHAR(255) DEFAULT '';
    
    DECLARE EXIT HANDLER FOR SQLEXCEPTION 
    BEGIN
        ROLLBACK;
        SET result_code = -1;
        SET result_message = 'Error occurred during customer deletion';
    END;
    
    START TRANSACTION;
    
    -- Check if customer exists and get name
    SELECT nama INTO customer_name 
    FROM customers 
    WHERE id = customer_id AND deleted_at IS NULL;
    
    IF customer_name = '' THEN
        SET result_code = 0;
        SET result_message = 'Customer not found or already deleted';
        ROLLBACK;
    ELSE
        -- Check for completed transactions
        SELECT COUNT(*) INTO transaction_count 
        FROM transactions 
        WHERE customer_id = customer_id AND status = 'selesai';
        
        -- Check for returns
        SELECT COUNT(*) INTO return_count 
        FROM retur 
        WHERE customer_id = customer_id;
        
        IF transaction_count > 0 OR return_count > 0 THEN
            -- Cannot delete, has related records
            SET result_code = 0;
            SET result_message = CONCAT('Cannot delete customer. Has ', transaction_count, ' completed transactions and ', return_count, ' returns');
            ROLLBACK;
        ELSE
            -- Safe to delete - update related records first
            UPDATE transactions 
            SET customer_id = NULL 
            WHERE customer_id = customer_id AND status = 'pending';
            
            UPDATE retur 
            SET customer_id = NULL 
            WHERE customer_id = customer_id;
            
            -- Soft delete the customer
            UPDATE customers 
            SET deleted_at = NOW() 
            WHERE id = customer_id;
            
            SET result_code = 1;
            SET result_message = CONCAT('Customer ', customer_name, ' successfully deleted');
            COMMIT;
        END IF;
    END IF;
END$$

DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `activity_logs`
--

CREATE TABLE `activity_logs` (
  `id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `activity` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `ip_address` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `device_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `browser` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `platform` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `barangs`
--

CREATE TABLE `barangs` (
  `id` int NOT NULL,
  `nama` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `deskripsi` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `SKU` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `jumlah_stok` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `kategori_id` int DEFAULT NULL,
  `harga_beli` decimal(15,2) DEFAULT '0.00',
  `harga_jual` decimal(15,2) DEFAULT '0.00'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `barangs`
--

INSERT INTO `barangs` (`id`, `nama`, `deskripsi`, `SKU`, `jumlah_stok`, `created_at`, `updated_at`, `kategori_id`, `harga_beli`, `harga_jual`) VALUES
(1, 'Laptop ASUS ROG', 'Laptop gaming dengan spesifikasi tinggi', 'ASUS-ROG-001', 6, '2025-04-02 14:21:20', '2026-05-11 03:11:19', NULL, 10000000.00, 15000000.00),
(2, 'Mouse Logitech G502', 'Mouse gaming dengan sensor HERO 25K', 'LOGI-G502', 13, '2025-04-02 14:21:20', '2026-05-11 03:14:49', NULL, 100000.00, 150000.00),
(3, 'Keyboard Mechanical Keychron K6', 'Keyboard wireless dengan switch mekanikal', 'KEYCHRON-K6', 9, '2025-04-02 14:21:20', '2025-06-12 16:25:29', NULL, 400000.00, 560000.00),
(4, 'Monitor LG Ultragear', 'Monitor gaming 144Hz dengan resolusi 2K', 'LG-ULTRA-002', 12, '2025-04-02 14:21:20', '2025-06-27 14:48:57', NULL, 10000000.00, 12000000.00),
(5, 'Printer Epson EcoTank L3210', 'Printer all-in-one dengan teknologi tangki tinta hemat biaya cetak.', 'EPS-L3210', 19, '2025-06-12 13:50:20', '2026-05-18 02:45:02', 2, 1750000.00, 2200000.00),
(6, 'Smartphone Samsung Galaxy S24', 'Smartphone flagship dengan kamera AI dan layar Dynamic AMOLED 2X.', 'SG-S24-BLK128', 24, '2025-06-12 13:50:20', '2026-05-18 02:09:23', 1, 9000000.00, 11999000.00),
(7, 'Router TP-Link Archer AX50', 'Router WiFi 6 dual-band dengan kecepatan hingga 3 Gbps dan fitur keamanan HomeCare.', 'TPL-AX50', 17, '2025-06-12 13:50:20', '2025-06-27 14:24:36', 3, 1100000.00, 1450000.00),
(8, 'SSD Samsung 980 PRO 1TB', 'Solid State Drive NVMe Gen4 dengan kecepatan baca hingga 7000 MB/s.', 'SSD-980PRO-1TB', 44, '2025-06-12 13:50:20', '2025-06-12 16:25:35', 4, 1550000.00, 2000000.00),
(9, 'Laptop Dell XPS 13 Plus', 'Ultrabook premium dengan layar OLED 13.4 inci dan prosesor Intel Core i7 Gen 13.', 'DELL-XPS13-PLUS', 10, '2025-06-12 13:50:20', '2025-06-27 14:48:57', 1, 18500000.00, 21900000.00),
(10, 'Headset Jabra Evolve2 75', 'Headset profesional dengan noise-cancelling aktif untuk penggunaan bisnis.', 'JABRA-E75', 78, '2025-06-12 13:50:20', '2026-05-18 02:43:53', 5, 4200000.00, 4899000.00),
(11, 'Tablet Apple iPad Pro 11\" (M4)', 'Tablet performa tinggi dengan chip Apple M4 dan layar ProMotion.', 'APL-IPADPRO11-M4', 13, '2025-06-12 13:50:20', '2026-05-18 02:09:35', 1, 13500000.00, 16499000.00),
(12, 'Scanner Fujitsu fi-8170', 'Scanner dokumen enterprise dengan kecepatan tinggi dan dukungan TWAIN/ISIS.', 'FUJI-FI8170', 8, '2025-06-12 13:50:20', '2025-06-12 13:50:20', 6, 9800000.00, 11850000.00),
(13, 'NAS Synology DS923+', 'Network Attached Storage 4-bay dengan dukungan hingga 64TB dan fitur manajemen bisnis.', 'SYNO-DS923PLUS', 11, '2025-06-12 13:50:20', '2025-06-27 14:16:18', 7, 9500000.00, 12499000.00),
(14, 'Webcam Logitech BRIO 4K', 'Kamera web resolusi 4K UHD dengan dukungan HDR dan Zoom Digital 5x.', 'LOGI-BRIO4K', 32, '2025-06-12 13:50:20', '2026-05-18 02:12:10', 5, 1700000.00, 2150000.00),
(38, 'Lenovo IDEAPAD', 'laptop', 'LENOVO.INC', 1, '2025-06-27 14:13:27', '2025-06-27 14:14:04', 1, 50000000.00, 60000000.00);

-- --------------------------------------------------------

--
-- Table structure for table `customers`
--

CREATE TABLE `customers` (
  `id` int NOT NULL,
  `nama` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `telepon` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `alamat` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `customers`
--

INSERT INTO `customers` (`id`, `nama`, `email`, `telepon`, `alamat`, `created_at`, `updated_at`) VALUES
(1, 'Andi Pratama', 'andi@email.com', '081234567890', 'Jl. Merdeka No. 10', '2025-04-01 03:00:00', '2025-04-01 03:00:00'),
(2, 'Budi Santoso', 'budi@email.com', '081298765432', 'Jl. Mawar No. 5', '2025-04-01 04:00:00', '2025-04-01 04:00:00'),
(4, 'fahreza rizky', 'fahreza@gmail.com', '089520124809', 'Jl. wuluhan No. 123, jember', '2025-04-07 18:24:14', '2026-05-18 03:28:10');

-- --------------------------------------------------------

--
-- Table structure for table `kategori_produk`
--

CREATE TABLE `kategori_produk` (
  `id` int NOT NULL,
  `nama` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `deskripsi` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `kategori_produk`
--

INSERT INTO `kategori_produk` (`id`, `nama`, `deskripsi`, `created_at`, `updated_at`) VALUES
(1, 'Komputer & Laptop', 'Produk komputer, laptop, dan perangkat keras pendukung.', '2025-06-12 13:50:04', '2025-06-12 13:50:04'),
(2, 'Printer & Scanner', 'Printer, scanner, dan perangkat cetak dokumen lainnya.', '2025-06-12 13:50:04', '2025-06-12 13:50:04'),
(3, 'Jaringan & Internet', 'Perangkat jaringan seperti router, modem, dan access point.', '2025-06-12 13:50:04', '2025-06-12 13:50:04'),
(4, 'Penyimpanan Data', 'Perangkat penyimpanan seperti SSD, HDD, dan flash drive.', '2025-06-12 13:50:04', '2025-06-12 13:50:04'),
(5, 'Aksesori & Periferal', 'Aksesori komputer seperti mouse, keyboard, headset, dan webcam.', '2025-06-12 13:50:04', '2025-06-12 13:50:04'),
(6, 'Dokumentasi & Imaging', 'Perangkat khusus untuk pemindaian dan dokumentasi digital.', '2025-06-12 13:50:04', '2025-06-12 13:50:04'),
(7, 'Server & NAS', 'Perangkat server dan penyimpanan jaringan (NAS) untuk kebutuhan enterprise.', '2025-06-12 13:50:04', '2025-06-12 13:50:04');

-- --------------------------------------------------------

--
-- Table structure for table `pembayaran`
--

CREATE TABLE `pembayaran` (
  `id` int NOT NULL,
  `transaction_id` int NOT NULL,
  `metode_pembayaran` enum('tunai','kartu_kredit','kartu_debit','transfer','e-wallet') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `jumlah_bayar` decimal(15,2) NOT NULL,
  `kembalian` decimal(15,2) DEFAULT '0.00',
  `ref_pembayaran` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `pembelian`
--

CREATE TABLE `pembelian` (
  `id` int NOT NULL,
  `supplier_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `tanggal_pembelian` datetime DEFAULT CURRENT_TIMESTAMP,
  `total_harga` decimal(15,2) NOT NULL,
  `status` enum('pending','selesai','batal') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `pembelian`
--

INSERT INTO `pembelian` (`id`, `supplier_id`, `user_id`, `tanggal_pembelian`, `total_harga`, `status`, `created_at`, `updated_at`) VALUES
(1, 1, 1, '2025-06-27 20:09:02', 4700000.00, 'batal', '2025-06-27 13:09:02', '2025-06-27 13:09:13'),
(2, 1, 1, '2025-06-27 20:09:22', 27000000.00, 'selesai', '2025-06-27 13:09:22', '2025-06-27 13:09:25'),
(3, 1, 1, '2025-06-27 21:15:56', 56000000.00, 'selesai', '2025-06-27 14:15:56', '2025-06-27 14:16:18'),
(4, 2, 1, '2026-05-11 10:10:59', 23500000.00, 'selesai', '2026-05-11 03:10:59', '2026-05-11 03:11:19');

-- --------------------------------------------------------

--
-- Table structure for table `pembelian_detail`
--

CREATE TABLE `pembelian_detail` (
  `id` int NOT NULL,
  `pembelian_id` int NOT NULL,
  `barang_id` int NOT NULL,
  `jumlah` int NOT NULL,
  `harga_satuan` decimal(15,2) NOT NULL,
  `subtotal` decimal(15,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `pembelian_detail`
--

INSERT INTO `pembelian_detail` (`id`, `pembelian_id`, `barang_id`, `jumlah`, `harga_satuan`, `subtotal`) VALUES
(1, 1, 3, 4, 400000.00, 1600000.00),
(2, 1, 8, 2, 1550000.00, 3100000.00),
(3, 2, 6, 3, 9000000.00, 27000000.00),
(4, 3, 14, 5, 1700000.00, 8500000.00),
(5, 3, 13, 5, 9500000.00, 47500000.00),
(6, 4, 1, 1, 10000000.00, 10000000.00),
(7, 4, 11, 1, 13500000.00, 13500000.00);

-- --------------------------------------------------------

--
-- Table structure for table `retur`
--

CREATE TABLE `retur` (
  `id` int NOT NULL,
  `transaction_id` int DEFAULT NULL,
  `customer_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `tanggal_retur` datetime DEFAULT CURRENT_TIMESTAMP,
  `alasan` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `total_pengembalian` decimal(15,2) NOT NULL,
  `status` enum('pending','selesai','batal') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'pending'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `retur`
--

INSERT INTO `retur` (`id`, `transaction_id`, `customer_id`, `user_id`, `tanggal_retur`, `alasan`, `total_pengembalian`, `status`) VALUES
(1, 13, 4, 1, '2025-06-27 18:13:45', 'barang rusak', 9798000.00, 'pending'),
(2, 13, 4, 1, '2025-06-27 19:55:24', 'mahall', 4899000.00, 'pending'),
(3, 16, 4, 1, '2025-06-27 21:24:36', 'tidak jadi beli', 13449000.00, 'pending'),
(4, 19, 2, 1, '2025-06-27 21:44:59', 'barang rusak', 2200000.00, 'pending'),
(5, 20, 4, 1, '2025-06-27 21:50:13', 'king kopi', 11999000.00, 'pending');

-- --------------------------------------------------------

--
-- Table structure for table `retur_detail`
--

CREATE TABLE `retur_detail` (
  `id` int NOT NULL,
  `retur_id` int NOT NULL,
  `barang_id` int NOT NULL,
  `jumlah` int NOT NULL,
  `harga_satuan` decimal(15,2) NOT NULL,
  `subtotal` decimal(15,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `retur_detail`
--

INSERT INTO `retur_detail` (`id`, `retur_id`, `barang_id`, `jumlah`, `harga_satuan`, `subtotal`) VALUES
(1, 1, 10, 2, 4899000.00, 9798000.00),
(2, 2, 10, 1, 4899000.00, 4899000.00),
(3, 3, 6, 1, 11999000.00, 11999000.00),
(4, 3, 7, 1, 1450000.00, 1450000.00),
(5, 4, 5, 1, 2200000.00, 2200000.00),
(6, 5, 6, 1, 11999000.00, 11999000.00);

-- --------------------------------------------------------

--
-- Table structure for table `stock_history`
--

CREATE TABLE `stock_history` (
  `id` int NOT NULL,
  `barang_id` int NOT NULL,
  `jumlah` int NOT NULL,
  `tipe` enum('masuk','keluar') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `reference_id` int DEFAULT NULL,
  `reference_type` enum('pembelian','penjualan','retur','adjustment') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `keterangan` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `user_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `stock_history`
--

INSERT INTO `stock_history` (`id`, `barang_id`, `jumlah`, `tipe`, `reference_id`, `reference_type`, `keterangan`, `user_id`, `created_at`) VALUES
(1, 10, 80, 'masuk', NULL, 'adjustment', 'Penyesuaian stok: 20 → 100', 1, '2025-06-27 11:11:20'),
(2, 10, 15, 'keluar', 13, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 11:12:16'),
(3, 10, 6, 'keluar', NULL, 'adjustment', 'Penyesuaian stok: 85 → 79', 1, '2025-06-27 11:13:07'),
(4, 10, 2, 'masuk', 1, 'retur', 'Retur barang - barang rusak', 1, '2025-06-27 11:13:45'),
(5, 2, 1, 'keluar', 14, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 11:31:47'),
(6, 2, 1, 'keluar', 15, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 12:54:29'),
(7, 10, 1, 'masuk', 2, 'retur', 'Retur barang - mahall', 1, '2025-06-27 12:55:24'),
(8, 6, 3, 'masuk', 2, 'pembelian', 'Pembelian barang masuk', 1, '2025-06-27 13:09:25'),
(9, 6, 3, 'keluar', 16, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 14:11:41'),
(10, 7, 2, 'keluar', 16, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 14:11:41'),
(11, 38, 100, 'masuk', NULL, 'adjustment', 'Stok awal barang: Lenovo IDEAPAD', 1, '2025-06-27 14:13:27'),
(12, 38, 99, 'keluar', NULL, 'adjustment', 'Penyesuaian stok: 100 → 1', 1, '2025-06-27 14:14:04'),
(13, 14, 5, 'masuk', 3, 'pembelian', 'Pembelian barang masuk', 1, '2025-06-27 14:16:18'),
(14, 13, 5, 'masuk', 3, 'pembelian', 'Pembelian barang masuk', 1, '2025-06-27 14:16:18'),
(15, 6, 1, 'masuk', 3, 'retur', 'Retur barang - tidak jadi beli', 1, '2025-06-27 14:24:36'),
(16, 7, 1, 'masuk', 3, 'retur', 'Retur barang - tidak jadi beli', 1, '2025-06-27 14:24:36'),
(17, 5, 2, 'keluar', 17, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 14:39:16'),
(18, 2, 1, 'keluar', 18, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 14:42:44'),
(19, 5, 1, 'keluar', 19, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 14:43:30'),
(20, 5, 1, 'masuk', 4, 'retur', 'Retur barang - barang rusak', 1, '2025-06-27 14:44:59'),
(21, 6, 2, 'keluar', 20, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 14:48:57'),
(22, 9, 2, 'keluar', 20, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 14:48:57'),
(23, 11, 2, 'keluar', 20, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 14:48:57'),
(24, 4, 1, 'keluar', 20, 'penjualan', 'Penjualan melalui POS', 1, '2025-06-27 14:48:57'),
(25, 6, 1, 'masuk', 5, 'retur', 'Retur barang - king kopi', 1, '2025-06-27 14:50:13'),
(26, 1, 2, 'keluar', NULL, 'adjustment', 'Penyesuaian stok: 7 → 5', 1, '2025-06-27 15:01:07'),
(27, 10, 3, 'keluar', 21, 'penjualan', 'Penjualan melalui POS', 1, '2025-07-04 14:36:55'),
(28, 1, 1, 'masuk', 4, 'pembelian', 'Pembelian barang masuk', 1, '2026-05-11 03:11:19'),
(29, 11, 1, 'masuk', 4, 'pembelian', 'Pembelian barang masuk', 1, '2026-05-11 03:11:19'),
(30, 2, 1, 'keluar', 22, 'penjualan', 'Penjualan melalui POS', 1, '2026-05-11 03:14:49'),
(31, 6, 1, 'keluar', 23, 'penjualan', 'Penjualan melalui POS', 1, '2026-05-18 02:09:23'),
(32, 11, 1, 'keluar', 24, 'penjualan', 'Penjualan melalui POS', 1, '2026-05-18 02:09:35'),
(33, 14, 1, 'keluar', 25, 'penjualan', 'Penjualan melalui POS', 1, '2026-05-18 02:12:10'),
(34, 10, 1, 'keluar', 26, 'penjualan', 'Penjualan melalui POS', 2, '2026-05-18 02:43:53'),
(35, 5, 1, 'keluar', 26, 'penjualan', 'Penjualan melalui POS', 2, '2026-05-18 02:43:53'),
(36, 5, 1, 'keluar', 27, 'penjualan', 'Penjualan melalui POS', 1, '2026-05-18 02:45:02');

-- --------------------------------------------------------

--
-- Table structure for table `suppliers`
--

CREATE TABLE `suppliers` (
  `id` int NOT NULL,
  `nama` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `telepon` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `alamat` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `suppliers`
--

INSERT INTO `suppliers` (`id`, `nama`, `email`, `telepon`, `alamat`, `created_at`, `updated_at`) VALUES
(1, 'fulan', 'fulan@io.com', '089520124809', 'Jl Tamansari-wuluhan', '2025-06-27 13:08:23', '2026-05-18 03:27:10'),
(2, 'Fahreza Rizky', 'fahreza@gmail.com', '089520124809', 'Jl Tamansari-wuluhan', '2025-07-04 14:41:30', '2026-05-18 03:27:33');

-- --------------------------------------------------------

--
-- Table structure for table `transactions`
--

CREATE TABLE `transactions` (
  `id` int NOT NULL,
  `customer_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `tanggal_transaksi` datetime DEFAULT CURRENT_TIMESTAMP,
  `total_harga` decimal(15,2) NOT NULL,
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'pending',
  `payment_method` enum('tunai','kartu_kredit','kartu_debit','transfer','e-wallet') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'tunai'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `transactions`
--

INSERT INTO `transactions` (`id`, `customer_id`, `user_id`, `tanggal_transaksi`, `total_harga`, `status`, `payment_method`) VALUES
(1, 1, NULL, '2025-04-02 00:00:00', 500000.00, 'selesai', 'tunai'),
(2, 2, NULL, '2025-04-02 00:00:00', 750000.00, 'pending', 'tunai'),
(4, 4, 1, '2025-06-12 20:23:28', 16500000.00, 'completed', 'tunai'),
(5, NULL, 1, '2025-06-12 20:24:24', 16665000.00, 'completed', 'tunai'),
(6, 1, 1, '2025-06-12 20:25:24', 330000.00, 'completed', 'kartu_kredit'),
(7, 4, 1, '2025-06-12 20:27:15', 29700000.00, 'completed', 'tunai'),
(8, 1, 3, '2025-06-12 20:34:41', 3080000.00, 'completed', 'tunai'),
(9, 4, 3, '2025-06-12 20:51:07', 4730000.00, 'completed', 'transfer'),
(10, NULL, 3, '2025-06-12 21:31:10', 39596700.00, 'completed', 'tunai'),
(11, NULL, 1, '2025-06-12 23:25:29', 97848300.00, 'completed', 'tunai'),
(12, NULL, 1, '2025-06-12 23:25:35', 13200000.00, 'completed', 'tunai'),
(13, 4, 1, '2025-06-27 18:12:16', 80833500.00, 'selesai', 'tunai'),
(14, 4, 1, '2025-06-27 18:31:47', 165000.00, 'selesai', 'tunai'),
(15, NULL, 1, '2025-06-27 19:54:29', 165000.00, 'selesai', 'tunai'),
(16, 4, 1, '2025-06-27 21:11:41', 42786700.00, 'selesai', 'tunai'),
(17, 1, 1, '2025-06-27 21:39:16', 4840000.00, 'selesai', 'tunai'),
(18, 2, 1, '2025-06-27 21:42:44', 165000.00, 'selesai', 'tunai'),
(19, 2, 1, '2025-06-27 21:43:30', 2420000.00, 'selesai', 'tunai'),
(20, 4, 1, '2025-06-27 21:48:57', 124075600.00, 'selesai', 'tunai'),
(21, 4, 1, '2025-07-04 21:36:55', 16166700.00, 'selesai', 'tunai'),
(22, 2, 1, '2026-05-11 10:14:49', 165000.00, 'selesai', 'tunai'),
(23, 4, 1, '2026-05-18 09:09:23', 13198900.00, 'selesai', 'tunai'),
(24, 4, 1, '2026-05-18 09:09:35', 18148900.00, 'selesai', 'tunai'),
(25, 2, 1, '2026-05-18 09:12:10', 2365000.00, 'selesai', 'kartu_kredit'),
(26, 1, 2, '2026-05-18 09:43:53', 7808900.00, 'selesai', 'transfer'),
(27, NULL, 1, '2026-05-18 09:45:02', 2420000.00, 'selesai', 'tunai');

-- --------------------------------------------------------

--
-- Table structure for table `transaction_details`
--

CREATE TABLE `transaction_details` (
  `id` int NOT NULL,
  `transaction_id` int DEFAULT NULL,
  `barang_id` int DEFAULT NULL,
  `jumlah` int NOT NULL,
  `harga_satuan` decimal(15,2) NOT NULL,
  `subtotal` decimal(15,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `transaction_details`
--

INSERT INTO `transaction_details` (`id`, `transaction_id`, `barang_id`, `jumlah`, `harga_satuan`, `subtotal`) VALUES
(3, 4, 1, 1, 15000000.00, 15000000.00),
(4, 5, 1, 1, 15000000.00, 15000000.00),
(5, 5, 2, 1, 150000.00, 150000.00),
(6, 6, 2, 2, 150000.00, 300000.00),
(7, 7, 1, 1, 15000000.00, 15000000.00),
(8, 7, 4, 1, 12000000.00, 12000000.00),
(9, 8, 3, 5, 560000.00, 2800000.00),
(10, 9, 14, 2, 2150000.00, 4300000.00),
(11, 10, 6, 3, 11999000.00, 35997000.00),
(12, 11, 3, 1, 560000.00, 560000.00),
(13, 11, 5, 2, 2200000.00, 4400000.00),
(14, 11, 6, 7, 11999000.00, 83993000.00),
(15, 12, 8, 6, 2000000.00, 12000000.00),
(16, 13, 10, 15, 4899000.00, 73485000.00),
(17, 14, 2, 1, 150000.00, 150000.00),
(18, 15, 2, 1, 150000.00, 150000.00),
(19, 16, 6, 3, 11999000.00, 35997000.00),
(20, 16, 7, 2, 1450000.00, 2900000.00),
(21, 17, 5, 2, 2200000.00, 4400000.00),
(22, 18, 2, 1, 150000.00, 150000.00),
(23, 19, 5, 1, 2200000.00, 2200000.00),
(24, 20, 6, 2, 11999000.00, 23998000.00),
(25, 20, 9, 2, 21900000.00, 43800000.00),
(26, 20, 11, 2, 16499000.00, 32998000.00),
(27, 20, 4, 1, 12000000.00, 12000000.00),
(28, 21, 10, 3, 4899000.00, 14697000.00),
(29, 22, 2, 1, 150000.00, 150000.00),
(30, 23, 6, 1, 11999000.00, 11999000.00),
(31, 24, 11, 1, 16499000.00, 16499000.00),
(32, 25, 14, 1, 2150000.00, 2150000.00),
(33, 26, 10, 1, 4899000.00, 4899000.00),
(34, 26, 5, 1, 2200000.00, 2200000.00),
(35, 27, 5, 1, 2200000.00, 2200000.00);

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int NOT NULL,
  `username` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `role` enum('Admin','Manager','User') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'User',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `role`, `created_at`, `updated_at`) VALUES
(1, 'admin', 'admin@funcode.io', '$2b$10$HugitC8LZW/mysNFmO8zTeXKx8asK.UmoBKOja/tdnO1CoBltwcaW', 'Admin', '2025-03-27 08:01:49', '2026-05-18 02:36:06'),
(2, 'manager', 'manager@funcode.io', '$2b$10$HugitC8LZW/mysNFmO8zTeXKx8asK.UmoBKOja/tdnO1CoBltwcaW', 'Manager', '2025-03-27 08:01:49', '2026-05-18 02:37:09'),
(3, 'user', 'user@funcode.io', '$2b$10$yRUqYcrbpRCZx9qO1ByRNOCzSGzZm37ZeENsbBxCkEuVyfykjmzkS', 'User', '2025-03-27 08:01:49', '2026-05-18 02:37:28');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `activity_logs`
--
ALTER TABLE `activity_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `barangs`
--
ALTER TABLE `barangs`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `SKU` (`SKU`),
  ADD KEY `fk_barang_kategori` (`kategori_id`);

--
-- Indexes for table `customers`
--
ALTER TABLE `customers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- Indexes for table `kategori_produk`
--
ALTER TABLE `kategori_produk`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `pembayaran`
--
ALTER TABLE `pembayaran`
  ADD PRIMARY KEY (`id`),
  ADD KEY `transaction_id` (`transaction_id`);

--
-- Indexes for table `pembelian`
--
ALTER TABLE `pembelian`
  ADD PRIMARY KEY (`id`),
  ADD KEY `supplier_id` (`supplier_id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `pembelian_detail`
--
ALTER TABLE `pembelian_detail`
  ADD PRIMARY KEY (`id`),
  ADD KEY `pembelian_id` (`pembelian_id`),
  ADD KEY `barang_id` (`barang_id`);

--
-- Indexes for table `retur`
--
ALTER TABLE `retur`
  ADD PRIMARY KEY (`id`),
  ADD KEY `transaction_id` (`transaction_id`),
  ADD KEY `customer_id` (`customer_id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `retur_detail`
--
ALTER TABLE `retur_detail`
  ADD PRIMARY KEY (`id`),
  ADD KEY `retur_id` (`retur_id`),
  ADD KEY `barang_id` (`barang_id`);

--
-- Indexes for table `stock_history`
--
ALTER TABLE `stock_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `barang_id` (`barang_id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `suppliers`
--
ALTER TABLE `suppliers`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `transactions`
--
ALTER TABLE `transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `customer_id` (`customer_id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `transaction_details`
--
ALTER TABLE `transaction_details`
  ADD PRIMARY KEY (`id`),
  ADD KEY `transaction_id` (`transaction_id`),
  ADD KEY `barang_id` (`barang_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`),
  ADD UNIQUE KEY `email` (`email`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `activity_logs`
--
ALTER TABLE `activity_logs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=564;

--
-- AUTO_INCREMENT for table `barangs`
--
ALTER TABLE `barangs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=39;

--
-- AUTO_INCREMENT for table `customers`
--
ALTER TABLE `customers`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `kategori_produk`
--
ALTER TABLE `kategori_produk`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `pembayaran`
--
ALTER TABLE `pembayaran`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `pembelian`
--
ALTER TABLE `pembelian`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `pembelian_detail`
--
ALTER TABLE `pembelian_detail`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `retur`
--
ALTER TABLE `retur`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `retur_detail`
--
ALTER TABLE `retur_detail`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `stock_history`
--
ALTER TABLE `stock_history`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=37;

--
-- AUTO_INCREMENT for table `suppliers`
--
ALTER TABLE `suppliers`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `transactions`
--
ALTER TABLE `transactions`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=28;

--
-- AUTO_INCREMENT for table `transaction_details`
--
ALTER TABLE `transaction_details`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=36;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `activity_logs`
--
ALTER TABLE `activity_logs`
  ADD CONSTRAINT `activity_logs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `barangs`
--
ALTER TABLE `barangs`
  ADD CONSTRAINT `fk_barang_kategori` FOREIGN KEY (`kategori_id`) REFERENCES `kategori_produk` (`id`);

--
-- Constraints for table `pembayaran`
--
ALTER TABLE `pembayaran`
  ADD CONSTRAINT `pembayaran_ibfk_1` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`);

--
-- Constraints for table `pembelian`
--
ALTER TABLE `pembelian`
  ADD CONSTRAINT `pembelian_ibfk_1` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `pembelian_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `pembelian_detail`
--
ALTER TABLE `pembelian_detail`
  ADD CONSTRAINT `pembelian_detail_ibfk_1` FOREIGN KEY (`pembelian_id`) REFERENCES `pembelian` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `pembelian_detail_ibfk_2` FOREIGN KEY (`barang_id`) REFERENCES `barangs` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `retur`
--
ALTER TABLE `retur`
  ADD CONSTRAINT `retur_ibfk_1` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`),
  ADD CONSTRAINT `retur_ibfk_2` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  ADD CONSTRAINT `retur_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `retur_detail`
--
ALTER TABLE `retur_detail`
  ADD CONSTRAINT `retur_detail_ibfk_1` FOREIGN KEY (`retur_id`) REFERENCES `retur` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `retur_detail_ibfk_2` FOREIGN KEY (`barang_id`) REFERENCES `barangs` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `stock_history`
--
ALTER TABLE `stock_history`
  ADD CONSTRAINT `stock_history_ibfk_1` FOREIGN KEY (`barang_id`) REFERENCES `barangs` (`id`),
  ADD CONSTRAINT `stock_history_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `transactions`
--
ALTER TABLE `transactions`
  ADD CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `transactions_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `transaction_details`
--
ALTER TABLE `transaction_details`
  ADD CONSTRAINT `transaction_details_ibfk_1` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `transaction_details_ibfk_2` FOREIGN KEY (`barang_id`) REFERENCES `barangs` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
