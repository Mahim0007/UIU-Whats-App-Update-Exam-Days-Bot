/**
 * UIU WhatsApp Bot Message Formatter
 * Ultra-clean, attractive, human-readable WhatsApp message templates.
 * Design rules:
 * - No star markers (*) or bullet dot clutter (•)
 * - Clear, elegant spacing with instant 2-second glanceability
 * - Concise, friendly, and professional for UIU students
 */

function formatDailyBroadcast(status, slot = "auto") {
  const currentHour = new Date().getHours();
  const isMorning = slot === "morning" || (slot === "auto" && currentHour < 14);
  const active = status.activeExam;
  const isMid = status.activeType === "mid";

  const slotTitle = isMorning
    ? (isMid ? "UIU Mid-Term Countdown (9 AM)" : "UIU Final Exam Countdown (9 AM)")
    : (isMid ? "UIU Mid-Term Revision Alert (7 PM)" : "UIU Final Revision Alert (7 PM)");

  // Today Special Event banner (compact 1-line if any)
  let todayAlert = "";
  if (status.todayEvents && status.todayEvents.length > 0) {
    const titles = status.todayEvents.map(e => e.title).join(", ");
    todayAlert = `\n🔥 Today: ${titles}\n`;
  }

  // Tuition fee installments (ultra clean lines)
  const now = (status && status.targetDate) ? new Date(status.targetDate) : new Date();
  const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

  const installments = [
    { name: "1st (40%)", dateStr: "2026-11-22", display: "22 Nov 2026" },
    { name: "2nd (70%)", dateStr: "2026-12-15", display: "15 Dec 2026" },
    { name: "3rd (100%)", dateStr: "2027-01-13", display: "13 Jan 2027" },
  ];

  const instLines = installments.map(inst => {
    const [y, m, d] = inst.dateStr.split("-").map(Number);
    const instDate = new Date(y, m - 1, d, 0, 0, 0);
    const diff = Math.round((instDate - todayZero) / (1000 * 60 * 60 * 24));
    let note = "";
    if (diff === 0) note = "আজ শেষ দিন!";
    else if (diff < 0) note = "Passed";
    else note = `${diff} দিন বাকি`;
    return `${inst.name} : ${inst.display} (${note})`;
  }).join("\n");

  // Upcoming events (filter out today events and show next 3)
  let upcomingLines = "";
  if (status.upcomingEvents && status.upcomingEvents.length > 0) {
    const nextEvents = status.upcomingEvents.filter(ev => ev.daysUntil > 0).slice(0, 3);
    if (nextEvents.length > 0) {
      upcomingLines = nextEvents.map(ev => {
        const parts = (ev.formattedDate || ev.date).split(",");
        const shortDate = parts[0] || ev.date;
        return `${shortDate} : ${ev.title} (${ev.daysUntil} দিন বাকি)`;
      }).join("\n");
    }
  }

  return `${slotTitle}
${status.today || ""}
${todayAlert}
🎯 ${active.title}
বাকি আছে: ${active.daysRemaining} দিন
তারিখ: ${active.dates}
প্রগ্রেস: ${active.bar}

💳 টিউশন ফি কিস্তি
${instLines}

${upcomingLines ? `📌 আসন্ন একাডেমিক তারিখ\n${upcomingLines}\n\n` : ""}💡 আজকের মোটিভেশন
"${status.quote}"

UIU Exam Countdown Bot`;
}

function formatWelcomeReply(status) {
  const active = status.activeExam;
  const now = (status && status.targetDate) ? new Date(status.targetDate) : new Date();
  const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

  const installments = [
    { name: "1st (40%)", dateStr: "2026-11-22", display: "22 Nov 2026" },
    { name: "2nd (70%)", dateStr: "2026-12-15", display: "15 Dec 2026" },
    { name: "3rd (100%)", dateStr: "2027-01-13", display: "13 Jan 2027" },
  ];

  const instLines = installments.map(inst => {
    const [y, m, d] = inst.dateStr.split("-").map(Number);
    const instDate = new Date(y, m - 1, d, 0, 0, 0);
    const diff = Math.round((instDate - todayZero) / (1000 * 60 * 60 * 24));
    let note = "";
    if (diff === 0) note = "আজ শেষ দিন!";
    else if (diff < 0) note = "Passed";
    else note = `${diff} দিন বাকি`;
    return `${inst.name} : ${inst.display} (${note})`;
  }).join("\n");

  let upcomingLines = "";
  if (status.upcomingEvents && status.upcomingEvents.length > 0) {
    const nextEvents = status.upcomingEvents.filter(ev => ev.daysUntil > 0).slice(0, 3);
    if (nextEvents.length > 0) {
      upcomingLines = nextEvents.map(ev => {
        const parts = (ev.formattedDate || ev.date).split(",");
        const shortDate = parts[0] || ev.date;
        return `${shortDate} : ${ev.title} (${ev.daysUntil} দিন বাকি)`;
      }).join("\n");
    }
  }

  return `UIU Exam Countdown | Fall 2026
আপনার সাবস্ক্রিপশন চালু হয়েছে। প্রতিদিন সকাল ৯টা ও রাত ৭টায় অটো আপডেট পাবেন।

🎯 ${active.title}
বাকি আছে: ${active.daysRemaining} দিন
তারিখ: ${active.dates}
প্রগ্রেস: ${active.bar}

💳 টিউশন ফি কিস্তি
${instLines}

${upcomingLines ? `📌 আসন্ন একাডেমিক তারিখ\n${upcomingLines}\n\n` : ""}💡 আজকের মোটিভেশন
"${status.quote}"

UIU Exam Countdown Bot`;
}

