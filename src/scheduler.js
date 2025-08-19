import cron from "node-cron";
import fs from "fs";
import path from "path";
import { query } from "./db.js";
import { condense } from "./condenser.js";
import { compactEvent, toYmdLocal } from "./utils.js";
import { buildDailyPrompt, summarizeWithOllama } from "./summarize.js";
import { syncTodayForAccount } from "./sync.github.account.js";

// 환경변수에서 스케줄 설정 가져오기
const DAILY_SYNC_SCHEDULE = process.env.DAILY_SYNC_SCHEDULE || "0 50 17 * * *";
const DAILY_REPORT_SCHEDULE =
  process.env.DAILY_REPORT_SCHEDULE || "0 0 18 * * *";
const WEEKLY_REPORT_SCHEDULE =
  process.env.WEEKLY_REPORT_SCHEDULE || "0 0 17 * * 5";
const TIMEZONE = process.env.TZ || "Asia/Seoul";

// 기존 startSchedulers() 내부 또는 별도 스케줄 추가
export function startSchedulers() {
  console.log(`스케줄러 시작:`);
  console.log(`- 일일 동기화: ${DAILY_SYNC_SCHEDULE} (${TIMEZONE})`);
  console.log(`- 일일 보고서: ${DAILY_REPORT_SCHEDULE} (${TIMEZONE})`);
  console.log(`- 주간 보고서: ${WEEKLY_REPORT_SCHEDULE} (${TIMEZONE})`);

  // 일일 데이터 동기화
  cron.schedule(
    DAILY_SYNC_SCHEDULE,
    () => {
      console.log("일일 데이터 동기화 시작");
      syncTodayForAccount().catch(console.error);
    },
    { timezone: TIMEZONE }
  );

  // 일일 보고서 생성
  cron.schedule(
    DAILY_REPORT_SCHEDULE,
    () => {
      console.log("일일 보고서 생성 시작");
      dailyReport().catch(console.error);
    },
    { timezone: TIMEZONE }
  );

  // 주간 보고서 생성
  cron.schedule(
    WEEKLY_REPORT_SCHEDULE,
    () => {
      console.log("주간 보고서 생성 시작");
      weeklyReport().catch(console.error);
    },
    { timezone: TIMEZONE }
  );
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
