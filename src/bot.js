const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const { getCountdownStatus, loadCalendarData } = require("./calendar");
const {
  formatDailyBroadcast,
  formatCountdownReply,
  formatScheduleUpdateNotice,
  formatCustomAnnouncement,
  formatRoutineReply,
  formatInstallmentsReply,
  formatWelcomeReply
} = require("./messages");

const {
  recordUser,
  recordInteraction,
  updateUserStatus,
  getAllUsers,
  getActiveSubscribers,
  getDatabaseMetrics,
  getRecentLogs,
  listSavedSessionIds,
  restoreSessionAuthFromDb,
  syncSessionAuthToDb,
  clearSessionAuthFromDb,
  restoreAuthFromDb,
  syncAllAuthFilesToDb,
  clearAuthFromDb
} = require("./db");

const {
  checkUserRateLimit,
  sanitizeInput,
  validateNoticeContent
} = require("./security");



const SUBSCRIBERS_PATH = path.join(__dirname, "../data/subscribers.json");
const CONFIG_PATH = path.join(__dirname, "../config.json");
const BROADCAST_STATE_PATH = path.join(__dirname, "../data/broadcast_state.json");

function loadBroadcastState() {
  try {
    if (fs.existsSync(BROADCAST_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(BROADCAST_STATE_PATH, "utf-8"));
    }
  } catch (e) { }
  return { lastMorningDate: null, lastEveningDate: null };
}

function saveBroadcastState(state) {
  try {
    const dir = path.dirname(BROADCAST_STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BROADCAST_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) { }
}

// Shared bot state for Web Dashboard & Terminal
const botState = {
  status: "disconnected", // 'disconnected', 'connecting', 'qr_ready', 'connected'
  qrDataUrl: null,
  qrRaw: null,
  userInfo: null,
  lastBroadcast: null,
  subscribers: [],
  config: null,
  logs: []
};

function addLog(msg) {
  const time = new Date().toLocaleTimeString();
  const logEntry = `[${time}] ${msg}`;
  console.log(logEntry);
  botState.logs.unshift(logEntry);
  if (botState.logs.length > 60) botState.logs.pop();
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      botState.config = JSON.parse(raw);
    }
  } catch (err) {
    botState.config = {
      botName: "UIU Exam Countdown Bot",
      targetPhone: "self",
      morningScheduleTime: "09:00",
      eveningScheduleTime: "19:00",
      enableMorningNotification: true,
      enableEveningNotification: true,
      enableDailyNotification: true,
      autoBroadcastOnUpdate: true
    };
  }
  return botState.config;
}

// ==========================================
// SUBSCRIBERS MANAGEMENT ("SHOBAR WHATS APP")
// ==========================================
function loadSubscribers() {
  try {
    if (fs.existsSync(SUBSCRIBERS_PATH)) {
      const raw = fs.readFileSync(SUBSCRIBERS_PATH, "utf-8");
      botState.subscribers = JSON.parse(raw);
      return botState.subscribers;
    }
  } catch (err) {
    console.error("Failed to read subscribers.json:", err.message);
  }

  // Fallback default: admin/self
  botState.subscribers = [
    {
      jid: "self",
      name: "Admin (Self)",
      phone: "self",
      type: "self",
      subscribedAt: new Date().toISOString()
    }
  ];
  saveSubscribers(botState.subscribers);
  return botState.subscribers;
}

function saveSubscribers(list) {
  try {
    const dir = path.dirname(SUBSCRIBERS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SUBSCRIBERS_PATH, JSON.stringify(list, null, 2), "utf-8");
    botState.subscribers = list;
    return true;
  } catch (err) {
    addLog(`❌ Failed to save subscribers: ${err.message}`);
    return false;
  }
}

