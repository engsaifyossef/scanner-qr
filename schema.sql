-- ==============================================================================
-- EVENT QR CODE PASS SYSTEM - DATABASE SCHEMAS
-- Anti-Passback Single-Use Access Control
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. POSTGRESQL SCHEMA (Production Grade)
-- ------------------------------------------------------------------------------
-- Enable UUID generation extension if not present
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guest_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(30) NOT NULL,
    email VARCHAR(150),
    ticket_category VARCHAR(50) DEFAULT 'General Admission',
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    scanned_at TIMESTAMP WITH TIME ZONE NULL,
    scanned_by VARCHAR(100) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Crucial Index: Fast lookup and atomic verification at high concurrency gates
CREATE INDEX IF NOT EXISTS idx_tickets_id_is_used ON tickets (id, is_used);
CREATE INDEX IF NOT EXISTS idx_tickets_phone ON tickets (phone_number);

-- ------------------------------------------------------------------------------
-- 2. MYSQL SCHEMA
-- ------------------------------------------------------------------------------
/*
CREATE TABLE IF NOT EXISTS tickets (
    id CHAR(36) PRIMARY KEY,
    guest_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(30) NOT NULL,
    email VARCHAR(150) NULL,
    ticket_category VARCHAR(50) DEFAULT 'General Admission',
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    scanned_at DATETIME NULL,
    scanned_by VARCHAR(100) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tickets_lookup (id, is_used)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
*/

-- ------------------------------------------------------------------------------
-- 3. SQLITE SCHEMA (Used by our embedded engine for instant zero-dependency running)
-- ------------------------------------------------------------------------------
/*
CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    guest_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    email TEXT,
    ticket_category TEXT DEFAULT 'General Admission',
    is_used INTEGER NOT NULL DEFAULT 0, -- 0 = false, 1 = true
    scanned_at TEXT NULL,
    scanned_by TEXT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_lookup ON tickets (id, is_used);
*/
