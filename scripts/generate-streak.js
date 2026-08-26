// scripts/generate-streak.js
// Fetches real GitHub contribution data and writes streak.svg

const fs = require("fs");

const USERNAME = process.env.GH_USERNAME || "Om072005";
const TOKEN = process.env.GH_TOKEN;

if (!TOKEN) {
  console.error("GH_TOKEN env var is missing. Add it as a repository secret.");
  process.exit(1);
}

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const C = {
  bg: "#0d1117",
  border: "#30363d",
  divider: "#21262d",
  text: "#e6edf3",
  muted: "#8b949e",
  faint: "#484f58",
  accent: "#fe428e",
  ramp: ["#21262d", "#5c2340", "#7d3055", "#9e3d6a", "#c04a80", "#e15795", "#fe428e"],
};

const QUERY = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      createdAt
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }
`;

async function gql(variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  if (!json.data || !json.data.user) throw new Error(`User "${variables.login}" not found`);
  return json.data.user;
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

// contributionsCollection caps at one year per request. Walk backwards in
// 12-month windows until we reach the account creation date, so the total
// is genuinely all-time rather than trailing-twelve-months.
async function fetchAllDays() {
  const days = new Map();
  let createdAt = null;
  let to = new Date();

  for (let i = 0; i < 20; i++) {
    const from = new Date(to);
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    from.setUTCDate(from.getUTCDate() + 1);

    if (createdAt && from < createdAt) from.setTime(createdAt.getTime());

    const user = await gql({
      login: USERNAME,
      from: from.toISOString(),
      to: to.toISOString(),
    });

    if (!createdAt) createdAt = new Date(user.createdAt);

    for (const week of user.contributionsCollection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) {
        days.set(day.date, day.contributionCount);
      }
    }

    if (from <= createdAt) break;
    to = new Date(from);
    to.setUTCDate(to.getUTCDate() - 1);
  }

  return days;
}

function computeStats(days) {
  const dates = [...days.keys()].sort();
  const total = dates.reduce((sum, d) => sum + days.get(d), 0);

  let longestStreak = 0;
  let longestEnd = null;
  let run = 0;

  for (const date of dates) {
    if (days.get(date) > 0) {
      run++;
      if (run > longestStreak) {
        longestStreak = run;
        longestEnd = date;
      }
    } else {
      run = 0;
    }
  }

  let longestStart = null;
  if (longestEnd) {
    const d = new Date(longestEnd);
    d.setUTCDate(d.getUTCDate() - (longestStreak - 1));
    longestStart = iso(d);
  }

  // Current streak: walk back from today. A zero today is forgiven since
  // the day isn't over; a zero before that ends the run.
  const today = iso(new Date());
  const active = new Set(dates.filter((d) => days.get(d) > 0));

  let currentStreak = 0;
  let currentStart = null;
  const cursor = new Date(today);
  if (!active.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);

  while (active.has(iso(cursor))) {
    currentStart = iso(cursor);
    currentStreak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const recent = dates.slice(-30).map((d) => ({ date: d, count: days.get(d) }));

  return {
    total,
    today,
    firstDate: dates[0],
    currentStreak,
    currentStart,
    longestStreak,
    longestStart,
    longestEnd,
    recent,
  };
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtMonth(isoDate) {
  if (!isoDate) return "";
  const [y, m] = isoDate.split("-");
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function fmtDay(isoDate) {
  if (!isoDate) return "";
  const [, m, d] = isoDate.split("-");
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Digits render about 18px wide at 32px in the monospace stack. Used to
// place each inline caption just past its number without overlapping.
function afterNumber(x, value) {
  return x + String(value).length * 18 + 10;
}

function buildBars(recent) {
  const max = Math.max(...recent.map((r) => r.count), 1);
  const BASE = 170;
  const MAX_H = 48;

  return recent
    .map((day, i) => {
      const x = 36 + i * 23;
      if (day.count === 0) {
        return `  <rect x="${x}" y="${BASE}" width="17" height="3" rx="1.5" fill="${C.ramp[0]}"/>`;
      }
      const ratio = day.count / max;
      const h = Math.max(6, Math.round(ratio * MAX_H));
      const step = Math.min(C.ramp.length - 1, Math.max(1, Math.ceil(ratio * (C.ramp.length - 1))));
      return `  <rect x="${x}" y="${BASE - h}" width="17" height="${h}" rx="2" fill="${C.ramp[step]}"><title>${esc(day.date)}: ${day.count}</title></rect>`;
    })
    .join("\n");
}

function buildSVG(s) {
  const since = fmtMonth(s.firstDate);
  const dayWord = s.currentStreak === 1 ? "day" : "days";
  const longWord = s.longestStreak === 1 ? "day" : "days";
  const longWhen = s.longestStreak > 0 ? ` \u00b7 ${fmtMonth(s.longestEnd)}` : "";

  // The current streak only earns the accent once it's worth showing off.
  const currentFill = s.currentStreak >= 7 ? C.accent : C.text;

  return `<svg width="760" height="220" viewBox="0 0 760 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub contribution summary for ${esc(USERNAME)}">
  <title>${esc(USERNAME)} contribution summary</title>
  <desc>${s.total} total contributions since ${esc(since)}. Current streak ${s.currentStreak} ${dayWord}. Longest streak ${s.longestStreak} ${longWord}.</desc>

  <rect width="760" height="220" rx="12" fill="${C.bg}" stroke="${C.border}" stroke-width="1"/>

  <text x="32" y="44" font-family="${SANS}" font-size="11" fill="${C.muted}" letter-spacing="0.4">Total contributions</text>
  <text x="32" y="80" font-family="${MONO}" font-size="32" font-weight="700" fill="${C.accent}">${s.total}</text>
  <text x="${afterNumber(32, s.total)}" y="80" font-family="${SANS}" font-size="12" fill="${C.muted}">since ${esc(since)}</text>

  <line x1="280" y1="32" x2="280" y2="92" stroke="${C.divider}" stroke-width="1"/>

  <text x="312" y="44" font-family="${SANS}" font-size="11" fill="${C.muted}" letter-spacing="0.4">Current streak</text>
  <text x="312" y="80" font-family="${MONO}" font-size="32" font-weight="700" fill="${currentFill}">${s.currentStreak}</text>
  <text x="${afterNumber(312, s.currentStreak)}" y="80" font-family="${SANS}" font-size="12" fill="${C.muted}">${dayWord}</text>

  <line x1="500" y1="32" x2="500" y2="92" stroke="${C.divider}" stroke-width="1"/>

  <text x="532" y="44" font-family="${SANS}" font-size="11" fill="${C.muted}" letter-spacing="0.4">Longest streak</text>
  <text x="532" y="80" font-family="${MONO}" font-size="32" font-weight="700" fill="${C.text}">${s.longestStreak}</text>
  <text x="${afterNumber(532, s.longestStreak)}" y="80" font-family="${SANS}" font-size="12" fill="${C.muted}">${longWord}${esc(longWhen)}</text>

${buildBars(s.recent)}

  <text x="36" y="196" font-family="${SANS}" font-size="11" fill="${C.faint}">Last 30 days</text>
  <text x="724" y="196" font-family="${SANS}" font-size="11" fill="${C.faint}" text-anchor="end">Updated ${esc(fmtDay(s.today))}</text>
</svg>`;
}

(async () => {
  try {
    console.log(`Fetching contributions for @${USERNAME}...`);
    const days = await fetchAllDays();
    const stats = computeStats(days);

    console.log(
      `Total ${stats.total} since ${stats.firstDate} \u00b7 current ${stats.currentStreak} \u00b7 longest ${stats.longestStreak}`
    );

    fs.writeFileSync("streak.svg", buildSVG(stats), "utf8");
    console.log("streak.svg written successfully.");
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();
