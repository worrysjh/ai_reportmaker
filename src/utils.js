// 환경변수에서 타임존 설정 가져오기
const TIMEZONE = process.env.TZ || "Asia/Seoul";

export function toYmd(dateStr) {
  const d = new Date(dateStr);
  const tz = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    dateStyle: "short",
  });
  return tz.format(d); // yyyy-mm-dd
}

export function toYmdLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const tz = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    dateStyle: "short",
  });
  return tz.format(d); // yyyy-mm-dd
}

export function extractUrls(text = "") {
  const re = /(https?:\/\/[^\s)]+)/g;
  return [...(text.match(re) || [])];
}

export function compactEvent(e) {
  return {
    ts: e.ts,
    type: e.type,
    title: e.title,
    urls: e.urls,
    meta: e.meta ? summarizeMeta(e.meta) : undefined,
  };
}

function summarizeMeta(meta) {
  const { added = [], modified = [], removed = [] } = meta || {};
  const files = added.length + modified.length + removed.length;
  if (!files) return undefined;
  return {
    files,
    added: added.length,
    modified: modified.length,
    removed: removed.length,
  };
}
