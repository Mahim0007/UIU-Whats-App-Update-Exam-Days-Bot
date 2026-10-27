/**
 * UIU Academic Calendar & Smart 1-at-a-Time Exam Progression Engine
 * Active phase:
 *  - During pre-mid and mid: ONLY Mid-Term Progression is active.
 *  - After mid ends: ONLY Final Exam Progression is active.
 *  - After final ends: Trimester completed.
 */

const fs = require("fs");
const path = require("path");

const CALENDAR_PATH = path.join(__dirname, "../data/calendar.json");

function parseDate(dateStr) {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0);
}

function formatDate(date) {
  const options = { month: "short", day: "numeric", year: "numeric" };
  return date.toLocaleDateString("en-US", options);
}

function createProgressBar(percent, length = 10) {
  const safePercent = Math.min(100, Math.max(0, percent));
  const filledLength = Math.round((safePercent / 100) * length);
  const emptyLength = Math.max(0, length - filledLength);
  const filled = "█".repeat(filledLength);
  const empty = "░".repeat(emptyLength);
  return `[${filled}${empty}] ${safePercent}%`;
}

function loadCalendarData() {
  try {
    if (fs.existsSync(CALENDAR_PATH)) {
      const raw = fs.readFileSync(CALENDAR_PATH, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error("Failed to read data/calendar.json:", err.message);
  }

  return {
    university: "United International University (UIU)",
    trimester: "Fall 2026 Trimester",
    dates: {
      classesBegin: "2026-10-27",
      midStart: "2026-12-05",
      midEnd: "2026-12-12",
      finalStart: "2027-01-25",
      finalEnd: "2027-02-01"
    },
    events: [],
    motivationalQuotes: ["Keep studying hard! Success is near! 🎓"]
  };
}

function saveCalendarData(updatedData) {
  const dir = path.dirname(CALENDAR_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CALENDAR_PATH, JSON.stringify(updatedData, null, 2), "utf-8");
  return updatedData;
}

function getCountdownStatus(targetNow = new Date()) {
  const data = loadCalendarData();
  const dates = data.dates || {};

  const now = new Date(targetNow.getFullYear(), targetNow.getMonth(), targetNow.getDate(), 0, 0, 0);
  
  const trimStart = parseDate(dates.classesBegin || "2026-10-27");
  const midStart = parseDate(dates.midStart || "2026-12-05");
  const midEnd = parseDate(dates.midEnd || "2026-12-12");
  const finalStart = parseDate(dates.finalStart || "2027-01-25");
  const finalEnd = parseDate(dates.finalEnd || "2027-02-01");

  // Mid calculations
  const midTotalDays = Math.max(1, Math.round((midStart - trimStart) / (1000 * 60 * 60 * 24)));
  const midElapsedDays = Math.max(0, Math.min(midTotalDays, Math.round((now - trimStart) / (1000 * 60 * 60 * 24))));
  const midRemainingDays = Math.max(0, Math.round((midStart - now) / (1000 * 60 * 60 * 24)));
  const midPercent = Math.min(100, Math.max(0, Math.round((midElapsedDays / midTotalDays) * 100)));

  // Final calculations (from midEnd to finalStart)
  const finalTotalDays = Math.max(1, Math.round((finalStart - midEnd) / (1000 * 60 * 60 * 24)));
  const finalElapsedDays = Math.max(0, Math.min(finalTotalDays, Math.round((now - midEnd) / (1000 * 60 * 60 * 24))));
  const finalRemainingDays = Math.max(0, Math.round((finalStart - now) / (1000 * 60 * 60 * 24)));
  const finalPercent = Math.min(100, Math.max(0, Math.round((finalElapsedDays / finalTotalDays) * 100)));

  // =========================================================================
  // SMART 1-AT-A-TIME PROGRESSION DETERMINATION
  // Rule: When in Mid period, ONLY Mid progression exists.
  //       When Mid is done (after midEnd), ONLY Final progression exists.
  // =========================================================================
  let activeExam = null;
  let nextExamPreview = null;

  if (now < midStart) {
    // 1. PRE-MID PHASE
    activeExam = {
      type: "mid",
      title: "Mid-Term Exam",
      phase: "PRE_MID",
      statusMessage: `Mid coming ${midRemainingDays} ${midRemainingDays === 1 ? "day" : "days"} remaining`,
      dates: `${formatDate(midStart)} - ${formatDate(midEnd)}`,
      totalDays: midTotalDays,
      elapsedDays: midElapsedDays,
      remainingDays: midRemainingDays,
      daysRemaining: midRemainingDays,
      percent: midPercent,
      bar: createProgressBar(midPercent),
      isOngoing: false,
      isPassed: false
    };

    nextExamPreview = {
      type: "final",
      title: "Final Exam",
      dates: `${formatDate(finalStart)} - ${formatDate(finalEnd)}`,
      startsInDays: Math.round((finalStart - now) / (1000 * 60 * 60 * 24))
    };
  } else if (now >= midStart && now <= midEnd) {
    // 2. DURING MID-TERM PHASE
    const dayOfMid = Math.round((now - midStart) / (1000 * 60 * 60 * 24)) + 1;
    const totalMidSpan = Math.round((midEnd - midStart) / (1000 * 60 * 60 * 24)) + 1;

    activeExam = {
      type: "mid",
      title: "Mid-Term Exam",
      phase: "DURING_MID",
      statusMessage: `Mid-Term Exam is ongoing! (Day ${dayOfMid} of ${totalMidSpan})`,
      dates: `${formatDate(midStart)} - ${formatDate(midEnd)}`,
      totalDays: midTotalDays,
      elapsedDays: midTotalDays,
      remainingDays: 0,
      daysRemaining: 0,
      percent: 100,
      bar: createProgressBar(100),
      isOngoing: true,
      isPassed: false
    };

    nextExamPreview = {
      type: "final",
      title: "Final Exam",
      dates: `${formatDate(finalStart)} - ${formatDate(finalEnd)}`,
      startsInDays: Math.round((finalStart - now) / (1000 * 60 * 60 * 24))
    };
  } else if (now > midEnd && now < finalStart) {
    // 3. MID IS OVER -> AUTOMATICALLY SWITCH TO FINAL EXAM PHASE
    const daysSinceMid = Math.round((now - midEnd) / (1000 * 60 * 60 * 24));
    const isFirstDayPostMid = daysSinceMid === 1;

    activeExam = {
      type: "final",
      title: "Final Exam",
      phase: "PRE_FINAL",
      statusMessage: `Final coming ${finalRemainingDays} ${finalRemainingDays === 1 ? "day" : "days"} remaining`,
      dates: `${formatDate(finalStart)} - ${formatDate(finalEnd)}`,
      totalDays: finalTotalDays,
      elapsedDays: finalElapsedDays,
      remainingDays: finalRemainingDays,
      daysRemaining: finalRemainingDays,
      percent: finalPercent,
      bar: createProgressBar(finalPercent),
      isOngoing: false,
      isPassed: false,
      isFirstDayPostMid
    };

    nextExamPreview = null;
  } else if (now >= finalStart && now <= finalEnd) {
    // 4. DURING FINAL EXAM PHASE
    const dayOfFinal = Math.round((now - finalStart) / (1000 * 60 * 60 * 24)) + 1;
    const totalFinalSpan = Math.round((finalEnd - finalStart) / (1000 * 60 * 60 * 24)) + 1;

    activeExam = {
      type: "final",
      title: "Final Exam",
      phase: "DURING_FINAL",
      statusMessage: `Final Exam is ongoing! (Day ${dayOfFinal} of ${totalFinalSpan})`,
      dates: `${formatDate(finalStart)} - ${formatDate(finalEnd)}`,
      totalDays: finalTotalDays,
      elapsedDays: finalTotalDays,
      remainingDays: 0,
      daysRemaining: 0,
      percent: 100,
      bar: createProgressBar(100),
      isOngoing: true,
      isPassed: false
    };

    nextExamPreview = null;
  } else {
    // 5. POST TRIMESTER
    activeExam = {
      type: "completed",
      title: "Trimester Completed",
      phase: "POST_TRIMESTER",
      statusMessage: "Fall 2026 Trimester completed! Have a great semester break!",
      dates: "Spring 2027 begins Feb 9, 2027",
      totalDays: 0,
      elapsedDays: 0,
      remainingDays: 0,
      daysRemaining: 0,
      percent: 100,
      bar: createProgressBar(100),
      isOngoing: false,
      isPassed: true
    };

    nextExamPreview = null;
  }

  // Upcoming Events (Next 4)
  const events = data.events || [];
  const upcomingEvents = events
    .map(ev => {
      const evDate = parseDate(ev.date);
      const diff = Math.round((evDate - now) / (1000 * 60 * 60 * 24));
      return { ...ev, daysUntil: diff };
    })
    .filter(ev => ev.daysUntil >= 0)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 4);

  // Next Installment
  const nextInstallment = events
    .filter(ev => ev.type === "installment")
    .map(ev => {
      const evDate = parseDate(ev.date);
      const diff = Math.round((evDate - now) / (1000 * 60 * 60 * 24));
      return { ...ev, daysUntil: diff };
    })
    .filter(ev => ev.daysUntil >= 0)
    .sort((a, b) => a.daysUntil - b.daysUntil)[0] || null;

  // Daily Quote
  const quotes = data.motivationalQuotes && data.motivationalQuotes.length > 0 
    ? data.motivationalQuotes 
    : ["Stay focused, work hard, and make UIU proud! 🎓"];
  const dayIndex = Math.floor(now.getTime() / (1000 * 60 * 60 * 24));
  const quote = quotes[Math.abs(dayIndex) % quotes.length];

  return {
    today: formatDate(now),
    university: data.university,
    trimester: data.trimester,
    dates: data.dates,
    // Active Progression (Only 1 at a time!)
    activeExam,
    nextExamPreview,
    currentTarget: activeExam.title,
    phase: activeExam.phase,
    daysRemaining: activeExam.daysRemaining,
    examDates: activeExam.dates,
    statusMessage: activeExam.statusMessage,
    progressPercent: activeExam.percent,
    progressBar: activeExam.bar,
    activeType: activeExam.type,
    isFirstDayPostMid: Boolean(activeExam.isFirstDayPostMid),
    // Mid & Final details for compatibility with dashboard / widgets
    midProgress: {
      type: "mid",
      title: "Mid-Term Exam",
      dates: `${formatDate(midStart)} - ${formatDate(midEnd)}`,
      totalDays: midTotalDays,
      elapsedDays: midElapsedDays,
      remainingDays: midRemainingDays,
      percent: midPercent,
      bar: createProgressBar(midPercent),
      isOngoing: now >= midStart && now <= midEnd,
      isPassed: now > midEnd,
      statusMessage: now > midEnd ? "Mid-Term Exam Completed" : now >= midStart ? "Mid-Term Exam Ongoing" : `Mid coming ${midRemainingDays} days remaining`
    },
    finalProgress: {
      type: "final",
      title: "Final Exam",
      dates: `${formatDate(finalStart)} - ${formatDate(finalEnd)}`,
      totalDays: finalTotalDays,
      elapsedDays: finalElapsedDays,
      remainingDays: finalRemainingDays,
      percent: finalPercent,
      bar: createProgressBar(finalPercent),
      isOngoing: now >= finalStart && now <= finalEnd,
      isPassed: now > finalEnd,
      statusMessage: now > finalEnd ? "Trimester Completed" : now >= finalStart ? "Final Exam Ongoing" : `Final coming ${finalRemainingDays} days remaining`
    },
    // Secondary data
    upcomingEvents,
    nextInstallment,
    quote
  };
}

module.exports = {
  loadCalendarData,
  saveCalendarData,
  getCountdownStatus,
  createProgressBar,
  formatDate,
  parseDate
};
