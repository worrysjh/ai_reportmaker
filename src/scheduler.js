import cron from "node-cron";
import fs from "fs";
import path from "path";
import { query } from "./utils/db.js";
import { condense } from "./utils/condenser.js";
import { compactEvent, toYmdLocal } from "./utils/utils.js";
import {
  buildDailyPrompt,
  buildWeeklyPrompt,
  summarizeWithOllama,
  dailyReport,
  weeklyReport,
} from "./utils/summarize.js";
import { syncTodayForAccount } from "./github/sync.github.account.js";

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
    async () => {
      console.log("일일 데이터 동기화 시작");
      await syncTodayForAccount().catch(console.error);
    },
    { scheduled: true, timezone: TIMEZONE }
  );

  // 일일 보고서 생성
  cron.schedule(
    DAILY_REPORT_SCHEDULE,
    async () => {
      console.log("일일 보고서 생성 시작");
      await dailyReport().catch(console.error);
    },
    { scheduled: true, timezone: TIMEZONE }
  );

  // 주간 보고서 생성
  cron.schedule(
    WEEKLY_REPORT_SCHEDULE,
    async () => {
      console.log("주간 보고서 생성 시작");
      await weeklyReport().catch(console.error);
    },
    { scheduled: true, timezone: TIMEZONE }
  );
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
