/**
 * UIU WhatsApp Bot - PostgreSQL Database Connection & Engine
 * Connected to Database: "UIU whats app BOT"
 * Tables:
 *   1. users (JID, phone, name, chat_type, first_seen, last_active, total_messages, status)
 *   2. message_logs (id, jid, phone, name, command, created_at)
 */

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  port: parseInt(process.env.PG_PORT, 10) || 5432,
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "postgres",
  database: process.env.PG_DATABASE || "UIU whats app BOT",
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

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

/**
 * Record or update user in PostgreSQL database
 */
async function recordUser(jid, name = "", phone = "", chatType = "individual") {
  try {
    await initDatabase();
    const cleanPhone = phone || (jid.includes("@") ? jid.split("@")[0] : jid);
    const displayName = name || (chatType === "group" ? "WhatsApp Group" : `+${cleanPhone}`);

    const query = `
      INSERT INTO users (jid, phone, name, chat_type, status, total_messages)
      VALUES ($1, $2, $3, $4, 'subscribed', 1)
      ON CONFLICT (jid) DO UPDATE SET
        name = CASE WHEN $3 != '' AND $3 IS NOT NULL THEN $3 ELSE users.name END,
        last_active = CURRENT_TIMESTAMP,
        total_messages = users.total_messages + 1;
    `;
    await pool.query(query, [jid, cleanPhone, displayName, chatType]);
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
    const cleanPhone = phone || (jid.includes("@") ? jid.split("@")[0] : jid);
    const query = `
      INSERT INTO message_logs (jid, phone, name, command)
      VALUES ($1, $2, $3, $4);
    `;
    await pool.query(query, [jid, cleanPhone, name, command]);
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

module.exports = {
  pool,
  initDatabase,
  recordUser,
  recordInteraction,
  getAllUsers,
  getActiveSubscribers,
  getRecentLogs,
  getDatabaseMetrics,
  updateUserStatus
};