function addSubscriber(jid, name = "", phone = "") {
  const list = loadSubscribers();
  const existingIndex = list.findIndex(s => s.jid === jid);

  const isGroup = jid.endsWith("@g.us");
  const type = jid === "self" ? "self" : isGroup ? "group" : "individual";
  const displayName = name || (isGroup ? "WhatsApp Group" : phone ? `+${phone}` : "UIU Student");

  if (existingIndex >= 0) {
    // Update existing
    list[existingIndex].name = displayName || list[existingIndex].name;
    list[existingIndex].lastActive = new Date().toISOString();
  } else {
    list.push({
      jid,
      name: displayName,
      phone: phone || (jid.includes("@") ? jid.split("@")[0] : jid),
      type,
      subscribedAt: new Date().toISOString()
    });
    addLog(`➕ New subscriber registered: ${displayName} (${jid})`);
  }

  saveSubscribers(list);
  return true;
}

function removeSubscriber(jid) {
  const list = loadSubscribers();
  const filtered = list.filter(s => s.jid !== jid);
  saveSubscribers(filtered);
  addLog(`➖ Subscriber removed: ${jid}`);
  return true;
}

// shortcut: in-memory multi-session map; Render free tier (512MB RAM) supports ~15-20 concurrent Baileys sockets before needing a larger plan.
const sessions = new Map();
const SESSIONS_ROOT_DIR = path.join(__dirname, "../auth_info_sessions");
let scheduledTasks = [];
let qrPrintedInTerminal = false;
const botSentIds = new Set();

function trackSentMessage(sent) {
  const id = sent?.key?.id;
  if (!id) return;
  botSentIds.add(id);
  if (botSentIds.size > 400) {
    const first = botSentIds.values().next().value;
    botSentIds.delete(first);
  }
}

function isSessionSelfJid(sessionSock, remoteJid) {
  if (!remoteJid || !sessionSock?.user?.id) return false;
  if (remoteJid.endsWith("@g.us") || remoteJid.includes("@broadcast")) return false;
  const senderId = remoteJid.split(":")[0].split("@")[0];
  const ownerPhone = sessionSock.user.id.split(":")[0].split("@")[0];
  const ownerLid = sessionSock.user.lid ? sessionSock.user.lid.split(":")[0].split("@")[0] : null;
  return senderId === ownerPhone || (ownerLid && senderId === ownerLid);
}

function getConnectedSessions() {
  return Array.from(sessions.values()).filter(s => s.sock && s.status === "connected" && s.userInfo?.phone);
}

function refreshBotState() {
  const connected = getConnectedSessions();
  const def = sessions.get("default");

  if (connected.length > 0) {
    botState.status = "connected";
    botState.userInfo = connected[0].userInfo;
    botState.qrDataUrl = null;
    botState.qrRaw = null;
    botState.subscribers = connected.map(s => ({
      jid: `${s.userInfo.phone}@s.whatsapp.net`,
      name: s.userInfo.name || "UIU Student",
      phone: s.userInfo.phone,
      type: "self",
      subscribedAt: s.connectedAt || new Date().toISOString()
    }));
  } else if (def && def.status === "qr_ready") {
    botState.status = "qr_ready";
    botState.qrDataUrl = def.qrDataUrl;
    botState.userInfo = null;
  } else {
    botState.status = def ? def.status : "disconnected";
    botState.userInfo = null;
  }
}

async function syncSubscribersFromDatabase() {
  refreshBotState();
  return botState.subscribers;
}