function formatCountdownReply(status, specificTarget = "current") {
  const active = status.activeExam;

  if (specificTarget === "mid") {
    return `UIU Mid-Term Exam Countdown
তারিখ: Dec 5 - Dec 12, 2026
বাকি আছে: ${active.type === 'mid' ? `${active.daysRemaining} দিন` : 'পরীক্ষা সম্পন্ন হয়েছে'}
প্রগ্রেস: ${active.type === 'mid' ? active.bar : '[██████████] 100%'}

UIU Exam Countdown Bot`;
  }

  if (specificTarget === "final") {
    return `UIU Final Exam Countdown
তারিখ: Jan 25 - Feb 1, 2027
বাকি আছে: ${active.type === 'final' ? `${active.daysRemaining} দিন` : 'মিড-টার্মের পর কাউন্টডাউন শুরু হবে'}
প্রগ্রেস: ${active.type === 'final' ? active.bar : '[░░░░░░░░░░] 0%'}

UIU Exam Countdown Bot`;
  }

  return `UIU Exam Countdown | Fall 2026

🎯 ${active.title}
বাকি আছে: ${active.daysRemaining} দিন
তারিখ: ${active.dates}
প্রগ্রেস: ${active.bar}

UIU Exam Countdown Bot`;
}

function formatScheduleUpdateNotice(status, changeSummary = "") {
  const active = status.activeExam;

  return `UIU ক্যালেন্ডার আপডেট নোটিশ
Fall 2026

${changeSummary ? `${changeSummary}\n\n` : ""}🎯 ${active.title}
বাকি আছে: ${active.daysRemaining} দিন
তারিখ: ${active.dates}
প্রগ্রেস: ${active.bar}

UIU Exam Countdown Bot`;
}

function formatCustomAnnouncement(title, message) {
  return `UIU নোটিশ: ${title}

${message}

UIU Exam Countdown Bot`;
}

function formatRoutineReply(calendarData) {
  const dates = (calendarData && calendarData.dates) || {};

  return `UIU Fall 2026 একাডেমিক ক্যালেন্ডার

🎓 মূল তারিখসমূহ
Classes Begin : ${dates.classesBegin || "27 Oct 2026"}
Mid-Term Exam : ${dates.midStart || "05 Dec"} - ${dates.midEnd || "12 Dec 2026"}
Final Exam    : ${dates.finalStart || "25 Jan"} - ${dates.finalEnd || "01 Feb 2027"}
Spring 2027   : 09 Feb 2027

💳 টিউশন ফি কিস্তি
১ম কিস্তি (40%) : 22 Nov 2026
২য় কিস্তি (70%) : 15 Dec 2026
৩য় কিস্তি (100%): 13 Jan 2027

UIU Exam Countdown Bot`;
}

function formatInstallmentsReply(status) {
  const now = (status && status.targetDate) ? new Date(status.targetDate) : new Date();
  const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

  const installments = [
    { name: "১ম কিস্তি (40%)", dateStr: "2026-11-22", day: "Sunday" },
    { name: "২য় কিস্তি (70%)", dateStr: "2026-12-15", day: "Tuesday" },
    { name: "৩য় কিস্তি (100%)", dateStr: "2027-01-13", day: "Wednesday" },
  ];

  const items = installments.map(inst => {
    const [y, m, d] = inst.dateStr.split("-").map(Number);
    const instDate = new Date(y, m - 1, d, 0, 0, 0);
    const diff = Math.round((instDate - todayZero) / (1000 * 60 * 60 * 24));
    let note = diff === 0 ? "আজ শেষ দিন!" : diff < 0 ? "Passed" : `${diff} দিন বাকি`;
    return `${inst.name} : ${inst.dateStr} (${inst.day})\nবাকি: ${note}`;
  }).join("\n\n");

  return `UIU টিউশন ফি কিস্তির সময়সীমা
Fall 2026

${items}

দেরি হলে প্রতি কিস্তিতে ৫০০ টাকা বিলম্ব ফি প্রযোজ্য।

UIU Exam Countdown Bot`;
}

module.exports = {
  formatDailyBroadcast,
  formatCountdownReply,
  formatScheduleUpdateNotice,
  formatCustomAnnouncement,
  formatRoutineReply,
  formatInstallmentsReply,
  formatWelcomeReply
};
