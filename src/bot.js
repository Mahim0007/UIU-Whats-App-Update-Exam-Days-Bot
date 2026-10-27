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
  } catch (e) {}
  return { lastMorningDate: null, lastEveningDate: null };
}

function saveBroadcastState(state) {
  try {
    const dir = path.dirname(BROADCAST_STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BROADCAST_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {}
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

let sock = null;
let scheduledTasks = [];
let qrPrintedInTerminal = false;
let isReconnecting = false;
let reconnectTimer = null;

/**
 * Sync and merge subscribers directly from PostgreSQL database.
 * Guarantees that even across restarts or code updates, every subscriber persists for life!
 */
async function syncSubscribersFromDatabase() {
  try {
    const dbSubs = await getActiveSubscribers();
    if (dbSubs && dbSubs.length > 0) {
      const current = loadSubscribers();
      const map = new Map();

      // Preserve self/admin
      for (const s of current) {
        if (s.jid === "self") map.set("self", s);
      }

      for (const s of dbSubs) {
        map.set(s.jid, {
          jid: s.jid,
          name: s.name,
          phone: s.phone,
          type: s.type || (s.jid.endsWith("@g.us") ? "group" : "individual"),
          subscribedAt: s.subscribedAt || new Date().toISOString()
        });
      }

      const merged = Array.from(map.values());
      saveSubscribers(merged);
      botState.subscribers = merged;
      return merged;
    }
  } catch (err) {
    console.error("Failed to sync subscribers from PostgreSQL:", err.message);
  }
  return loadSubscribers();
}

// ==========================================
// BROADCAST TO ALL SUBSCRIBERS
// ==========================================
async function broadcastToSubscribers(messageText, options = {}) {
  if (!sock || botState.status !== "connected") {
    addLog("❌ Cannot broadcast: WhatsApp bot is not connected.");
    return { success: false, error: "Not connected to WhatsApp" };
  }

  // Strict Security Safety Check: Prevent broadcasting unethical/malicious content
  const safetyCheck = validateNoticeContent("Broadcast", messageText);
  if (!safetyCheck.safe) {
    addLog(`🚨 Blocked unsafe broadcast attempt: ${safetyCheck.reason}`);
    return { success: false, error: safetyCheck.reason };
  }

  // Always sync fresh subscribers from PostgreSQL database
  const subscribers = await syncSubscribersFromDatabase();
  if (subscribers.length === 0) {
    addLog("⚠️ No subscribers found in list.");
    return { success: false, error: "No subscribers" };
  }

  addLog(`📢 Starting broadcast to ${subscribers.length} WhatsApp subscriber(s)...`);

  // Resilient Connection Wait: If socket is momentarily reconnecting during an update, wait up to 10s
  if (!sock || botState.status !== "connected") {
    addLog("⏳ WhatsApp socket temporarily reconnecting... waiting up to 10 seconds before broadcasting...");
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (sock && botState.status === "connected") break;
    }
  }

  if (!sock || botState.status !== "connected") {
    addLog("❌ Broadcast deferred: WhatsApp bot is currently reconnecting.");
    return { success: false, error: "Bot is not connected to WhatsApp" };
  }

  let deliveredCount = 0;
  let failedCount = 0;
  const selfJid = sock.user?.id ? `${sock.user.id.split(":")[0]}@s.whatsapp.net` : null;

  for (const sub of subscribers) {
    let targetJid = sub.jid;
    if (targetJid === "self") {
      if (!selfJid) {
        failedCount++;
        continue;
      }
      targetJid = selfJid;
    }

    let sent = false;
    // Resilient per-subscriber retry (2 attempts) so network blips during updates don't drop messages
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await sock.sendMessage(targetJid, { text: messageText });
        deliveredCount++;
        sent = true;
        break;
      } catch (err) {
        if (attempt === 2) {
          addLog(`❌ Failed sending to ${sub.name || sub.jid}: ${err.message}`);
          failedCount++;
        } else {
          await new Promise(res => setTimeout(res, 400));
        }
      }
    }

    if (sent) {
      // Safe delay between deliveries (300ms) to avoid spam triggers
      await new Promise(res => setTimeout(res, 300));
    }
  }

  const status = getCountdownStatus();
  botState.lastBroadcast = {
    time: new Date().toLocaleString(),
    deliveredCount,
    failedCount,
    totalSubscribers: subscribers.length,
    phase: status.phase,
    midRemaining: status.midProgress.remainingDays,
    finalRemaining: status.finalProgress.remainingDays
  };

  addLog(`✅ Broadcast complete! Delivered: ${deliveredCount}, Failed: ${failedCount}`);
  return {
    success: deliveredCount > 0,
    deliveredCount,
    failedCount,
    totalSubscribers: subscribers.length
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
      try { task.stop(); } catch (e) {}
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

    addLog(`⏰ [1/2] Morning schedule active for ${String(mHour).padStart(2, "0")}:${String(mMin).padStart(2, "0")} (9:00 AM)`);
    const mTask = cron.schedule(mCronExp, async () => {
      addLog("🌅 Morning 9:00 AM schedule triggered! Broadcasting morning countdown to all subscribers...");
      await sendDailyBroadcast("morning");
    });
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

    addLog(`⏰ [2/2] Evening schedule active for ${String(eHour).padStart(2, "0")}:${String(eMin).padStart(2, "0")} (7:00 PM)`);
    const eTask = cron.schedule(eCronExp, async () => {
      addLog("🌙 Evening 7:00 PM schedule triggered! Broadcasting evening revision & countdown to all subscribers...");
      await sendDailyBroadcast("evening");
    });
    scheduledTasks.push(eTask);
  }
}

