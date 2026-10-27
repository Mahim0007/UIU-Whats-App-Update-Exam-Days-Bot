/**
 * UIU WhatsApp Bot Message Formatter
 * Formats rich messages for WhatsApp with emojis, markdown, and SINGLE ACTIVE progression.
 * Rule:
 *  - During pre-mid / mid: ONLY Mid-Term progression is shown.
 *  - After mid finishes: ONLY Final Exam progression is shown.
 *  - Never show both at the same time!
 */

function formatDailyBroadcast(status, slot = "auto") {
  const currentHour = new Date().getHours();
  const isMorning = slot === "morning" || (slot === "auto" && currentHour < 14);
  const isEvening = slot === "evening" || (slot === "auto" && currentHour >= 17);

  const active = status.activeExam;
  const isMid = status.activeType === "mid";
  const isFinal = status.activeType === "final";

  let headerBanner = "";
  if (active.isOngoing) {
    headerBanner = isMid 
      ? "📝 *UIU MID-TERM EXAM IN PROGRESS* 🎯"
      : "🏁 *UIU FINAL EXAM IN PROGRESS* 🏆";
  } else if (status.phase === "POST_TRIMESTER") {
    headerBanner = "🎉 *UIU TRIMESTER COMPLETED* 🌴";
  } else if (isMorning) {
    headerBanner = isMid 
      ? "🌅 *UIU MID-TERM COUNTDOWN (9:00 AM)* 🌅" 
      : "🌅 *UIU FINAL EXAM COUNTDOWN (9:00 AM)* 🌅";
  } else if (isEvening) {
    headerBanner = isMid 
      ? "🌙 *UIU MID-TERM REVISION ALERT (7:00 PM)* 🌙" 
      : "🌙 *UIU FINAL REVISION ALERT (7:00 PM)* 🌙";
  } else {
    headerBanner = "🚨 *UIU EXAM COUNTDOWN ALERT* 🚨";
  }

  const greetingLine = status.isFirstDayPostMid
    ? "🎉 _মিড-টার্ম পরীক্ষা সমাপ্ত! আজ থেকে স্বয়ংক্রিয়ভাবে ফাইনাল পরীক্ষার অফিশিয়াল কাউন্টডাউন ও রিভিশন মিশন শুরু হলো!_\n"
    : isMorning 
    ? "☀️ _শুভ সকাল! আজকের দিনটি পড়াশোনায় মনোযোগ দিয়ে শুরু করো!_\n"
    : isEvening
    ? "🌙 _শুভ সন্ধ্যা! সারাদিনের লেকচারগুলো আজ রাতে অন্তত ১ ঘণ্টা রিভিশন দাও!_\n"
    : "";

  let eventsSection = "";
  if (status.upcomingEvents && status.upcomingEvents.length > 0) {
    eventsSection = "📌 *Upcoming Academic Events:*\n" + status.upcomingEvents
      .map(ev => {
        if (ev.daysUntil === 0 || ev.isToday) {
          return `• *${ev.formattedDate || ev.date}:* ${ev.title} 🚨 *[TODAY - আজ]* 🔥`;
        }
        return `• *${ev.formattedDate || ev.date}:* ${ev.title} _(in ${ev.daysUntil} ${ev.daysUntil === 1 ? "day" : "days"})_`;
      })
      .join("\n") + "\n";
  }

  let installmentSection = "";
  if (status.nextInstallment) {
    const isInstToday = status.nextInstallment.daysUntil === 0 || status.nextInstallment.isToday;
    if (isInstToday) {
      installmentSection = `💳 🚨 *TUITION FEE DEADLINE IS TODAY!* 🚨\n• *${status.nextInstallment.title}*\n  📅 Deadline: *${status.nextInstallment.formattedDate || status.nextInstallment.date}* 🚨 *[TODAY - আজই শেষ দিন!]* 🔥\n  ⚠️ 🚨 *জরুরি নোটিশ:* আজ রাত ১২টার পর ৫০০/- টাকা বিলম্ব ফি প্রযোজ্য হবে! আজকের মধ্যেই জমা দিন!\n`;
    } else {
      installmentSection = `💳 *Tuition Installment Alert:*\n• ${status.nextInstallment.title}\n  📅 Deadline: *${status.nextInstallment.formattedDate || status.nextInstallment.date}* _(${status.nextInstallment.daysUntil} days left)_\n  ⚠️ ${status.nextInstallment.note || "Tk. 500 fine after deadline"}\n`;
    }
  }

  let todayEventsBanner = "";
  if (status.todayEvents && status.todayEvents.length > 0) {
    todayEventsBanner = "🚨 *TODAY'S SPECIAL EVENT / আজ অনুষ্ঠিত হচ্ছে:* 🚨\n" + status.todayEvents
      .map(ev => `🔥 *[TODAY - আজ]* ${ev.title}${ev.type === "installment" ? " 💳 *(আজই শেষ দিন - বিলম্ব ফি ছাড়াই জমা দিন!)*" : ""}`)
      .join("\n") + "\n━━━━━━━━━━━━━━━━━━━━━━━━\n";
  }

  return `${headerBanner}
🏛️ *${status.university || "United International University (UIU)"}*
🗓️ *${status.trimester || "Fall 2026 Trimester"}* | 📅 ${status.today}
━━━━━━━━━━━━━━━━━━━━━━━━
${greetingLine}${todayEventsBanner}⏳ *${active.statusMessage}*
📅 *Exam Dates:* ${active.dates}

📊 *${active.title} Progression:*
${active.bar}
• ⏳ *${active.daysRemaining} days remaining* (${active.elapsedDays}/${active.totalDays} days passed)

━━━━━━━━━━━━━━━━━━━━━━━━
${eventsSection ? `${eventsSection}\n` : ""}${installmentSection ? `${installmentSection}\n` : ""}💡 *${isEvening ? "Evening Reflection" : "Daily Motivation"}:*
"${status.quote}"

━━━━━━━━━━━━━━━━━━━━━━━━
💬 _Reply *!countdown*, *!routine*, or *!help* anytime!_`;
}

