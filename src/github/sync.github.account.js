// src/sync.github.account.js
import axios from "axios";
import { query } from "../utils/db.js";
import { extractUrls, toYmd } from "../utils/utils.js";

const api = axios.create({
  baseURL: process.env.GITHUB_BASE_URL,
  headers: {
    Authorization: `token ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github.v3+json",
  },
  timeout: 20000,
});

// 환경변수에서 타임존 설정 가져오기
const TIMEZONE = process.env.TZ || "Asia/Seoul";

function isoRangeForToday() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

async function apiGetAll(endpoint, params = {}) {
  let allData = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    try {
      const response = await api.get(endpoint, {
        params: { ...params, page, per_page: perPage },
      });

      if (!response.data || response.data.length === 0) break;

      allData = allData.concat(response.data);

      if (response.data.length < perPage) break;
      page++;
    } catch (error) {
      console.error(`API 요청 실패: ${endpoint}`, error.message);
      break;
    }
  }

  return allData;
}

async function saveEvent(event) {
  await query(
    `INSERT INTO events (ts, actor, repo, type, title, body, urls, meta) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.ts,
      event.actor,
      event.repo,
      event.type,
      event.title,
      event.body,
      JSON.stringify(event.urls || []),
      JSON.stringify(event.meta || {}),
    ]
  );
}

export async function syncTodayForAccount() {
  const { startISO, endISO } = isoRangeForToday();
  const username = process.env.GITHUB_USERNAME;

  if (!process.env.GITHUB_BASE_URL || !process.env.GITHUB_TOKEN) {
    console.warn("[sync] GITHUB_BASE_URL / GITHUB_TOKEN 미설정");
    return;
  }

  console.log(`[sync] GitHub 활동 수집 시작: ${startISO} ~ ${endISO}`);

  try {
    // 사용자의 리포지토리 목록 가져오기
    const repos = await apiGetAll("/user/repos", {
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });

    console.log(`[sync] 발견된 리포지토리: ${repos.length}개`);

    let totalCommits = 0;

    // 각 리포지토리의 오늘 커밋 수집
    for (const repo of repos) {
      try {
        const commits = await apiGetAll(`/repos/${repo.full_name}/commits`, {
          author: username,
          since: startISO,
          until: endISO,
        });

        for (const commit of commits) {
          // 이미 존재하는 커밋인지 확인
          const existing = await query(
            "SELECT id FROM events WHERE repo = $1 AND meta->>'sha' = $2",
            [repo.full_name, commit.sha]
          );

          if (existing.length === 0) {
            await saveEvent({
              ts: commit.commit.author.date,
              actor: commit.commit.author.name || username,
              repo: repo.full_name,
              type: "commit",
              title: commit.commit.message.split("\n")[0],
              body: commit.commit.message,
              urls: extractUrls(commit.commit.message),
              meta: {
                sha: commit.sha,
                url: commit.html_url,
                stats: commit.stats || {},
              },
            });
            totalCommits++;
          }
        }
      } catch (error) {
        console.error(
          `[sync] ${repo.full_name} 커밋 수집 실패:`,
          error.message
        );
      }
    }

    // 오늘의 이슈 활동 수집
    const issues = await apiGetAll("/issues", {
      filter: "all",
      state: "all",
      since: startISO,
    });

    let totalIssues = 0;
    for (const issue of issues) {
      if (issue.user.login === username) {
        const existing = await query(
          "SELECT id FROM events WHERE repo = $1 AND type = 'issue' AND meta->>'number' = $2",
          [issue.repository?.full_name || "unknown", issue.number.toString()]
        );

        if (existing.length === 0) {
          await saveEvent({
            ts: issue.created_at,
            actor: username,
            repo: issue.repository?.full_name || "unknown",
            type: "issue",
            title: issue.title,
            body: issue.body || "",
            urls: extractUrls(issue.body || ""),
            meta: {
              number: issue.number,
              state: issue.state,
              url: issue.html_url,
            },
          });
          totalIssues++;
        }
      }
    }

    console.log(
      `[sync] 완료: 커밋 ${totalCommits}개, 이슈 ${totalIssues}개 수집`
    );
  } catch (error) {
    console.error("[sync] GitHub 동기화 실패:", error.message);
  }
}