// ==========================================
// BROADCAST TO ALL CONNECTED USERS (STRICT SELF-ONLY PER SESSION)
// ==========================================
async function broadcastToSubscribers(messageText, options = {}) {
  let connected = getConnectedSessions();
  const anyReconnecting = Array.from(sessions.values()).some(s => s.isReconnecting);
  if (connected.length === 0 && anyReconnecting) {
    addLog("⏳ WhatsApp socket reconnecting... waiting up to 10 seconds before broadcasting...");
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      connected = getConnectedSessions();
      if (connected.length > 0) break;
    }
  }

  if (connected.length === 0) {
    addLog("❌ Cannot broadcast: No WhatsApp users connected.");
    return { success: false, error: "Not connected to WhatsApp" };
  }

  const safetyCheck = validateNoticeContent("Broadcast", messageText);
  if (!safetyCheck.safe) {
    addLog(`🚨 Blocked unsafe broadcast attempt: ${safetyCheck.reason}`);
    return { success: false, error: safetyCheck.reason };
  }

  addLog(`📢 Sending self-only update to ${connected.length} connected WhatsApp user(s)...`);

  let deliveredCount = 0;
  let failedCount = 0;

  for (const s of connected) {
    const selfJid = `${s.userInfo.phone}@s.whatsapp.net`;
    let sentOk = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const sent = await s.sock.sendMessage(selfJid, { text: messageText });
        trackSentMessage(sent);
        deliveredCount++;
        sentOk = true;
        break;
      } catch (err) {
        if (attempt === 2) {
          addLog(`❌ Failed sending to +${s.userInfo.phone}: ${err.message}`);
          failedCount++;
        } else {
          await new Promise(res => setTimeout(res, 400));
        }
      }
    }
    if (sentOk && connected.length > 1) {
      await new Promise(res => setTimeout(res, 300));
    }
  }

  const status = getCountdownStatus();
  botState.lastBroadcast = {
    time: new Date().toLocaleString(),
    deliveredCount,
    failedCount,
    totalSubscribers: connected.length,
    phase: status.phase,
    midRemaining: status.midProgress.remainingDays,
    finalRemaining: status.finalProgress.remainingDays
  };

  addLog(`✅ Self-only update complete! Delivered: ${deliveredCount}/${connected.length}, Failed: ${failedCount}`);
  return {
    success: deliveredCount > 0,
    deliveredCount,
    failedCount,
    totalSubscribers: connected.length
  };
}

// Auto-broadcast when academic schedule changes
async function broadcastScheduleUpdate(changeSummary = "") {
  const config = loadConfig();
  if (config.autoBroadcastOnUpdate === false) {
    addLog("ℹ️ Auto-broadcast on update is disabled in settings.");
    return { success: false, reason: "Auto-broadcast disabled" };
  }

  const status = getCountdownStatus();
  const updateMessage = formatScheduleUpdateNotice(status, changeSummary);
  addLog("⚡ Schedule updated! Auto-broadcasting new exam dates to all subscribers...");
  return await broadcastToSubscribers(updateMessage);
}

// Daily scheduled broadcast (morning or evening) with persistence tracking
async function sendDailyBroadcast(slot = "auto") {
  const currentHour = new Date().getHours();
  const effectiveSlot = slot !== "auto" ? slot : currentHour < 14 ? "morning" : "evening";

  const status = getCountdownStatus();
  const messageText = formatDailyBroadcast(status, effectiveSlot);
  const result = await broadcastToSubscribers(messageText);

  if (result.success) {
    const state = loadBroadcastState();
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (effectiveSlot === "morning") state.lastMorningDate = todayStr;
    if (effectiveSlot === "evening") state.lastEveningDate = todayStr;
    saveBroadcastState(state);
  }

  return result;
}

// Missed broadcast catch-up engine: Ensures users NEVER miss a daily alert even if bot was restarting/updating
async function checkAndSendMissedBroadcast() {
  try {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const hour = now.getHours();
    const state = loadBroadcastState();

    // Morning window: between 9:00 AM and 1:00 PM (hour 9, 10, 11, 12)
    if (hour >= 9 && hour < 13 && state.lastMorningDate !== todayStr) {
      addLog("⚡ [Catch-Up] Morning 9:00 AM broadcast was missed during restart/update. Automatically delivering to all subscribers now!");
      await sendDailyBroadcast("morning");
    }
    // Evening window: between 7:00 PM and 11:00 PM (hour 19, 20, 21, 22)
    else if (hour >= 19 && hour < 23 && state.lastEveningDate !== todayStr) {
      addLog("⚡ [Catch-Up] Evening 7:00 PM broadcast was missed during restart/update. Automatically delivering to all subscribers now!");
      await sendDailyBroadcast("evening");
    }
  } catch (err) {
    addLog(`⚠️ Catch-up broadcast check warning: ${err.message}`);
  }
}