function formatCountdownReply(status, specificTarget = "current") {
  const active = status.activeExam;

  // If user specifically asked for mid
  if (specificTarget === "mid") {
    return `⏱️ *UIU Mid-Term Exam Countdown*
🏛️ *United International University*
━━━━━━━━━━━━━━━━━━━━━━━━
📅 *Today:* ${status.today}
🗓️ *Exam Dates:* Dec 5, 2026 - Dec 12, 2026
📢 *Status:* *${active.type === 'mid' ? active.statusMessage : 'Mid-Term Exam Completed ✅'}*

📊 *Mid-Term Progression:*
${active.type === 'mid' ? active.bar : '[██████████] 100%'}
• Remaining: *${active.type === 'mid' ? `${active.daysRemaining} days` : '0 days (Completed)'}*

━━━━━━━━━━━━━━━━━━━━━━━━
💬 _Type *!routine* for calendar or *!help* for commands!_`;
  }

  // If user specifically asked for final
  if (specificTarget === "final") {
    const dates = status.dates || {};
    return `⏱️ *UIU Final Exam Countdown*
🏛️ *United International University*
━━━━━━━━━━━━━━━━━━━━━━━━
📅 *Today:* ${status.today}
🗓️ *Exam Dates:* Jan 25, 2027 - Feb 1, 2027
📢 *Status:* *${active.type === 'final' ? active.statusMessage : 'Final Exam starts Jan 25, 2027'}*

📊 *Final Exam Progression:*
${active.type === 'final' ? active.bar : 'Final progression activates after Mid-Term!'}
• Exam Period: *Jan 25 – Feb 1, 2027*

━━━━━━━━━━━━━━━━━━━━━━━━
💬 _Type *!routine* for calendar or *!help* for commands!_`;
  }

  // Default !countdown: ONLY SHOW CURRENT ACTIVE EXAM!
  let todayAlert = "";
  if (status.todayEvents && status.todayEvents.length > 0) {
    todayAlert = "\n🚨 *TODAY'S EVENT / আজ:* " + status.todayEvents.map(e => `*[TODAY - আজ]* ${e.title}`).join(", ") + "\n";
  } else if (status.nextInstallment && (status.nextInstallment.daysUntil === 0 || status.nextInstallment.isToday)) {
    todayAlert = `\n💳 🚨 *[TODAY - আজ কিস্তি জমার শেষ দিন!]*\n• ${status.nextInstallment.title}\n`;
  }

  return `⏱️ *UIU Exam Countdown & Progression*
🏛️ *${status.university || "United International University (UIU)"}*
🗓️ *${status.trimester || "Fall 2026 Trimester"}* | 📅 ${status.today}
━━━━━━━━━━━━━━━━━━━━━━━━
${todayAlert}
🎯 *Target:* ${active.title}
📢 *Status:* *${active.statusMessage}*
📅 *Exam Dates:* ${active.dates}

📊 *Progression:*
${active.bar}
• Elapsed: *${active.elapsedDays}* of *${active.totalDays}* days (${active.percent}%)
• Remaining: *${active.daysRemaining} days*

${active.type === "mid" 
  ? `💡 _Final Exam countdown will activate after Mid-Term is finished!_` 
  : `💡 _Finish the trimester strong! Best of luck!_`}
━━━━━━━━━━━━━━━━━━━━━━━━
💬 _Commands: *!routine* | *!installments* | *!help*_`;
}

