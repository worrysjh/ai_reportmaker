// src/sync.gitlab.account.js
import axios from "axios";
import { query } from "../utils/db.js";
import { extractUrls, toYmd } from "../utils/utils.js";

const api = axios.create({
  baseURL: process.env.GITLAB_BASE_URL,
  headers: { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN },
  timeout: 20000,
});

function isoRangeForToday(tz = process.env.TZ || "Asia/Seoul") {
  const now = new Date();
  // 00:00 ~ 익일 00:00 KST 범위 생성
  const f = (d) => d.toISOString();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startISO: f(start), endISO: f(end) };
}

export async function syncTodayForAccount() {
  const { startISO, endISO } = isoRangeForToday();
  const username = process.env.GITLAB_USERNAME;
  const authorEmail = process.env.GITLAB_AUTHOR_EMAIL;

  if (!process.env.GITLAB_BASE_URL || !process.env.GITLAB_TOKEN) {
    console.warn("[sync] GITLAB_BASE_URL / GITLAB_TOKEN 미설정");
    return;
  }

  // A) 내가 멤버인 프로젝트 나열 (최대 200개, 필요 시 페이지 처리)
  const projects = await apiGetAll("/projects", {
    membership: true,
    simple: true,
    per_page: 100,
    order_by: "last_activity_at",
    sort: "desc",
  });

  // 각 프로젝트의 '오늘 커밋' 수집 (필요 시 페이지 처리)
  for (const p of projects) {
    try {
      const commits = await apiGetAll(`/projects/${p.id}/repository/commits`, {
        since: startISO,
        until: endISO,
        per_page: 100,
        // ref_name: 'main' // 필요하면 브랜치 제한
      });
      // 작성자 필터(권장): author_email 일치
      const mine = authorEmail
        ? commits.filter(
            (c) =>
              (c.author_email || "").toLowerCase() === authorEmail.toLowerCase()
          )
        : commits.filter((c) =>
            (c.author_name || "")
              .toLowerCase()
              .includes((username || "").toLowerCase())
          );

      for (const c of mine) {
        await saveEvent({
          ts: c.created_at,
          actor: c.author_name || username,
          repo: p.path_with_namespace,
          type: "commit",
          title: c.title || c.message?.split("\n")[0] || "",
          body: c.message || "",
          urls: extractUrls(c.message || ""),
          meta: {
            id: c.id,
            short_id: c.short_id,
            web_url: c.web_url,
            project_id: p.id,
          },
        });
      }
    } catch (e) {
      console.warn(
        `[sync] commits fail p:${p.id} ${p.path_with_namespace}`,
        e.message
      );
    }
  }

  // B) 내 계정 이벤트 피드(프로젝트 무관, 전역) → MR/이슈/코멘트 등
  try {
    // after/before는 날짜(yyyy-mm-dd) 기준이라 하루 범위 편함
    const after = toYmd(startISO);
    const before = toYmd(endISO);
    const events = await apiGetAll(`/events`, { after, before, per_page: 100 });

    for (const ev of events) {
      const ts = ev.created_at;
      const actor = ev.author?.name || username || "me";
      const repo = ev.project_id
        ? String(ev.project_id)
        : ev.project?.path_with_namespace || "multi";
      const action = (ev.action_name || "").toLowerCase();
      const targetType = (ev.target_type || "").toLowerCase();
      const title =
        ev.push_data?.commit_title ||
        ev.target_title ||
        `${ev.action_name} ${ev.target_type || ""}`.trim();

      const bodyParts = [];
      if (ev.push_data?.ref) bodyParts.push(`ref: ${ev.push_data.ref}`);
      if (ev.note?.body) bodyParts.push(ev.note.body);
      const body = bodyParts.join("\n");

      const type = targetType.includes("merge")
        ? "mr"
        : targetType.includes("issue")
        ? "issue"
        : ev.note
        ? "note"
        : action.includes("pushed")
        ? "commit"
        : "event";

      await saveEvent({
        ts,
        actor,
        repo,
        type,
        title: title || "",
        body: body || "",
        urls: extractUrls([title, body].join("\n")),
        meta: {
          action_name: ev.action_name,
          target_type: ev.target_type,
          project_id: ev.project_id,
        },
      });
    }
  } catch (e) {
    console.warn("[sync] events fail", e.message);
  }
}

// 공통: GitLab 페이지네이션 유틸
async function apiGetAll(path, params) {
  let page = 1,
    out = [];
  while (true) {
    const { data, headers } = await api.get(path, {
      params: { ...params, page },
    });
    out = out.concat(data || []);
    const next = headers["x-next-page"];
    if (!next) break;
    page = Number(next);
  }
  return out;
}

async function saveEvent({ ts, actor, repo, type, title, body, urls, meta }) {
  const ymd = toYmd(ts);
  await query(
    `INSERT INTO events (ts, ymd, actor, repo, type, title, body, urls, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT DO NOTHING`,
    [ts, ymd, actor, repo, type, title, body, urls, meta]
  );
}
