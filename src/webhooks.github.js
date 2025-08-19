import express from "express";
import crypto from "crypto";
import { query } from "./db.js";
import { extractUrls, toYmd } from "./utils.js";

export const router = express.Router();

function verify(req, res, next) {
  const signature = req.headers["x-hub-signature-256"];
  const secret = process.env.WEBHOOK_SECRET;

  if (!secret) return next(); // 시크릿이 없으면 검증 스킵

  if (!signature) {
    return res.status(401).send("Missing signature");
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(req.body))
    .digest("hex")}`;

  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  ) {
    return res.status(401).send("Invalid signature");
  }

  return next();
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

router.post("/", (req, res) => {
  console.log("GitHub webhook received: ");
  console.log("Headers: ", req.headers);
  console.log("Payload: ", req.body);

  res.status(200).send("Webhook processed");
});

router.post("/github", verify, async (req, res) => {
  const event = req.header("X-GitHub-Event");
  const payload = req.body;

  try {
    console.log(`GitHub event received: ${event}`);

    if (event === "push") {
      const repo = payload.repository?.full_name || "unknown";

      for (const commit of payload.commits || []) {
        await saveEvent({
          ts: commit.timestamp,
          actor: commit.author?.name || commit.author?.email || "unknown",
          repo,
          type: "commit",
          title: (commit.message || "").split("\n")[0],
          body: commit.message || "",
          urls: extractUrls(commit.message || ""),
          meta: {
            added: commit.added || [],
            modified: commit.modified || [],
            removed: commit.removed || [],
            sha: commit.id,
          },
        });
      }
      console.log(
        `Processed ${payload.commits?.length || 0} commits for ${repo}`
      );
    }

    if (event === "pull_request") {
      const pr = payload.pull_request;
      await saveEvent({
        ts: pr.updated_at || pr.created_at || new Date().toISOString(),
        actor: payload.sender?.login || "unknown",
        repo: payload.repository?.full_name || "unknown",
        type: "pr",
        title: pr.title || "",
        body: pr.body || "",
        urls: extractUrls(pr.body || ""),
        meta: {
          state: pr.state,
          action: payload.action,
          number: pr.number,
          merged: pr.merged,
        },
      });
      console.log(
        `Processed PR #${pr.number} for ${payload.repository?.full_name}`
      );
    }

    if (event === "issues") {
      const issue = payload.issue;
      await saveEvent({
        ts: issue.updated_at || issue.created_at || new Date().toISOString(),
        actor: payload.sender?.login || "unknown",
        repo: payload.repository?.full_name || "unknown",
        type: "issue",
        title: issue.title || "",
        body: issue.body || "",
        urls: extractUrls(issue.body || ""),
        meta: {
          state: issue.state,
          action: payload.action,
          number: issue.number,
        },
      });
      console.log(
        `Processed issue #${issue.number} for ${payload.repository?.full_name}`
      );
    }

    res.status(200).send("GitHub event processed successfully");
  } catch (error) {
    console.error("Error processing GitHub event:", error);
    res.status(500).send("Error processing GitHub event");
  }
});

// GitLab 라우트는 유지 (기존 코드와의 호환성)
router.post("/gitlab", (req, res) => {
  res.status(200).send("GitLab webhooks are disabled");
});