function formatScheduleUpdateNotice(status, changeSummary = "") {
  const active = status.activeExam;

  return `📢 *UIU ACADEMIC CALENDAR AUTO-UPDATE* 📢
🏛️ *${status.university || "United International University (UIU)"}*
🗓️ *${status.trimester || "Fall 2026 Trimester"}*
━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ *Notice:* Academic dates have been updated in the bot!

${changeSummary ? `📝 *Update Details:*\n${changeSummary}\n\n` : ""}📌 *Current Active Exam Countdown:*
🎯 *Target:* ${active.title}
📅 *Dates:* ${active.dates}
📢 *Status:* *${active.statusMessage}*

📊 *Progression:*
${active.bar}
• Remaining: *${active.daysRemaining} days*

━━━━━━━━━━━━━━━━━━━━━━━━
✅ _All WhatsApp commands (!countdown, !routine) are auto-synced!_
💬 _Reply *!countdown* anytime to check updated days!_`;
}

function formatCustomAnnouncement(title, message) {
  return `📢 *UIU ANNOUNCEMENT: ${title.toUpperCase()}* 📢
🏛️ *United International University (UIU)*
━━━━━━━━━━━━━━━━━━━━━━━━

${message}

━━━━━━━━━━━━━━━━━━━━━━━━
💬 _UIU Exam Countdown Bot • Fall 2026_ 🎓`;
}

