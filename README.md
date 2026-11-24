# 🎓 UIU Fall 2026 Exam Countdown WhatsApp Bot
> **United International University (UIU)** – Undergraduate Programs (Fall 2026 Trimester)

একটি স্বয়ংক্রিয় **WhatsApp Bot** যা সরাসরি **Mobile ও PC WhatsApp**-এ UIU Fall 2026 ট্রাইমেস্টারের **Mid-Term** এবং **Final Exam**-এর লাইভ প্রগ্রেস বার, অবশিষ্ট দিন, টিউশন ফি কিস্তির ডেডলাইন ও আসন্ন একাডেমিক ইভেন্টের আপডেট পাঠায়।

---

## 🌟 প্রধান ফিচারসমূহ (Key Features)

1. 📊 **স্মার্ট লাইভ প্রগ্রেস বার (Smart 1-at-a-Time Progression):**
   - 📘 **Mid-Term Progression:** মিড-টার্ম পরীক্ষা শেষ হওয়া পর্যন্ত শুধুমাত্র মিড-টার্মের প্রগ্রেস বার ও বাকি দিন দেখানো হয়।
   - 🏆 **Final Exam Progression:** মিড-টার্ম শেষ হওয়ার পর স্বয়ংক্রিয়ভাবে ফাইনাল পরীক্ষার প্রগ্রেস বার সক্রিয় হয়ে যায়।

2. ⏰ **দৈনিক ২ বার অটো-আপডেট (`Asia/Dhaka` — বাংলাদেশ সময়):**
   - 🌅 **সকাল ৯:০০টা (Morning Alert):** প্রগ্রেস বার, বাকি দিন, কিস্তির তথ্য ও সকালের মোটিভেশন।
   - 🌙 **রাত ৭:০০টা (Evening Alert):** সান্ধ্যকালীন রিভিশন রিমাইন্ডার ও কাউন্টডাউন আপডেট।

3. 🔒 **Strict Self-Only & No Auto-Reply Mode (১০০% প্রাইভেট):**
   - বট কখনোই কোনো **পাবলিক বা প্রাইভেট WhatsApp গ্রুপে** অথবা অন্য কোনো মানুষের ইনবক্সে মেসেজ পাঠায় না।
   - তুমি তোমার নিজের ইনবক্সে কোনো মেসেজ লিখলেও বট রিপ্লাই দিয়ে বিরক্ত করবে না—শুধু সকাল ৯টা ও রাত ৭টায় (এবং ড্যাশবোর্ড থেকে ম্যানুয়াল নোটিশ দিলে) আপডেট পাঠাবে।

4. 👥 **মাল্টি-ইউজার QR পেয়ারিং (`/qr-only`):**
   - যেকোনো ইউজার **`/qr-only`** লিংক ওপেন করলে তার জন্য আলাদা নতুন QR কোড জেনারেট হয় (অন্য কারো কানেকশন ডিসকানেক্ট না করেই)।
   - ফোনের WhatsApp (`Settings ➔ Linked Devices ➔ Link a Device`) দিয়ে একবার স্ক্যান করলেই ওই ইউজার কানেক্ট হয়ে যাবে এবং তার নিজের WhatsApp-এ ডেইলি আপডেট পাবে।

5. 🐘 **Cloud Session Persistence (PostgreSQL + Render + UptimeRobot):**
   - `DATABASE_URL` (যেমন Neon PostgreSQL) সেট করা থাকলে সবার WhatsApp সেশন ডাটাবেজের `baileys_auth` টেবিলে সেভ থাকে—তাই নতুন কোড পুশ বা সার্ভার রিস্টার্টেও বারবার QR স্ক্যান করতে হয় না।
   - Render Free প্ল্যানে ২৪/৭ চালু রাখতে UptimeRobot দিয়ে `/ping` এন্ডপয়েন্টে প্রতি ৫ মিনিটে মনিটর সেট করা যায়।

---

## 📲 কানেক্ট করার নিয়ম (How to Connect)

1. লাইভ **`/qr-only`** লিংক ওপেন করো (যেমন: `https://uiu-whats-app-update-exam-days-bot.onrender.com/qr-only`)।
2. ফোনের WhatsApp খুলো: **Settings (বা ৩ ডট) ➔ Linked Devices ➔ Link a Device**।
3. স্ক্রিনের QR কোডটি স্ক্যান করো এবং `✅ Connected` আসা পর্যন্ত কয়েক সেকেন্ড অপেক্ষা করো।

---

## 🚀 লোকালে চালানোর নিয়ম (Run Locally)

```powershell
npm ci
npm start
```
অথবা Windows-এ **`start.bat`** ফাইলটিতে ডাবল-ক্লিক করে চালাতে পারো।

### Environment Variables (`.env` / Render)
- `DATABASE_URL`: PostgreSQL connection string (Neon / Supabase / Render Postgres) — সেশন পারমানেন্ট রাখার জন্য।
- `PORT`: ওয়েব সার্ভার পোর্ট (ডিফল্ট `3000`)।
- `TZ`: টাইমজোন (ডিফল্ট `Asia/Dhaka`)।

---

## 📁 ফাইল স্ট্রাকচার (File Structure)

```text
├── data/
│   ├── calendar.json       # পরীক্ষার তারিখ, কিস্তি ও একাডেমিক ইভেন্ট
│   └── subscribers.json    # লোকাল সাবস্ক্রাইবার ব্যাকআপ
├── src/
│   ├── bot.js              # Baileys মাল্টি-সেশন WhatsApp বট ও 9AM/7PM শিডিউলার
│   ├── server.js           # Express সার্ভার (/qr-only, /qr, /ping, /health, Admin API)
│   ├── calendar.js         # মিড ও ফাইনাল প্রগ্রেশন ইঞ্জিন
│   ├── messages.js         # WhatsApp মেসেজ টেমপ্লেট
│   ├── db.js               # PostgreSQL সেশন ও ইউজার স্টোরেজ (baileys_auth)
│   └── security.js         # রেট-লিমিটিং ও কনটেন্ট ভ্যালিডেশন
├── public/
│   └── index.html          # Admin Web Dashboard
├── config.json             # শিডিউল ও নোটিফিকেশন কনফিগারেশন
├── render.yaml             # Render ডিপ্লয়মেন্ট কনফিগ
├── start.bat               # Windows অটো-রিস্টার্ট লঞ্চার
└── index.js                # মেইন এন্ট্রি পয়েন্ট (TZ=Asia/Dhaka)
```

Made with ❤️ for UIUians.
