const express = require("express");
const path = require("path");
const fs = require("fs");
const {
  botState,
  startWhatsAppBot,
  unlinkWhatsApp,
  broadcastToSubscribers,
  broadcastScheduleUpdate,
  sendDailyBroadcast,
  setupDailyScheduler,
  loadConfig,
  loadSubscribers,
  addSubscriber,
  removeSubscriber
} = require("./bot");
const {
  getCountdownStatus,
  loadCalendarData,
  saveCalendarData
} = require("./calendar");
const {
  formatCustomAnnouncement,
  formatWelcomeReply,
  formatCountdownReply,
  formatRoutineReply,
  formatInstallmentsReply
} = require("./messages");

const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { validateNoticeContent, sanitizeInput } = require("./security");
const QRCode = require("qrcode");

function startWebServer(port = 3000) {
  const app = express();

  // 1. Security HTTP Headers (Anti-Clickjacking, Anti-Sniffing, Anti-XSS)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );

  // 2. Global Rate Limiter: Max 200 requests per minute
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    message: { success: false, error: "Too many requests. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use(globalLimiter);

  // 3. Broadcast Rate Limiter: Max 10 broadcasts per 5 minutes (prevents spam attacks)
  const broadcastLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: { success: false, error: "Broadcast limit reached. Please wait a few minutes." }
  });

  // Strict Body Parser Limit: Prevents JSON memory flood attacks
  app.use(express.json({ limit: "50kb" }));
  app.use(express.static(path.join(__dirname, "../public")));

  // Health check endpoints for Render and UptimeRobot
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/ping", (req, res) => {
    res.send("pong");
  });

  // Dedicated Web Message Box Page: Serves the full-screen interactive web chat app
  app.get("/chat", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/chat.html"));
  });

  // Direct Chat QR Code Image: Scannable by phone camera to open Web Chat Box directly!
  app.get("/qr/chat", async (req, res) => {
    const host = req.get("host") || "uiu-whats-app-update-exam-days-bot.onrender.com";
    const proto = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const link = `${proto}://${host}/chat`;
    try {
      const buffer = await QRCode.toBuffer(link, {
        width: 380,
        margin: 2,
        color: {
          dark: "#0b141a",
          light: "#ffffff"
        }
      });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=60");
      res.send(buffer);
    } catch (err) {
      res.status(500).send("Error generating QR");
    }
  });

  // Dedicated Full-Screen QR Code page for bot WhatsApp login / device linking
  app.get("/qr", (req, res) => {
    if (botState.status === "connected") {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Bot Connected</title>
          <style>
            body { background: #0b0f19; color: white; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; text-align: center; }
            .card { background: #161f30; padding: 30px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); max-width: 400px; }
            h2 { color: #22c55e; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>✅ WhatsApp Bot Connected!</h2>
            <p>Logged in as: <b>+${botState.userInfo?.phone || 'Active'}</b></p>
            <p style="color: #94a3b8;">Bot is running 24/7 online. No scan needed.</p>
            <a href="/" style="display: inline-block; margin-top: 15px; color: #38bdf8; text-decoration: none;">← Open Web Dashboard</a>
          </div>
        </body>
        </html>
      `);
    }

    if (botState.qrDataUrl) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="refresh" content="6">
          <title>Scan WhatsApp QR Code</title>
          <style>
            body { background: #0b0f19; color: white; font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; box-sizing: border-box; }
            .card { background: #161f30; padding: 26px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); max-width: 360px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
            img { background: white; padding: 12px; border-radius: 14px; width: 250px; height: 250px; display: block; margin: 0 auto; }
            h2 { color: #38bdf8; margin-top: 0; font-size: 1.3rem; }
            p { color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 15px 0 5px; }
            .guide { text-align: left; background: rgba(255,255,255,0.05); padding: 12px 16px; border-radius: 10px; margin-top: 15px; font-size: 13px; color: #94a3b8; }
            .guide b { color: #fff; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>📲 Scan WhatsApp QR</h2>
            <img src="${botState.qrDataUrl}" alt="WhatsApp QR Code" />
            <div class="guide">
              1. Open WhatsApp on your phone<br>
              2. Go to <b>Settings ➔ Linked Devices</b><br>
              3. Tap <b>Link a Device</b> & scan this code
            </div>
            <p style="color: #64748b; font-size: 11px;">🔄 Auto-refreshes every 6 seconds</p>
          </div>
        </body>
        </html>
      `);
    }

    // If bot is disconnected and no QR is generated yet, proactively trigger startWhatsAppBot
    if (botState.status === "disconnected") {
      try {
        startWhatsAppBot();
      } catch (e) {}
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="refresh" content="3">
        <title>Generating QR...</title>
        <style>
          body { background: #0b0f19; color: white; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; text-align: center; }
        </style>
      </head>
      <body>
        <div>
          <h2>🔄 Initializing WhatsApp Connection...</h2>
          <p style="color: #94a3b8;">Generating QR Code, please wait 3 seconds...</p>
        </div>
      </body>
      </html>
    `);
  });

  // Reconnection trigger endpoint
  app.post("/api/reconnect", (req, res) => {
    try {
      startWhatsAppBot();
      res.json({ success: true, message: "Reconnection process initiated" });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Web Interactive Chat Endpoint: Instant interactive message box right on website!
  app.post("/api/chat", (req, res) => {
    const rawMessage = (req.body.message || "").trim();
    const status = getCountdownStatus();
    const lower = rawMessage.toLowerCase();

    let reply = "";
    if (lower.includes("routine") || lower.includes("calendar")) {
      const calData = loadCalendarData();
      reply = formatRoutineReply(calData);
    } else if (lower.includes("installment") || lower.includes("fee") || lower.includes("kisti")) {
      reply = formatInstallmentsReply(status);
    } else if (lower.includes("mid")) {
      reply = formatCountdownReply(status, "mid");
    } else if (lower.includes("final")) {
      reply = formatCountdownReply(status, "final");
    } else {
      // Default: clean all-in-one status on "hi" or anything else
      reply = formatWelcomeReply(status);
    }

    res.json({
      success: true,
      sender: "UIU Bot",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      reply
    });
  });

  // Unlink WhatsApp account endpoint
  app.post("/api/unlink-whatsapp", async (req, res) => {
    try {
      await unlinkWhatsApp();
      res.json({ success: true, message: "WhatsApp unlinked successfully" });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 1. API Status Endpoint
  app.get("/api/status", async (req, res) => {
    const countdown = getCountdownStatus();
    const calendar = loadCalendarData();
    const subscribers = loadSubscribers();
    const host = req.get("host") || "uiu-whats-app-update-exam-days-bot.onrender.com";
    const proto = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const chatLink = `${proto}://${host}/chat`;

    res.json({
      bot: {
        status: botState.status,
        userInfo: botState.userInfo,
        lastBroadcast: botState.lastBroadcast,
        qrDataUrl: botState.qrDataUrl,
        logs: botState.logs,
        waLink: chatLink,
        chatLink
      },
      config: loadConfig(),
      countdown,
      calendar,
      subscribers
    });
  });


  // 2. API to update Calendar / Exam Dates & Auto-Update WhatsApp
  app.post("/api/calendar", async (req, res) => {
    try {
      const { dates, events, autoBroadcast = true, changeNote = "" } = req.body;
      const current = loadCalendarData();

      if (dates) {
        current.dates = {
          ...current.dates,
          ...dates
        };
      }

      if (Array.isArray(events)) {
        current.events = events;
      }

      // Save to data/calendar.json
      saveCalendarData(current);

      // Re-calculate live status
      const updatedStatus = getCountdownStatus();

      let broadcastResult = null;
      if (autoBroadcast) {
        broadcastResult = await broadcastScheduleUpdate(changeNote);
      }

      res.json({
        success: true,
        countdown: updatedStatus,
        calendar: current,
        broadcast: broadcastResult
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. API to Broadcast Message to All WhatsApp Subscribers (Rate-Limited & Validated)
  app.post("/api/broadcast", broadcastLimiter, async (req, res) => {
    try {
      const { type = "countdown", title = "Important Notice", message = "" } = req.body;

      let messageText = "";
      if (type === "announcement" && message) {
        // Strict Content Validation: Blocks spam, phishing, and malicious payloads
        const safetyCheck = validateNoticeContent(title, message);
        if (!safetyCheck.safe) {
          return res.status(400).json({ success: false, error: safetyCheck.reason });
        }
        messageText = formatCustomAnnouncement(sanitizeInput(title, 100), sanitizeInput(message, 2500));
      } else {
        const status = getCountdownStatus();
        const { formatDailyBroadcast } = require("./messages");
        messageText = formatDailyBroadcast(status);
      }

      const result = await broadcastToSubscribers(messageText);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });


  // 4. API to manage subscribers
  app.post("/api/subscribers", async (req, res) => {
    try {
      const { action = "add", jid, name, phone } = req.body;
      if (!jid) return res.status(400).json({ success: false, error: "Missing jid" });

      const { recordUser, updateUserStatus } = require("./db");
      const isGroup = jid.endsWith("@g.us");

      if (action === "add") {
        addSubscriber(jid, name, phone);
        await recordUser(jid, name, phone, isGroup ? "group" : "individual");
        await updateUserStatus(jid, "subscribed");
      } else if (action === "remove") {
        removeSubscriber(jid);
        await updateUserStatus(jid, "unsubscribed");
      }

      res.json({ success: true, subscribers: loadSubscribers() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });


  // 5. API to update settings
  app.post("/api/settings", (req, res) => {
    try {
      const {
        targetPhone,
        dailyScheduleTime,
        morningScheduleTime,
        eveningScheduleTime,
        enableDailyNotification,
        enableMorningNotification,
        enableEveningNotification,
        autoBroadcastOnUpdate
      } = req.body;

      const current = loadConfig();
      if (targetPhone !== undefined) current.targetPhone = targetPhone;
      if (dailyScheduleTime !== undefined) current.dailyScheduleTime = dailyScheduleTime;
      if (morningScheduleTime !== undefined) current.morningScheduleTime = morningScheduleTime;
      if (eveningScheduleTime !== undefined) current.eveningScheduleTime = eveningScheduleTime;
      if (enableDailyNotification !== undefined) current.enableDailyNotification = enableDailyNotification;
      if (enableMorningNotification !== undefined) current.enableMorningNotification = enableMorningNotification;
      if (enableEveningNotification !== undefined) current.enableEveningNotification = enableEveningNotification;
      if (autoBroadcastOnUpdate !== undefined) current.autoBroadcastOnUpdate = autoBroadcastOnUpdate;

      const configPath = path.join(__dirname, "../config.json");
      fs.writeFileSync(configPath, JSON.stringify(current, null, 2), "utf-8");

      setupDailyScheduler();
      res.json({ success: true, config: current });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. Test Broadcast endpoint
  app.post("/api/broadcast-test", async (req, res) => {
    const status = getCountdownStatus();
    const { formatDailyBroadcast } = require("./messages");
    const result = await broadcastToSubscribers(formatDailyBroadcast(status));
    res.json(result);
  });

  // 7. Database API: Users list & Metrics
  app.get("/api/database/users", async (req, res) => {
    try {
      const { getAllUsers, getDatabaseMetrics } = require("./db");
      const users = await getAllUsers();
      const metrics = await getDatabaseMetrics();
      res.json({ success: true, metrics, users });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 8. Database API: Recent interaction logs
  app.get("/api/database/logs", async (req, res) => {
    try {
      const { getRecentLogs } = require("./db");
      const logs = await getRecentLogs(100);
      res.json({ success: true, logs });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 9. Database API: Export all student users to CSV (Excel format)
  app.get("/api/database/export-csv", async (req, res) => {
    try {
      const { getAllUsers } = require("./db");
      const users = await getAllUsers();
      const header = "Phone Number,Name,Chat Type,Status,Total Messages,First Seen,Last Active,WhatsApp JID\n";
      const rows = users.map(u => 
        `"${u.phone}","${(u.name || '').replace(/"/g, '""')}","${u.chat_type}","${u.status}",${u.total_messages},"${u.first_seen}","${u.last_active}","${u.jid}"`
      ).join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=uiu_bot_users.csv");
      res.send(header + rows);
    } catch (err) {
      res.status(500).send("Export error: " + err.message);
    }
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`🔒 Web Dashboard running on port: ${port}`);
  });
}


module.exports = { startWebServer };