function setupDailyScheduler() {
  if (scheduledTasks.length > 0) {
    for (const task of scheduledTasks) {
      try { task.stop(); } catch (e) { }
    }
    scheduledTasks = [];
  }

  const config = loadConfig();
  if (config.enableDailyNotification === false) {
    addLog("ℹ️ Daily notifications are currently disabled in config.");
    return;
  }

  // 1. Morning Notification: 9:00 AM (09:00)
  const enableMorning = config.enableMorningNotification !== false;
  if (enableMorning) {
    const morningTime = config.morningScheduleTime || config.dailyScheduleTime || "09:00";
    const [mHourStr, mMinStr] = morningTime.split(":");
    const mHour = parseInt(mHourStr, 10) || 9;
    const mMin = parseInt(mMinStr, 10) || 0;
    const mCronExp = `${mMin} ${mHour} * * *`;

    addLog(`⏰ [1/2] Morning schedule active for ${String(mHour).padStart(2, "0")}:${String(mMin).padStart(2, "0")} (9:00 AM BD)`);
    const mTask = cron.schedule(mCronExp, async () => {
      addLog("🌅 Morning 9:00 AM schedule triggered! Broadcasting morning countdown to all subscribers...");
      await sendDailyBroadcast("morning");
    }, { timezone: "Asia/Dhaka" });
    scheduledTasks.push(mTask);
  }

  // 2. Evening Notification: 7:00 PM (19:00 / rat 7ta)
  const enableEvening = config.enableEveningNotification !== false;
  if (enableEvening) {
    const eveningTime = config.eveningScheduleTime || "19:00";
    const [eHourStr, eMinStr] = eveningTime.split(":");
    const eHour = parseInt(eHourStr, 10) || 19;
    const eMin = parseInt(eMinStr, 10) || 0;
    const eCronExp = `${eMin} ${eHour} * * *`;

    addLog(`⏰ [2/2] Evening schedule active for ${String(eHour).padStart(2, "0")}:${String(eMin).padStart(2, "0")} (7:00 PM BD)`);
    const eTask = cron.schedule(eCronExp, async () => {
      addLog("🌙 Evening 7:00 PM schedule triggered! Broadcasting evening revision & countdown to all subscribers...");
      await sendDailyBroadcast("evening");
    }, { timezone: "Asia/Dhaka" });
    scheduledTasks.push(eTask);
  }
}

// ==========================================
// MULTI-SESSION WHATSAPP BOT MANAGER
// ==========================================
function getSessionAuthDir(sessionId) {
  if (sessionId === "default") return path.join(__dirname, "../auth_info");
  return path.join(SESSIONS_ROOT_DIR, sessionId);
}

async function cleanupSession(sessionId, { clearDb = false } = {}) {
  const existing = sessions.get(sessionId);
  if (existing) {
    if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
    if (existing.expireTimer) clearTimeout(existing.expireTimer);
    if (existing.sock) {
      try {
        existing.sock.ev.removeAllListeners();
        existing.sock.end(undefined);
      } catch (e) {}
    }
    sessions.delete(sessionId);
  }
  const authDir = getSessionAuthDir(sessionId);
  try {
    if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
  } catch (e) {}
  if (clearDb) {
    await clearSessionAuthFromDb(sessionId);
  }
  refreshBotState();
}

