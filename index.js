/**
 * UIU Fall 2026 Exam Countdown WhatsApp Bot
 * Main Application Entry Point
 */

const { startWhatsAppBot, loadConfig } = require("./src/bot");
const { startWebServer } = require("./src/server");
const { getCountdownStatus } = require("./src/calendar");
const { initDatabase } = require("./src/db");

// Initialize PostgreSQL database connection
initDatabase().catch(err => {
  console.error("⚠️ PostgreSQL initialization warning:", err.message);
});

console.clear();
console.log("==========================================================");
console.log("  🎓 UIU EXAM COUNTDOWN WHATSAPP BOT (FALL 2026)");
console.log("  🏛️ United International University");
console.log("==========================================================");

const status = getCountdownStatus();
console.log(`📅 Today: ${status.today}`);
console.log(`🎯 Active Exam Target: ${status.activeExam.title}`);
console.log(`📢 Status: ${status.activeExam.statusMessage}`);
console.log(`🗓️ Exam Dates: ${status.activeExam.dates}`);
console.log(`📊 Active Progression: ${status.activeExam.bar} (${status.activeExam.daysRemaining} days remaining)`);
console.log(`💡 Note: Only Mid-Term progression is shown now. Switches to Final once Mid ends!`);
console.log("==========================================================\n");

const config = loadConfig();
const port = config.webPort || 3000;

// 1. Start the visual Web Dashboard
startWebServer(port);

// 2. Start the WhatsApp Bot
startWhatsAppBot().catch((err) => {
  console.error("Fatal error starting WhatsApp Bot:", err);
});

// Handle termination signals
process.on("SIGINT", () => {
  console.log("\n🛑 Stopping UIU Exam Countdown Bot. Goodbye!");
  process.exit(0);
});
