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
  formatHelpReply,
  formatWelcomeReply
} = require("./messages");

const {
  recordUser,
  recordInteraction,
  updateUserStatus,
  getAllUsers,
  getActiveSubscribers,
  getDatabaseMetrics,
  getRecentLogs
} = require("./db");

const {
  checkUserRateLimit,
  sanitizeInput,
  validateNoticeContent
} = require("./security");



const SUBSCRIBERS_PATH = path.join(__dirname, "../data/subscribers.json");
const CONFIG_PATH = path.join(__dirname, "../config.json");

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

    try {
      await sock.sendMessage(targetJid, { text: messageText });
      deliveredCount++;
      // Safe delay between deliveries (300ms) to avoid spam triggers
      await new Promise(res => setTimeout(res, 300));
    } catch (err) {
      addLog(`❌ Failed sending to ${sub.name || sub.jid}: ${err.message}`);
      failedCount++;
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

// Daily scheduled broadcast (morning or evening)
async function sendDailyBroadcast(slot = "auto") {
  const status = getCountdownStatus();
  const messageText = formatDailyBroadcast(status, slot);
  return await broadcastToSubscribers(messageText);
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

  sock.ev.on("creds.update", saveCreds);

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
        addLog("❌ Logged out from WhatsApp. Clear auth_info folder and restart bot to scan a new QR code.");
      }
    }
  });

  // Incoming Messages Handler
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;
      
      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.includes("@broadcast")) continue;

      // Security: Rate Limiting & Anti-Flood Protection per User
      const rateCheck = checkUserRateLimit(remoteJid);
      if (!rateCheck.allowed) {
        if (rateCheck.isFirstWarning) {
          addLog(`⚠️ Rate limit triggered for ${remoteJid} (Spam prevention)`);
          try {
            await sock.sendMessage(remoteJid, {
              text: "⚠️ *Slow down!* Please wait a few seconds before sending another command to prevent spamming."
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

      const cleanSenderName = sanitizeInput(senderName, 100);
      const cleanSenderPhone = sanitizeInput(senderPhone, 50);

      // Auto-register sender in subscriber store & PostgreSQL database
      addSubscriber(remoteJid, cleanSenderName, cleanSenderPhone);
      recordUser(remoteJid, cleanSenderName, cleanSenderPhone, isGroup ? "group" : "individual");

      // Log interaction in PostgreSQL database
      recordInteraction(remoteJid, cleanSenderName, cleanSenderPhone, text);

      const lower = text.toLowerCase();

      addLog(`📩 Message from ${remoteJid}: "${text}"`);

      // 1. DUAL COUNTDOWN (Default)
      if (
        lower === "!countdown" ||
        lower === "countdown" ||
        lower === "exam" ||
        lower === "!exam" ||
        lower === "exams"
      ) {
        const status = getCountdownStatus();
        const reply = formatCountdownReply(status, "all");
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`💬 Replied with Dual Countdown to ${remoteJid}`);
      }

      // 2. MID-TERM PROGRESSION & COUNTDOWN
      else if (
        lower === "!mid" ||
        lower === "mid" ||
        lower === "midterm" ||
        lower === "!midterm" ||
        lower === "mid-term" ||
        lower === "!mid-term"
      ) {
        const status = getCountdownStatus();
        const reply = formatCountdownReply(status, "mid");
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`💬 Replied with Mid-Term Progression to ${remoteJid}`);
      }

      // 3. FINAL EXAM PROGRESSION & COUNTDOWN
      else if (
        lower === "!final" ||
        lower === "final" ||
        lower === "finals" ||
        lower === "!finals" ||
        lower === "final-term"
      ) {
        const status = getCountdownStatus();
        const reply = formatCountdownReply(status, "final");
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`💬 Replied with Final Exam Progression to ${remoteJid}`);
      }

      // 4. ROUTINE & ACADEMIC CALENDAR
      else if (
        lower === "!routine" ||
        lower === "routine" ||
        lower === "calendar" ||
        lower === "!calendar"
      ) {
        const calendarData = loadCalendarData();
        const reply = formatRoutineReply(calendarData);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`💬 Replied with Routine to ${remoteJid}`);
      }

      // 5. TUITION INSTALLMENTS
      else if (
        lower === "!installments" ||
        lower === "installment" ||
        lower === "!installment" ||
        lower === "fee" ||
        lower === "!fee" ||
        lower === "fees"
      ) {
        const status = getCountdownStatus();
        const reply = formatInstallmentsReply(status);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`💬 Replied with Installments to ${remoteJid}`);
      }

      // 6. MOTIVATION QUOTE
      else if (lower === "!quote" || lower === "quote" || lower === "motivation") {
        const status = getCountdownStatus();
        const reply = `💡 *UIU Study Motivation:*\n\n"${status.quote}"\n\n_Keep pushing forward! Success is earned daily!_ 🌟`;
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`💬 Replied with Quote to ${remoteJid}`);
      }

      // 7. SUBSCRIBE TO ALERTS
      else if (lower === "!subscribe" || lower === "subscribe") {
        addSubscriber(remoteJid, senderName, senderPhone);
        updateUserStatus(remoteJid, "subscribed");
        const reply = `✅ *Subscribed Successfully!*\n\nYou will now receive automatic UIU exam countdown alerts every morning at 9:00 AM and evening at 7:00 PM.\n\n💬 _Type *!countdown* anytime to check current remaining days!_`;
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`✅ Subscriber confirmed: ${remoteJid}`);
      }

      // 8. UNSUBSCRIBE
      else if (lower === "!unsubscribe" || lower === "unsubscribe") {
        removeSubscriber(remoteJid);
        updateUserStatus(remoteJid, "unsubscribed");
        const reply = `🔕 *Unsubscribed!*\n\nYou will no longer receive automated daily countdown alerts. You can resubscribe anytime with *!subscribe*.`;
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`🔕 Unsubscribed: ${remoteJid}`);
      }

      // 9. TEST SAMPLE BROADCAST
      else if (lower === "!test" || lower === "test") {
        const status = getCountdownStatus();
        const reply = formatDailyBroadcast(status);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`💬 Sent sample broadcast test to ${remoteJid}`);
      }

      // 10. GREETING & LIFETIME SUBSCRIPTION ON "HI" / "START"
      else if (
        lower === "hi" ||
        lower === "hello" ||
        lower === "start" ||
        lower === "!start" ||
        lower === "hey" ||
        lower === "salam" ||
        lower === "assalamu alaikum" ||
        lower === "bot"
      ) {
        addSubscriber(remoteJid, senderName, senderPhone);
        updateUserStatus(remoteJid, "subscribed");
        const status = getCountdownStatus();
        const reply = formatWelcomeReply(status);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`👋 User started bot with "${text}" & permanently subscribed: ${remoteJid}`);
      }

      // 11. HELP / MENU
      else if (
        lower === "!help" ||
        lower === "help" ||
        lower === "menu" ||
        lower === "!menu" ||
        lower === "commands"
      ) {
        const reply = formatHelpReply();
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`💬 Replied with Help Menu to ${remoteJid}`);
      }

      // 12. CASUAL TEXT FALLBACK (FOR DIRECT INDIVIDUAL MESSAGES)
      else if (!isGroup) {
        addSubscriber(remoteJid, senderName, senderPhone);
        updateUserStatus(remoteJid, "subscribed");
        const status = getCountdownStatus();
        const reply = formatWelcomeReply(status);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        addLog(`💬 Handled private message from ${remoteJid} with Welcome & Countdown`);
      }
    }
  });

  return sock;
}

module.exports = {
  startWhatsAppBot,
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

