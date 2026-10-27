/**
 * UIU WhatsApp Bot - PostgreSQL Database Connection & Engine
 * Connected to Database: "UIU whats app BOT"
 * Tables:
 *   1. users (JID, phone, name, chat_type, first_seen, last_active, total_messages, status)
 *   2. message_logs (id, jid, phone, name, command, created_at)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    }
  : {
      host: process.env.PG_HOST || "localhost",
      port: parseInt(process.env.PG_PORT, 10) || 5432,
      user: process.env.PG_USER || "postgres",
      password: process.env.PG_PASSWORD || "postgres",
      database: process.env.PG_DATABASE || "UIU whats app BOT",
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    };

const pool = new Pool(poolConfig);

// Event listener for connection errors
pool.on("error", (err) => {
  console.error("⚠️ Unexpected PostgreSQL error on idle client:", err.message);
});

let isInitialized = false;
let initPromise = null;

/**
 * Initialize PostgreSQL tables and indexes
 */
async function initDatabase() {
  if (isInitialized) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            jid VARCHAR(100) PRIMARY KEY,
            phone VARCHAR(50),
            name VARCHAR(255),
            chat_type VARCHAR(20) DEFAULT 'individual',
            first_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            last_active TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            total_messages INTEGER DEFAULT 1,
            status VARCHAR(20) DEFAULT 'subscribed'
          );

          CREATE TABLE IF NOT EXISTS message_logs (
            id SERIAL PRIMARY KEY,
            jid VARCHAR(100),
            phone VARCHAR(50),
            name VARCHAR(255),
            command TEXT,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS baileys_auth (
            key VARCHAR(255) PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          );

          CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
          CREATE INDEX IF NOT EXISTS idx_logs_jid ON message_logs(jid);
        `);
        isInitialized = true;
        console.log(`🐘 PostgreSQL Connected to database: "${process.env.PG_DATABASE || 'UIU whats app BOT'}"`);
        return true;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("❌ Failed to connect or initialize PostgreSQL:", err.message);
      return false;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

// Auto-initialize on module load
initDatabase().catch(() => {});

const { sanitizeInput } = require("./security");

/**
 * Record or update user in PostgreSQL database
 */
async function recordUser(jid, name = "", phone = "", chatType = "individual") {
  try {
    await initDatabase();
    const cleanJid = sanitizeInput(jid, 100);
    const rawPhone = phone || (jid.includes("@") ? jid.split("@")[0] : jid);
    const cleanPhone = sanitizeInput(rawPhone, 50);
    const rawName = name || (chatType === "group" ? "WhatsApp Group" : `+${cleanPhone}`);
    const displayName = sanitizeInput(rawName, 150);
    const cleanChatType = sanitizeInput(chatType, 20);

    const query = `
      INSERT INTO users (jid, phone, name, chat_type, status, total_messages)
      VALUES ($1, $2, $3, $4, 'subscribed', 1)
      ON CONFLICT (jid) DO UPDATE SET
        name = CASE WHEN $3 != '' AND $3 IS NOT NULL THEN $3 ELSE users.name END,
        last_active = CURRENT_TIMESTAMP,
        total_messages = users.total_messages + 1;
    `;
    await pool.query(query, [cleanJid, cleanPhone, displayName, cleanChatType]);
    return true;
  } catch (err) {
    console.error("PostgreSQL recordUser error:", err.message);
    return false;
  }
}

/**
 * Record user command / interaction into message_logs
 */
async function recordInteraction(jid, name = "", phone = "", command = "") {
  try {
    await initDatabase();
    const cleanJid = sanitizeInput(jid, 100);
    const rawPhone = phone || (jid.includes("@") ? jid.split("@")[0] : jid);
    const cleanPhone = sanitizeInput(rawPhone, 50);
    const cleanName = sanitizeInput(name, 150);
    const cleanCommand = sanitizeInput(command, 500);

    const query = `
      INSERT INTO message_logs (jid, phone, name, command)
      VALUES ($1, $2, $3, $4);
    `;
    await pool.query(query, [cleanJid, cleanPhone, cleanName, cleanCommand]);
    return true;
  } catch (err) {
    console.error("PostgreSQL recordInteraction error:", err.message);

    return false;
  }
}

/**
 * Get all users from PostgreSQL
 */
async function getAllUsers() {
  try {
    await initDatabase();
    const query = `
      SELECT 
        jid, 
        phone, 
        name, 
        chat_type, 
        TO_CHAR(first_seen, 'YYYY-MM-DD HH24:MI:SS') as first_seen,
        TO_CHAR(last_active, 'YYYY-MM-DD HH24:MI:SS') as last_active,
        total_messages, 
        status
      FROM users 
      ORDER BY last_active DESC;
    `;
    const res = await pool.query(query);
    return res.rows;
  } catch (err) {
    console.error("PostgreSQL getAllUsers error:", err.message);
    return [];
  }
}

/**
 * Get recent interaction logs from PostgreSQL
 */
async function getRecentLogs(limit = 50) {
  try {
    await initDatabase();
    const query = `
      SELECT 
        id, 
        jid, 
        phone, 
        name, 
        command, 
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at
      FROM message_logs 
      ORDER BY id DESC 
      LIMIT $1;
    `;
    const res = await pool.query(query, [limit]);
    return res.rows;
  } catch (err) {
    console.error("PostgreSQL getRecentLogs error:", err.message);
    return [];
  }
}

/**
 * Get PostgreSQL metrics & status
 */
async function getDatabaseMetrics() {
  try {
    await initDatabase();
    const query = `
      SELECT 
        (SELECT COUNT(*)::int FROM users) as total_users,
        (SELECT COUNT(*)::int FROM users WHERE status = 'subscribed') as active_subscribers,
        (SELECT COUNT(*)::int FROM message_logs) as total_interactions;
    `;
    const res = await pool.query(query);
    const row = res.rows[0] || {};

    return {
      connected: true,
      totalUsers: row.total_users || 0,
      activeSubscribers: row.active_subscribers || 0,
      totalInteractions: row.total_interactions || 0,
      databaseType: "PostgreSQL 18",
      databaseName: process.env.PG_DATABASE || "UIU whats app BOT",
      host: process.env.PG_HOST || "localhost",
      port: process.env.PG_PORT || 5432
    };
  } catch (err) {
    return {
      connected: false,
      totalUsers: 0,
      activeSubscribers: 0,
      totalInteractions: 0,
      databaseType: "PostgreSQL",
      databaseName: process.env.PG_DATABASE || "UIU whats app BOT",
      error: err.message
    };
  }
}

/**
 * Update user subscription status (e.g. unsubscribed)
 */
async function updateUserStatus(jid, status = "subscribed") {
  try {
    await initDatabase();
    const query = `UPDATE users SET status = $1 WHERE jid = $2;`;
    await pool.query(query, [status, jid]);
    return true;
  } catch (err) {
    console.error("PostgreSQL updateUserStatus error:", err.message);
    return false;
  }
}

/**
 * Get all active subscribers from PostgreSQL for lifetime broadcasting
 */
async function getActiveSubscribers() {
  try {
    await initDatabase();
    const query = `
      SELECT 
        jid, 
        phone, 
        name, 
        chat_type as type, 
        status,
        TO_CHAR(first_seen, 'YYYY-MM-DD HH24:MI:SS') as "subscribedAt"
      FROM users 
      WHERE status = 'subscribed'
      ORDER BY first_seen ASC;
    `;
    const res = await pool.query(query);
    return res.rows;
  } catch (err) {
    console.error("PostgreSQL getActiveSubscribers error:", err.message);
    return [];
  }
}

/**
 * Restore WhatsApp Auth Session files from PostgreSQL to local folder
 */
async function restoreAuthFromDb(authDir) {
  try {
    await initDatabase();
    const res = await pool.query("SELECT key, value FROM baileys_auth;");
    if (res.rows && res.rows.length > 0) {
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }
      for (const row of res.rows) {
        fs.writeFileSync(path.join(authDir, row.key), row.value, "utf8");
      }
      console.log(`📥 [Cloud Auth] Restored ${res.rows.length} session credentials from PostgreSQL database.`);
      return true;
    }
  } catch (err) {
    console.error("⚠️ [Cloud Auth] Could not restore session from DB:", err.message);
  }
  return false;
}

/**
 * Sync all files from local authDir to PostgreSQL database
 */
async function syncAllAuthFilesToDb(authDir) {
  try {
    if (!fs.existsSync(authDir)) return;
    await initDatabase();
    const files = fs.readdirSync(authDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(authDir, file);
      try {
        const content = fs.readFileSync(filePath, "utf8");
        await pool.query(
          `INSERT INTO baileys_auth (key, value, updated_at) 
           VALUES ($1, $2, CURRENT_TIMESTAMP) 
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
          [file, content]
        );
      } catch (e) {}
    }
  } catch (err) {
    console.error("⚠️ [Cloud Auth] Could not sync session to DB:", err.message);
  }
}

/**
 * Clear session from DB on explicit logout
 */
async function clearAuthFromDb() {
  try {
    await initDatabase();
    await pool.query("DELETE FROM baileys_auth;");
    console.log("🧹 [Cloud Auth] Cleared session from PostgreSQL database.");
  } catch (err) {
    console.error("⚠️ [Cloud Auth] Could not clear session from DB:", err.message);
  }
}

module.exports = {
  pool,
  initDatabase,
  recordUser,
  recordInteraction,
  getAllUsers,
  getActiveSubscribers,
  getRecentLogs,
  getDatabaseMetrics,
  updateUserStatus,
  restoreAuthFromDb,
  syncAllAuthFilesToDb,
  clearAuthFromDb
};

