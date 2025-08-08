import cron from "node-cron";
import fs from "fs";
import path from "path";
import { query } from "./db.js";
import { condense } from "./condenser.js";
import { compactEvent } from "./utils.js";
import { buildDailyPrompt, summarizeWithOllama } from "./summarize.js";
import { syncTodayForAccount } from "./sync.gitlab.account.js";

const KST_6PM = "0 0 18 * * *"; // 매일 18:00
const FRI_5PM = "0 0 17 * * 5"; // 금요일 17:00

// 기존 startSchedulers() 내부 또는 별도 스케줄 추가
export function startSchedulers() {
  // 17:50 수집 → 18:00 보고 생성
  cron.schedule(
    "0 50 17 * * *",
    () => syncTodayForAccount().catch(console.error),
    { timezone: process.env.TZ || "Asia/Seoul" }
  );
  cron.schedule("0 0 18 * * *", () => dailyReport().catch(console.error), {
    timezone: process.env.TZ || "Asia/Seoul",
  });

  // 주간은 기존 그대로
  cron.schedule("0 0 17 * * 5", () => weeklyReport().catch(console.error), {
    timezone: process.env.TZ || "Asia/Seoul",
  });
}

function toYmdLocal(d) {
  const tz = process.env.TZ || "Asia/Seoul";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    dateStyle: "short",
  });
  return fmt.format(d);
}

export async function dailyReport() {
  const author = process.env.REPORT_ACTOR || "신지헌";
  const ymd = toYmdLocal(new Date());
  const events = await query(
    `SELECT * FROM events WHERE ymd=$1 AND actor=$2 ORDER BY ts ASC`,
    [ymd, author]
  );
  if (events.length === 0) return;

  const groups = condense(
    events
      .map((e) => ({
        ...e,
        urls: e.urls || [],
        meta: e.meta || null,
      }))
      .map(compactEvent)
  );

  const prompt = buildDailyPrompt({ actor: author, ymd, groups });
  const markdown = await summarizeWithOllama({ prompt });

  await query(
    `INSERT INTO reports (ymd, scope, author, markdown) VALUES ($1,$2,$3,$4)`,
    [ymd, "daily", author, markdown]
  );
  writeMdFile({ ymd, author, scope: "daily", markdown });
}

export async function weeklyReport() {
  const author = process.env.REPORT_ACTOR || "신지헌";
  const days = getLastBusinessDays(5);
  const rows = await query(
    `SELECT * FROM reports WHERE author=$1 AND scope='daily' AND ymd = ANY($2::date[]) ORDER BY ymd`,
    [author, days]
  );
  if (!rows.length) return;

  const md = rows.map((r) => r.markdown).join("\n\n---\n\n");
  await query(
    `INSERT INTO reports (ymd, scope, author, markdown) VALUES ($1,$2,$3,$4)`,
    [days[days.length - 1], "weekly", author, md]
  );
  writeMdFile({
    ymd: days[days.length - 1],
    author,
    scope: "weekly",
    markdown: md,
  });
}

function writeMdFile({ ymd, author, scope, markdown }) {
  const dir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const fn = path.join(dir, `${ymd}-${author}-${scope}.md`);
  fs.writeFileSync(fn, markdown, "utf8");
}

function getLastBusinessDays(n) {
  const out = [];
  let d = new Date();
  while (out.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) out.unshift(toYmdLocal(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}
