import express from "express";
import { query } from "./db.js";
import { extractUrls, toYmd } from "./utils.js";

export const router = express.Router();

function verify(req, res, next) {
  const token = req.headers["x-gitlab-token"];
  if (!process.env.WEBHOOK_SECRET || token === process.env.WEBHOOK_SECRET)
    return next();
  return res.status(401).send("Invalid webhook token");
}

router.post("/gitlab", verify, async (req, res) => {
  const ev = req.header("X-Gitlab-Event");
  const p = req.body;

  try {
    if (ev === "Push Hook") {
      const repo = p?.project?.path_with_namespace || "unknown";
      for (const c of p.commits || []) {
        await saveEvent({
          ts: c.timestamp,
          actor: c.author?.name || c.author?.email || "unknown",
          repo,
          type: "commit",
          title: (c.message || "").split("\n")[0],
          body: c.message || "",
          urls: extractUrls(c.message || ""),
          meta: {
            added: c.added || [],
            modified: c.modified || [],
            removed: c.removed || [],
          },
        });
      }
    }

    if (ev === "Merge Request Hook") {
      const a = p.object_attributes || {};
      await saveEvent({
        ts: a.updated_at || a.created_at || new Date().toISOString(),
        actor: p.user?.name || p.user?.username || "unknown",
        repo: p.project?.path_with_namespace || "unknown",
        type: "mr",
        title: a.title || "",
        body: a.description || "",
        urls: extractUrls(a.description || ""),
        meta: {
          state: a.state,
          iid: a.iid,
          source_branch: a.source_branch,
          target_branch: a.target_branch,
        },
      });
    }

    if (ev === "Note Hook") {
      const a = p.object_attributes || {};
      await saveEvent({
        ts: a.created_at || new Date().toISOString(),
        actor: p.user?.name || p.user?.username || "unknown",
        repo: p.project?.path_with_namespace || "unknown",
        type: "note",
        title: (a.note || "").slice(0, 100),
        body: a.note || "",
        urls: extractUrls(a.note || ""),
        meta: { on: a.noteable_type, ref: a.id, mr_iid: p.merge_request?.iid },
      });
    }

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

async function saveEvent({ ts, actor, repo, type, title, body, urls, meta }) {
  const ymd = toYmd(ts);
  await query(
    `INSERT INTO events (ts, ymd, actor, repo, type, title, body, urls, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ts, ymd, actor, repo, type, title, body, urls, meta]
  );
}
