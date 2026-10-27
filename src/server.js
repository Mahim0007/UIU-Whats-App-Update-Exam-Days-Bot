const express = require("express");
const path = require("path");
const fs = require("fs");
const {
  botState,
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
const { formatCustomAnnouncement } = require("./messages");

function startWebServer(port = 3000) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "../public")));

  // 1. API Status Endpoint
  app.get("/api/status", async (req, res) => {
    const countdown = getCountdownStatus();
    const calendar = loadCalendarData();
    const subscribers = loadSubscribers();
    const botPhone = botState.userInfo?.phone || "";
    const waLink = botPhone ? `https://wa.me/${botPhone}?text=Hi` : null;

    res.json({
      bot: {
        status: botState.status,
        userInfo: botState.userInfo,
        lastBroadcast: botState.lastBroadcast,
        qrDataUrl: botState.qrDataUrl,
        logs: botState.logs,
        waLink
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

  // 3. API to Broadcast Message to All WhatsApp Subscribers
  app.post("/api/broadcast", async (req, res) => {
    try {
      const { type = "countdown", title = "Important Notice", message = "" } = req.body;

      let messageText = "";
      if (type === "announcement" && message) {
        messageText = formatCustomAnnouncement(title, message);
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

  app.listen(port, () => {
    console.log(`🌐 Web Dashboard running at: http://localhost:${port}`);
  });
}

module.exports = { startWebServer };