// ==========================================
// MAIN WHATSAPP BOT INITIALIZATION
// ==========================================
async function startWhatsAppBot() {
  // 1. Clean up existing socket and listeners before starting
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch (e) {}
    sock = null;
  }

  const authDir = path.join(__dirname, "../auth_info");
  await restoreAuthFromDb(authDir);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  
  let version = [2, 3000, 1015901307];
  try {
    const fetched = await fetchLatestBaileysVersion();
    if (fetched && fetched.version) version = fetched.version;
  } catch (e) {
    // fallback
  }

  botState.status = "connecting";
  addLog("🔄 Initializing WhatsApp Connection (Baileys)...");

  sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: state,
    browser: ["UIU Exam Bot", "Chrome", "1.0.0"],
    syncFullHistory: false
  });

  sock.ev.on("creds.update", async () => {
    try {
      await saveCreds();
      await syncAllAuthFilesToDb(authDir);
    } catch (e) {
      console.error("Auth sync error:", e.message);
    }
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      botState.status = "qr_ready";
      botState.qrRaw = qr;
      
      try {
        botState.qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        const qrPath = path.join(__dirname, "../qr.png");
        await QRCode.toFile(qrPath, qr, { width: 400 });
      } catch (err) {
        console.error("QR Code image generation error", err);
      }

      // Display QR code in terminal ONLY ONCE (no spamming on 20s token refreshes)
      if (!qrPrintedInTerminal) {
        console.log("\n" + "=".repeat(56));
        console.log("📲 SCAN THIS QR CODE WITH YOUR WHATSAPP TO LINK BOT:");
        console.log("👉 Go to WhatsApp > Settings (or 3 dots) > Linked Devices");
        console.log("👉 Tap 'Link a Device' and scan the QR code below");
        console.log("⚠️ You only need to scan this ONCE. Session will be saved!");
        console.log("=".repeat(56));
        qrcodeTerminal.generate(qr, { small: true });
        console.log("=".repeat(56));
        console.log("🌐 Visual Web Dashboard: http://localhost:3000");
        console.log("=".repeat(56) + "\n");
        qrPrintedInTerminal = true;
        addLog("📲 QR Code displayed. Scan once from WhatsApp > Linked Devices.");
      } else {
        // Silently update background token without re-printing duplicate QR to terminal
        addLog("🔄 QR token refreshed in background. Waiting for scan...");
      }
    }

    if (connection === "open") {
      botState.status = "connected";
      botState.qrDataUrl = null;
      botState.qrRaw = null;
      qrPrintedInTerminal = false;
      isReconnecting = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      botState.userInfo = {
        id: sock.user.id,
        name: sock.user.name || "UIU Student",
        phone: sock.user.id.split(":")[0]
      };

      // Sync lifetime subscribers directly from PostgreSQL
      await syncSubscribersFromDatabase();

      console.log("\n🎉 ==================================================");
      console.log(`✅ WHATSAPP BOT CONNECTED SUCCESSFULLY!`);
      console.log(`👤 Logged in as: +${botState.userInfo.phone}`);
      console.log(`👥 Lifetime Subscribers in PostgreSQL: ${botState.subscribers.length}`);
      console.log(`🚀 Ready to deliver exam countdown alerts!`);
      console.log("====================================================\n");
      addLog(`✅ Connected as +${botState.userInfo.phone} (${botState.subscribers.length} active subscribers)`);

      // Setup daily morning and evening cron
      setupDailyScheduler();

      // Check and catch up any missed broadcast if bot was restarted during schedule window
      checkAndSendMissedBroadcast();
    }

    if (connection === "close") {
      botState.status = "disconnected";
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      addLog(`⚠️ Connection closed (${statusCode || "unknown"}). Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        if (!isReconnecting) {
          isReconnecting = true;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            isReconnecting = false;
            startWhatsAppBot();
          }, 4000);
        }
      } else {
        qrPrintedInTerminal = false;
        await clearAuthFromDb();
        try {
          if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
          }
        } catch (e) {}
        addLog("❌ WhatsApp session ended or logged out. Generating new QR code in 3 seconds...");
        setTimeout(() => {
          startWhatsAppBot();
        }, 3000);
      }
    }
  });

  // Incoming Messages Handler
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;
      
      // CRITICAL: Ignore messages sent by the bot/linked account to avoid infinite echo loops
      if (msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.includes("@broadcast")) continue;

      // Security: Rate Limiting & Anti-Flood Protection per User
      const rateCheck = checkUserRateLimit(remoteJid);
      if (!rateCheck.allowed) {
        if (rateCheck.isFirstWarning) {
          addLog(`⚠️ Rate limit triggered for ${remoteJid} (Spam prevention)`);
          try {
            await sock.sendMessage(remoteJid, {
              text: "⚠️ *Slow down!* Please wait a few seconds before sending another message to prevent spamming."
            }, { quoted: msg });
          } catch (e) {}
        }
        continue;
      }

      // Extract and sanitize text content (Anti-Injection & Buffer-Overflow Guard)
      const rawText = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ""
      ).trim();

      const text = sanitizeInput(rawText, 500);
      if (!text) continue;

      const isGroup = remoteJid.endsWith("@g.us");
      const senderName = msg.pushName || "Student";
      const senderPhone = remoteJid.replace(/[^0-9]/g, "");

      const cleanSenderName = sanitizeInput(senderName, 100);
      const cleanSenderPhone = sanitizeInput(senderPhone, 50);

      // Auto-register sender in subscriber store & PostgreSQL database
      addSubscriber(remoteJid, cleanSenderName, cleanSenderPhone);
      recordUser(remoteJid, cleanSenderName, cleanSenderPhone, isGroup ? "group" : "individual");

      // Log interaction in PostgreSQL database
      recordInteraction(remoteJid, cleanSenderName, cleanSenderPhone, text);

      const lower = text.toLowerCase();

      addLog(`📩 Message from ${remoteJid} (${cleanSenderName}): "${text}"`);

      // 1. OPTIONAL: UNSUBSCRIBE / STOP
      if (
        lower === "!unsubscribe" ||
        lower === "unsubscribe" ||
        lower === "stop" ||
        lower === "!stop" ||
        lower === "unsub"
      ) {
        removeSubscriber(remoteJid);
        updateUserStatus(remoteJid, "unsubscribed");
        const reply = `🔕 *Unsubscribed / আনসাবস্ক্রাইব করা হয়েছে!*\n\nআপনাকে দৈনিক স্বয়ংক্রিয় অ্যালার্ট থেকে বাদ দেওয়া হয়েছে।\nপুনরায় চালু করতে চাইলে যেকোনো সময় শুধু 'hi' লিখে মেসেজ পাঠালেই আবার সক্রিয় হয়ে যাবে।`;
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`🔕 Unsubscribed: ${remoteJid}`);
      }

      // 2. ADMIN BROADCAST TEST (Optional)
      else if (lower === "!test" || lower === "test") {
        const status = getCountdownStatus();
        const reply = formatDailyBroadcast(status);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`💬 Sent sample broadcast test to ${remoteJid}`);
      }

      // 3. ZERO-COMMAND WORKFLOW: ANY MESSAGE (HI / HELLO / TEXT)
      // Automatically subscribes the user permanently & sends full all-in-one daily status!
      else {
        addSubscriber(remoteJid, cleanSenderName, cleanSenderPhone);
        updateUserStatus(remoteJid, "subscribed");
        const status = getCountdownStatus();
        const reply = formatWelcomeReply(status);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`👋 User message received ("${text}"). Auto-subscribed & sent All-In-One status to ${remoteJid}`);
      }
    }
  });

  return sock;
}

async function unlinkWhatsApp() {
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch (e) {}
    sock = null;
  }
  botState.status = "disconnected";
  botState.userInfo = null;
  botState.qrDataUrl = null;
  const authDir = path.join(__dirname, "../auth_info");
  if (fs.existsSync(authDir)) {
    try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
  }
  await clearAuthFromDb();
  addLog("ℹ️ Personal WhatsApp account unlinked successfully.");
  return true;
}

module.exports = {
  startWhatsAppBot,
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