async function startSession(sessionId = "default", { isTemporary = false } = {}) {
  const prev = sessions.get(sessionId);
  if (prev?.sock) {
    try {
      prev.sock.ev.removeAllListeners();
      prev.sock.end(undefined);
    } catch (e) {}
  }
  if (prev?.reconnectTimer) clearTimeout(prev.reconnectTimer);
  if (prev?.expireTimer) clearTimeout(prev.expireTimer);

  const authDir = getSessionAuthDir(sessionId);
  if (!isTemporary) {
    await restoreSessionAuthFromDb(sessionId, authDir);
  }
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  let version = [2, 3000, 1015901307];
  try {
    const fetched = await fetchLatestBaileysVersion();
    if (fetched && fetched.version) version = fetched.version;
  } catch (e) {}

  const sessionObj = {
    id: sessionId,
    authDir,
    sock: null,
    status: "connecting",
    qrDataUrl: null,
    userInfo: null,
    isReconnecting: false,
    reconnectTimer: null,
    expireTimer: null,
    isTemporary,
    connectedAt: null
  };
  sessions.set(sessionId, sessionObj);

  if (isTemporary) {
    // Auto-expire unscanned QR sessions after 2 minutes to protect server RAM
    sessionObj.expireTimer = setTimeout(() => {
      if (sessionObj.isTemporary && sessionObj.status !== "connected") {
        cleanupSession(sessionId, { clearDb: false });
      }
    }, 2 * 60 * 1000);
  }

  addLog(`🔄 Initializing WhatsApp session (${sessionId})...`);

  const sessionSock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: state,
    browser: ["UIU Exam Bot", "Chrome", "1.0.0"],
    syncFullHistory: false
  });
  sessionObj.sock = sessionSock;

  sessionSock.ev.on("creds.update", async () => {
    try {
      await saveCreds();
      if (!sessionObj.isTemporary || sessionObj.status === "connected") {
        await syncSessionAuthToDb(sessionId, authDir);
      }
    } catch (e) {
      console.error(`Auth sync error (${sessionId}):`, e.message);
    }
  });

  sessionSock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      sessionObj.status = "qr_ready";
      try {
        sessionObj.qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        if (sessionId === "default") {
          const qrPath = path.join(__dirname, "../qr.png");
          await QRCode.toFile(qrPath, qr, { width: 400 });
        }
      } catch (err) {
        console.error("QR Code image generation error", err);
      }

      if (sessionId === "default" && !qrPrintedInTerminal) {
        console.log("\n" + "=".repeat(56));
        console.log("📲 SCAN THIS QR CODE WITH YOUR WHATSAPP TO LINK BOT:");
        qrcodeTerminal.generate(qr, { small: true });
        console.log("=".repeat(56) + "\n");
        qrPrintedInTerminal = true;
      }
      refreshBotState();
    }

    if (connection === "open") {
      sessionObj.status = "connected";
      sessionObj.qrDataUrl = null;
      sessionObj.isTemporary = false;
      sessionObj.isReconnecting = false;
      sessionObj.connectedAt = new Date().toISOString();
      if (sessionObj.expireTimer) {
        clearTimeout(sessionObj.expireTimer);
        sessionObj.expireTimer = null;
      }
      if (sessionObj.reconnectTimer) {
        clearTimeout(sessionObj.reconnectTimer);
        sessionObj.reconnectTimer = null;
      }

      const phone = sessionSock.user.id.split(":")[0].split("@")[0];
      sessionObj.userInfo = {
        id: sessionSock.user.id,
        name: sessionSock.user.name || "UIU Student",
        phone
      };

      // Deduplicate: if this phone already had an older session, clean up the old one
      for (const [otherId, other] of sessions.entries()) {
        if (otherId !== sessionId && other.userInfo?.phone === phone) {
          await cleanupSession(otherId, { clearDb: true });
        }
      }

      await syncSessionAuthToDb(sessionId, authDir);
      refreshBotState();

      addLog(`✅ Connected +${phone} (session: ${sessionId} | total connected: ${getConnectedSessions().length})`);
      if (scheduledTasks.length === 0) {
        setupDailyScheduler();
      }
      checkAndSendMissedBroadcast();
    }

    if (connection === "close") {
      sessionObj.status = "disconnected";
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      addLog(`⚠️ Session ${sessionId} closed (${statusCode || "unknown"}). Reconnecting: ${shouldReconnect}`);

      if (sessionObj.isTemporary) {
        await cleanupSession(sessionId, { clearDb: false });
        return;
      }

      if (shouldReconnect) {
        if (!sessionObj.isReconnecting) {
          sessionObj.isReconnecting = true;
          sessionObj.reconnectTimer = setTimeout(() => {
            sessionObj.isReconnecting = false;
            startSession(sessionId, { isTemporary: false });
          }, 4000);
        }
      } else {
        await cleanupSession(sessionId, { clearDb: true });
        if (sessionId === "default") {
          qrPrintedInTerminal = false;
          setTimeout(() => startSession("default"), 3000);
        }
      }
      refreshBotState();
    }
  });

  // Strict Self-Only Mode per session: NEVER replies to public groups or other people
  sessionSock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;
      if (botSentIds.has(msg.key.id)) continue;

      const remoteJid = msg.key.remoteJid;
      if (!isSessionSelfJid(sessionSock, remoteJid) && !isSessionSelfJid(sessionSock, msg.key.remoteJidAlt)) continue;

      const rawText = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ""
      ).trim();

      const text = sanitizeInput(rawText, 500);
      if (!text || text.includes("UIU Exam Countdown Bot")) continue;

      const rateCheck = checkUserRateLimit(remoteJid);
      if (!rateCheck.allowed) continue;

      const lower = text.toLowerCase();
      addLog(`📩 Self-chat command (${sessionId}): "${text}"`);

      const status = getCountdownStatus();
      let reply = "";
      if (lower === "!test" || lower === "test") {
        reply = formatDailyBroadcast(status);
      } else if (lower.includes("routine") || lower.includes("calendar")) {
        reply = formatRoutineReply(loadCalendarData());
      } else if (lower.includes("installment") || lower.includes("fee") || lower.includes("kisti")) {
        reply = formatInstallmentsReply(status);
      } else if (lower.includes("mid")) {
        reply = formatCountdownReply(status, "mid");
      } else if (lower.includes("final")) {
        reply = formatCountdownReply(status, "final");
      } else {
        reply = formatWelcomeReply(status);
      }

      const sent = await sessionSock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
      trackSentMessage(sent);
      addLog(`✅ Replied in self-chat (${sessionId}) for "${text}"`);
    }
  });

  return sessionSock;
}

