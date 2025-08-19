import cron from "node-cron";
import fs from "fs";
import path from "path";
import { query } from "./db.js";
import { condense } from "./condenser.js";
import { compactEvent, toYmdLocal } from "./utils.js";
import {
  buildDailyPrompt,
  buildWeeklyPrompt,
  summarizeWithOllama,
} from "./summarize.js";
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

  // 주간 이벤트 데이터 수집
  const events = await query(
    `SELECT * FROM events WHERE ymd = ANY($1::date[]) AND actor=$2 ORDER BY ts ASC`,
    [days, author]
  );

  if (events.length === 0) {
    console.log("주간 이벤트 데이터가 없습니다.");
    return;
  }

  const groups = condense(
    events
      .map((e) => ({
        ...e,
        urls: e.urls || [],
        meta: e.meta || null,
      }))
      .map(compactEvent)
  );

  const startDate = days[0];
  const endDate = days[days.length - 1];

  const prompt = buildWeeklyPrompt({
    actor: author,
    startDate,
    endDate,
    groups,
  });

  const markdown = await summarizeWithOllama({ prompt });

  await query(
    `INSERT INTO reports (ymd, scope, author, markdown) VALUES ($1,$2,$3,$4)`,
    [endDate, "weekly", author, markdown]
  );
  writeMdFile({
    ymd: endDate,
    author,
    scope: "weekly",
    markdown,
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
