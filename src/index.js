import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import { initDb } from "./utils/db.js";
import { router as gitlabRouter } from "./gitlab/webhooks.gitlab.js";
import { router as githubRouter } from "./github/webhooks.github.js";
import { startSchedulers } from "./scheduler.js";
import { dailyReport } from "./utils/summarize.js";
import { syncTodayForAccount } from "./github/sync.github.account.js";

const app = express();
app.use(bodyParser.json({ limit: "5mb" }));
app.use("/webhooks", gitlabRouter);
app.use("/webhooks", githubRouter);
app.get("/health", (_, res) => res.send("ok"));

// src/index.js 에 추가 라우트(개발 편의)
app.post("/sync/today", async (_, res) => {
  try {
    await syncTodayForAccount();
    res.send("ok");
  } catch (e) {
    console.error(e);
    res.status(500).send("fail");
  }
});

const port = process.env.PORT || 3000;

initDb().then(() => {
  app.listen(port, () => {
    console.log(`dev-echo listening on :${port}`);
    startSchedulers();
    // 개발 중에는 바로 생성 테스트
    dailyReport().catch(console.error);
  });
});