function createPairingSession() {
  // Cap pending unscanned QR sessions at 5 to avoid RAM spikes
  const pending = Array.from(sessions.values()).filter(s => s.isTemporary && s.status !== "connected");
  if (pending.length >= 5) {
    cleanupSession(pending[0].id, { clearDb: false });
  }
  const sessionId = `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  startSession(sessionId, { isTemporary: true }).catch(err => {
    addLog(`⚠️ Pairing session error (${sessionId}): ${err.message}`);
  });
  return sessionId;
}

function getSessionStatus(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return { exists: false, status: "expired", qrDataUrl: null, userInfo: null };
  return {
    exists: true,
    status: s.status,
    qrDataUrl: s.qrDataUrl,
    userInfo: s.userInfo
  };
}

async function startWhatsAppBot() {
  setupDailyScheduler();
  const dbIds = await listSavedSessionIds();
  const localIds = [];
  if (fs.existsSync(SESSIONS_ROOT_DIR)) {
    for (const name of fs.readdirSync(SESSIONS_ROOT_DIR)) {
      if (fs.statSync(path.join(SESSIONS_ROOT_DIR, name)).isDirectory()) {
        localIds.push(name);
      }
    }
  }

  const allIds = Array.from(new Set([...dbIds, ...localIds]));
  if (allIds.length === 0) {
    return startSession("default");
  }

  for (const sid of allIds) {
    await startSession(sid, { isTemporary: false });
  }
  return sessions.get(allIds[0])?.sock || null;
}

async function unlinkWhatsApp() {
  for (const sid of Array.from(sessions.keys())) {
    await cleanupSession(sid, { clearDb: true });
  }
  addLog("ℹ️ All linked WhatsApp sessions unlinked successfully.");
  return true;
}

module.exports = {
  startWhatsAppBot,
  createPairingSession,
  getSessionStatus,
  unlinkWhatsApp,
  broadcastToSubscribers,
  broadcastScheduleUpdate,
  sendDailyBroadcast,
  setupDailyScheduler,
  syncSubscribersFromDatabase,
  loadConfig,
  loadSubscribers,
  saveSubscribers,
  addSubscriber,
  removeSubscriber,
  botState
};