function formatRoutineReply(calendarData) {
  const dates = (calendarData && calendarData.dates) || {};
  const events = (calendarData && calendarData.events) || [];

  const now = new Date();
  const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

  const getInstBadge = (dateStr) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const evDate = new Date(y, m - 1, d, 0, 0, 0);
    const diff = Math.round((evDate - todayZero) / (1000 * 60 * 60 * 24));
    if (diff === 0) return " 🚨 *[TODAY - আজই শেষ দিন!]* 🔥";
    if (diff < 0) return " ✅ _(Passed)_";
    return ` _(in ${diff} days)_`;
  };

  const holidays = events.filter(e => e.type === "holiday").slice(0, 5);
  const holidayLines = holidays.length > 0 
    ? holidays.map(h => {
        const [y, m, d] = h.date.split("-").map(Number);
        const evDate = new Date(y, m - 1, d, 0, 0, 0);
        const diff = Math.round((evDate - todayZero) / (1000 * 60 * 60 * 24));
        const badge = diff === 0 ? " 🚨 *[TODAY - আজ]* 🔥" : "";
        return `• *${h.date}:* ${h.title}${badge}`;
      }).join("\n")
    : "• No major upcoming holidays listed.";

  return `📋 *UIU Fall 2026 Academic Calendar*
🏛️ *United International University*
━━━━━━━━━━━━━━━━━━━━━━━━

🎓 *Major Milestones:*
• *${dates.classesBegin || "Oct 27, 2026"}:* Classes Begin
• *${dates.midStart || "Dec 5, 2026"} – ${dates.midEnd || "Dec 12, 2026"}:* 🚨 *Mid-Term Exam*
• *${dates.finalStart || "Jan 25, 2027"} – ${dates.finalEnd || "Feb 1, 2027"}:* 🏆 *Final Exam*
• *Feb 9, 2027:* Spring 2027 Classes Begin

💳 *Tuition Installment Deadlines:*
• *Nov 22, 2026:* 1st Installment (40%)${getInstBadge("2026-11-22")}
• *Dec 15, 2026:* 2nd Installment (70%)${getInstBadge("2026-12-15")}
• *Jan 13, 2027:* 3rd Installment (100%)${getInstBadge("2027-01-13")}
_(Tk. 500 fine per installment if unpaid)_

🏖️ *Holidays & Class Suspensions:*
${holidayLines}

━━━━━━━━━━━━━━━━━━━━━━━━
💬 _Type *!countdown* for live remaining days!_`;
}

function formatInstallmentsReply(status) {
  const now = (status && status.targetDate) ? new Date(status.targetDate) : new Date();
  const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

  const installments = [
    { num: "1️⃣", name: "1st Installment (40% Tuition & Trimester Fee)", dateStr: "2026-11-22", dayName: "Sunday" },
    { num: "2️⃣", name: "2nd Installment (70% Tuition & Trimester Fee)", dateStr: "2026-12-15", dayName: "Tuesday" },
    { num: "3️⃣", name: "3rd Installment (100% Tuition & Trimester Fee)", dateStr: "2027-01-13", dayName: "Wednesday" },
  ];

  let hasToday = false;
  const items = installments.map(inst => {
    const [y, m, d] = inst.dateStr.split("-").map(Number);
    const instDate = new Date(y, m - 1, d, 0, 0, 0);
    const diff = Math.round((instDate - todayZero) / (1000 * 60 * 60 * 24));

    let badge = "";
    if (diff === 0) {
      hasToday = true;
      badge = " 🚨 *[TODAY - আজই শেষ দিন! দ্রুত জমা দিন!]* 🔥";
    } else if (diff < 0) {
      badge = " ✅ _(Passed / শেষ হয়েছে)_";
    } else {
      badge = ` ⏳ _(${diff} days remaining)_`;
    }

    return `${inst.num} *${inst.name}*
   📅 Deadline: *${instDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}* (${inst.dayName})${badge}
   ⚠️ Fine: Tk. 500/- after deadline`;
  });

  const urgentBanner = hasToday
    ? `🚨🚨 *জরুরি সতর্কতা: আজ ফি কিস্তি জমার শেষ দিন [TODAY]!* 🚨🚨\n⚠️ *আজ রাত ১২টার পর ৫০০/- টাকা বিলম্ব ফি প্রযোজ্য হবে!*\n━━━━━━━━━━━━━━━━━━━━━━━━\n`
    : "";

  return `💳 *UIU Fall 2026 Installment Schedule*
🏛️ *United International University*
━━━━━━━━━━━━━━━━━━━━━━━━
${urgentBanner}${items.join("\n\n")}

📌 *Payment Guidelines:*
• For 252+ batch: Tk. 20,000 paid at registration; 40% remainder due on 1st installment.
• Transportation & Gym fees payable in installments (40%, 30%, 30%).
━━━━━━━━━━━━━━━━━━━━━━━━
💬 _Type *!countdown* for exam status!_`;
}

