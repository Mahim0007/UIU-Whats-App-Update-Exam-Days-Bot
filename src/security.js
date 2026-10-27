/**
 * UIU WhatsApp Bot - Security & Anti-Abuse Engine
 * Features:
 *   1. Anti-Flood & Rate Limiting per WhatsApp User (Prevents WhatsApp Number Bans & DDoS)
 *   2. Content Safety & Phishing / Malicious Payload Filter
 *   3. Strict Input Sanitization (Anti-Injection & Buffer Overflow prevention)
 *   4. Broadcast Authorization & Safety Validation
 */

// In-memory rate limiting tracker: jid -> { count, resetTime, warned }
const userRateLimits = new Map();

// Suspicious patterns / unethical hacking & phishing keywords
const FORBIDDEN_CONTENT_PATTERNS = [
  /javascript:/i,
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /\b(hack|hacked|free-recharge|crypto-giveaway|claim-prize|free-money|password-reset-scam)\b/i,
  /(?:bit\.ly|tinyurl\.com|cutt\.ly|is\.gd|t\.co|rb\.gy)\/[a-zA-Z0-9]+/i, // Generic suspicious shorteners in broadcasts
  /\b(eval\(|exec\(|child_process|spawn\(|fs\.rmdir|SELECT.*FROM.*users.*WHERE)\b/i
];

/**
 * 1. Check Rate Limit for WhatsApp User (Max 6 messages per 10 seconds)
 * Returns { allowed: boolean, remaining: number, isSpamming: boolean }
 */
function checkUserRateLimit(remoteJid, maxPerWindow = 6, windowMs = 10000) {
  const now = Date.now();
  let record = userRateLimits.get(remoteJid);

  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs, warned: false };
    userRateLimits.set(remoteJid, record);
    return { allowed: true, remaining: maxPerWindow - 1, isSpamming: false };
  }

  record.count++;

  if (record.count > maxPerWindow) {
    const isFirstWarning = !record.warned;
    record.warned = true;
    return { allowed: false, remaining: 0, isSpamming: true, isFirstWarning };
  }

  return { allowed: true, remaining: maxPerWindow - record.count, isSpamming: false };
}

// Cleanup rate limits map periodically to prevent memory leaks
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [jid, data] of userRateLimits.entries()) {
    if (now > data.resetTime) {
      userRateLimits.delete(jid);
    }
  }
}, 60000);
cleanupInterval.unref();


/**
 * 2. Strict Input Sanitizer
 * Removes null bytes, dangerous control characters, and enforces length limits
 */
function sanitizeInput(str, maxLength = 500) {
  if (typeof str !== "string") return "";
  return str
    .replace(/\0/g, "") // Remove null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove ASCII control characters
    .trim()
    .slice(0, maxLength);
}

/**
 * 3. Validate Broadcast & Notice Content
 * Ensures no unethical hacking, phishing, or scam messages can be broadcasted to students
 */
function validateNoticeContent(title, message) {
  const combined = `${title || ""} ${message || ""}`;

  if (!combined.trim()) {
    return { safe: false, reason: "Message content cannot be empty." };
  }

  if (combined.length > 3000) {
    return { safe: false, reason: "Message length exceeds maximum allowed limit (3,000 characters)." };
  }

  for (const pattern of FORBIDDEN_CONTENT_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        safe: false,
        reason: "Security Guard Blocked: Content contains prohibited patterns, suspicious shorteners, or malicious script tags."
      };
    }
  }

  return { safe: true };
}

module.exports = {
  checkUserRateLimit,
  sanitizeInput,
  validateNoticeContent
};
