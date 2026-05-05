// scripts/generate-streak.js
// Fetches real GitHub contribution data and writes streak.svg
 
const fs = require("fs");
 
const USERNAME = process.env.GH_USERNAME || "Om072005";
const TOKEN = process.env.GH_TOKEN;
 
if (!TOKEN) {
  console.error("  GH_TOKEN env var is missing. Add it as a repository secret.");
  process.exit(1);
}
 
// ─── Fetch contribution calendar via GraphQL ──────────────────────────────────
async function fetchContributions() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;
 
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });
 
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }
 
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
 
  return json.data.user.contributionsCollection.contributionCalendar;
}
 
// ─── Compute streak stats ─────────────────────────────────────────────────────
function computeStats(calendar) {
  // Flatten all days sorted oldest → newest
  const days = calendar.weeks
    .flatMap((w) => w.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));
 
  const total = calendar.totalContributions;
  const today = new Date().toISOString().slice(0, 10);
 
  let currentStreak = 0;
  let currentStart = null;
  let currentEnd = null;
 
  let longestStreak = 0;
  let longestStart = null;
  let longestEnd = null;
 
  let tempStreak = 0;
  let tempStart = null;
 
  for (const day of days) {
    if (day.contributionCount > 0) {
      if (tempStreak === 0) tempStart = day.date;
      tempStreak++;
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
        longestStart = tempStart;
        longestEnd = day.date;
      }
    } else {
      tempStreak = 0;
      tempStart = null;
    }
  }
 
  // Current streak: walk backwards from today
  const activeDays = new Set(
    days.filter((d) => d.contributionCount > 0).map((d) => d.date)
  );
 
  let cursor = new Date(today);
  // If today has no contributions yet, start from yesterday
  if (!activeDays.has(today)) cursor.setDate(cursor.getDate() - 1);
 
  while (activeDays.has(cursor.toISOString().slice(0, 10))) {
    if (!currentEnd) currentEnd = cursor.toISOString().slice(0, 10);
    currentStart = cursor.toISOString().slice(0, 10);
    currentStreak++;
    cursor.setDate(cursor.getDate() - 1);
  }
 
  return {
    total,
    today,
    currentStreak,
    currentStart,
    currentEnd,
    longestStreak,
    longestStart,
    longestEnd,
  };
}
 
// ─── Format date for display ──────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}
 
function fmtRange(start, end) {
  if (!start) return "—";
  if (start === end) return fmtDate(start);
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}
 
// ─── Build SVG ────────────────────────────────────────────────────────────────
function buildSVG(stats) {
  const { total, today, currentStreak, currentStart, currentEnd,
          longestStreak, longestStart, longestEnd } = stats;
 
  const updatedAt = fmtDate(today);
 
  // Ring parameters
  const r = 40;
  const circ = 2 * Math.PI * r;
  const progress = currentStreak > 0 ? Math.min(currentStreak / 30, 1) : 0;
  const dashOffset = circ * (1 - progress);
 
  return `<svg width="760" height="180" viewBox="0 0 760 180" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub Streak Stats for ${USERNAME}">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&amp;display=swap');
      text { font-family: 'JetBrains Mono', monospace; }
    </style>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0d1117"/>
      <stop offset="100%" style="stop-color:#161b22"/>
    </linearGradient>
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#fe428e"/>
      <stop offset="100%" style="stop-color:#f8d847"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
 
  <!-- Background -->
  <rect width="760" height="180" rx="12" fill="url(#bg)" stroke="#30363d" stroke-width="1"/>
 
  <!-- Dividers -->
  <line x1="253" y1="20" x2="253" y2="160" stroke="#30363d" stroke-width="1"/>
  <line x1="507" y1="20" x2="507" y2="160" stroke="#30363d" stroke-width="1"/>
 
  <!-- ── LEFT: Total Contributions ── -->
  <text x="126" y="72" text-anchor="middle" font-size="42" font-weight="700" fill="#fe428e" filter="url(#glow)">${total}</text>
  <text x="126" y="100" text-anchor="middle" font-size="13" fill="#f8d847">Total Contributions</text>
  <text x="126" y="120" text-anchor="middle" font-size="11" fill="#8b949e">Aug 2024 – ${updatedAt}</text>
 
  <!-- ── CENTER: Current Streak (ring) ── -->
  <!-- Track ring -->
  <circle cx="380" cy="88" r="${r}" fill="none" stroke="#21262d" stroke-width="7"/>
  <!-- Progress ring -->
  <circle cx="380" cy="88" r="${r}" fill="none"
    stroke="url(#ringGrad)" stroke-width="7"
    stroke-linecap="round"
    stroke-dasharray="${circ.toFixed(2)}"
    stroke-dashoffset="${dashOffset.toFixed(2)}"
    transform="rotate(-90 380 88)"
    filter="url(#glow)"
  />
  <!-- Flame icon -->
  <text x="380" y="75" text-anchor="middle" font-size="14">🔥</text>
  <!-- Count -->
  <text x="380" y="96" text-anchor="middle" font-size="22" font-weight="700" fill="#fe428e">${currentStreak}</text>
  <text x="380" y="144" text-anchor="middle" font-size="13" fill="#f8d847">Current Streak</text>
  <text x="380" y="162" text-anchor="middle" font-size="10" fill="#8b949e">${currentStreak > 0 ? fmtRange(currentStart, currentEnd) : "No active streak"}</text>
 
  <!-- ── RIGHT: Longest Streak ── -->
  <text x="634" y="72" text-anchor="middle" font-size="42" font-weight="700" fill="#fe428e" filter="url(#glow)">${longestStreak}</text>
  <text x="634" y="100" text-anchor="middle" font-size="13" fill="#f8d847">Longest Streak</text>
  <text x="634" y="120" text-anchor="middle" font-size="11" fill="#8b949e">${longestStreak > 0 ? fmtRange(longestStart, longestEnd) : "—"}</text>
 
  <!-- Updated timestamp -->
  <text x="756" y="175" text-anchor="end" font-size="9" fill="#484f58">Updated ${updatedAt}</text>
</svg>`;
}
 
// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log(`Fetching contributions for @${USERNAME}...`);
    const calendar = await fetchContributions();
    const stats = computeStats(calendar);
 
    console.log("Stats:", stats);
 
    const svg = buildSVG(stats);
    fs.writeFileSync("streak.svg", svg, "utf8");
    console.log(" streak.svg written successfully!");
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();