function formatHelpReply() {
  return `🤖 *UIU Exam Countdown Bot - Commands*
━━━━━━━━━━━━━━━━━━━━━━━━
Here are the commands you can send me:

⏱️ *!countdown*
↳ Get live progression & remaining days for the current exam milestone!

📘 *!mid*
↳ View Mid-Term Exam details and dates.

🏆 *!final*
↳ View Final Exam details and dates.

📋 *!routine*
↳ View the full Fall 2026 Academic Calendar.

💳 *!installments*
↳ Check tuition fee installment dates and fines.

💡 *!quote*
↳ Get an instant motivational study quote!

🔔 *!subscribe*
↳ Subscribe to automatic morning (9 AM) and evening (7 PM) alerts!

🔕 *!unsubscribe*
↳ Unsubscribe from automated daily alerts.

ℹ️ *!help*
↳ Show this help menu.
━━━━━━━━━━━━━━━━━━━━━━━━
_Made for UIU Students • Auto-notifies at 9:00 AM & 7:00 PM_ 🎓`;
}

function formatWelcomeReply(status) {
  const active = status.activeExam;
  return `🎓 *Welcome to UIU Exam Countdown Bot!* 🤖
🏛️ *${status.university || "United International University (UIU)"}*
🗓️ *${status.trimester || "Fall 2026 Trimester"}* | 📅 ${status.today}
━━━━━━━━━━━━━━━━━━━━━━━━
🎉 *আপনার সাবস্ক্রিপশন সফলভাবে সক্রিয় হয়েছে!*
প্রতিদিন *সকাল ৯:০০ টা* এবং *রাত ৭:০০ টায়* আপনার এই হোয়াটসঅ্যাপে স্বয়ংক্রিয়ভাবে পরীক্ষার লাইভ কাউন্টডাউন ও রিভিশন নোটিফিকেশন পৌঁছে যাবে।

⚡ _(আপনাকে আর কখনোই 'hi' লিখে বট চালু করতে হবে না। ব্যাকএন্ড আপডেট হলেও এই সাবস্ক্রিপশন সারাজীবন সক্রিয় থাকবে!)_

⏳ *Current Target:* *${active.title}*
📢 *Status:* *${active.statusMessage}*
📅 *Exam Dates:* ${active.dates}

📊 *Live Progression:*
${active.bar}
• ⏳ *${active.daysRemaining} days remaining* (${active.elapsedDays}/${active.totalDays} days passed)

━━━━━━━━━━━━━━━━━━━━━━━━
📌 *যেকোনো সময় ব্যবহার করার কমান্ডসমূহ:*
• *!countdown* - বর্তমান পরীক্ষার লাইভ দিন ও প্রগ্রেস
• *!mid* - মিড-টার্ম পরীক্ষার তথ্য
• *!final* - ফাইনাল পরীক্ষার তথ্য
• *!routine* - ফুল অ্যাকাডেমিক ক্যালেন্ডার
• *!installments* - ফি কিস্তির তারিখ ও জরিমানা
• *!quote* - স্টাডি মোটিভেশন কোট
• *!unsubscribe* - নোটিফিকেশন বন্ধ করতে
━━━━━━━━━━━━━━━━━━━━━━━━
_Made for UIU Students • 24/7 Automated Service_ 🎓`;
}

module.exports = {
  formatDailyBroadcast,
  formatCountdownReply,
  formatScheduleUpdateNotice,
  formatCustomAnnouncement,
  formatRoutineReply,
  formatInstallmentsReply,
  formatHelpReply,
  formatWelcomeReply
};

