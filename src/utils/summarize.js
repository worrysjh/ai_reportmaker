import axios from "axios";
import { readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";
import { toYmdLocal } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 템플릿 파일을 읽어오는 함수
function loadTemplate(templateName) {
  // process.cwd()를 사용하여 프로젝트 루트에서 시작
  const templatePath = path.join(process.cwd(), "templates", templateName);
  try {
    console.log(`템플릿 파일 경로: ${templatePath}`);
    return readFileSync(templatePath, "utf8");
  } catch (error) {
    console.error(
      `템플릿 파일을 읽을 수 없습니다: ${templatePath}`,
      error.message
    );
    throw new Error(`템플릿 파일 로드 실패: ${templateName}`);
  }
}

// 템플릿 변수를 실제 값으로 치환하는 함수
function replaceTemplateVariables(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, "g");
    result = result.replace(regex, value);
  }
  return result;
}

export function buildDailyPrompt({ actor, ymd, groups }) {
  const template = loadTemplate("daily-report-prompt.txt");

  const variables = {
    actor,
    ymd,
    important_events: groups.important
      .map((event) => `- ${event.translatedTitle || event.title}`)
      .join("\n"),
    minor_events: groups.minor
      .map((event) => `- ${event.translatedTitle || event.title}`)
      .join("\n"),
  };

  return replaceTemplateVariables(template, variables);
}

export function buildWeeklyPrompt({ actor, startDate, endDate, groups }) {
  const template = loadTemplate("weekly-report-prompt.txt");

  const variables = {
    actor: actor,
    start_date: startDate,
    end_date: endDate,
    important_events: JSON.stringify(groups.important, null, 2),
    minor_events: JSON.stringify(groups.minor, null, 2),
  };

  return replaceTemplateVariables(template, variables);
}

export async function summarizeWithOllama({ prompt }) {
  if (!process.env.OLLAMA_URL) {
    throw new Error("OLLAMA_URL 환경변수가 설정되지 않았습니다.");
  }

  const url = `${process.env.OLLAMA_URL}/api/generate`;
  try {
    const { data } = await axios.post(
      url,
      { model: process.env.LLM_MODEL || "llama3.1:8b", prompt, stream: false },
      { timeout: 120000 }
    );
    return data.response;
  } catch (error) {
    console.error("Ollama API 요청 실패:", error.message);
    throw new Error(`AI 요약 생성 실패: ${error.message}`);
  }
}

export async function dailyReport() {
  try {
    const today = toYmdLocal(new Date());
    const actor =
      process.env.REPORT_ACTOR || process.env.GITHUB_USERNAME || "개발자";

    console.log(`📝 ${today} 일일 보고서 생성 시작...`);

    // 오늘의 이벤트 데이터 조회
    const events = await query(
      "SELECT * FROM events WHERE ymd = $1 ORDER BY ts DESC",
      [today]
    );

    if (events.length === 0) {
      console.log("📭 오늘 수집된 이벤트가 없습니다.");
      return;
    }

    // 이벤트를 중요도별로 분류
    const importantEvents = events.filter(
      (e) => e.type === "commit" || e.type === "issue"
    );
    const minorEvents = events.filter(
      (e) => !["commit", "issue"].includes(e.type)
    );

    // 프롬프트 생성
    const prompt = buildDailyPrompt({
      actor,
      ymd: today,
      groups: {
        important: importantEvents,
        minor: minorEvents,
      },
    });

    // AI로 보고서 생성
    const report = await summarizeWithOllama({ prompt });

    // 데이터베이스에 보고서 저장
    await query(
      `INSERT INTO reports (ymd, scope, author, markdown) VALUES ($1, $2, $3, $4)`,
      [today, "daily", actor, report]
    );

    // 파일로도 보고서 저장
    const reportsDir = path.join(process.cwd(), "reports", "daily");
    await fs.mkdir(reportsDir, { recursive: true });

    const fileName = `${today}.md`;
    const filePath = path.join(reportsDir, fileName);

    await fs.writeFile(filePath, report, "utf-8");

    console.log(`✅ 일일 보고서 생성 완료: ${filePath}`);
    console.log(`✅ 데이터베이스에 일일 보고서 저장 완료`);
    return filePath;
  } catch (error) {
    console.error("❌ 일일 보고서 생성 실패:", error);
    throw error;
  }
}

export async function weeklyReport() {
  try {
    const today = new Date();
    const endDate = toYmdLocal(today);

    // 지난 7일간의 데이터 조회
    const startDate = toYmdLocal(
      new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    );
    const actor =
      process.env.REPORT_ACTOR || process.env.GITHUB_USERNAME || "개발자";

    console.log(`📊 ${startDate} ~ ${endDate} 주간 보고서 생성 시작...`);

    // 주간 이벤트 데이터 조회
    const events = await query(
      "SELECT * FROM events WHERE ymd >= $1 AND ymd <= $2 ORDER BY ts DESC",
      [startDate, endDate]
    );

    if (events.length === 0) {
      console.log("📭 이번 주 수집된 이벤트가 없습니다.");
      return;
    }

    // 프롬프트 생성
    const prompt = buildWeeklyPrompt({
      actor,
      startDate,
      endDate,
      groups: {
        important: events,
      },
    });

    // AI로 보고서 생성
    const report = await summarizeWithOllama({ prompt });

    // 데이터베이스에 보고서 저장
    await query(
      `INSERT INTO reports (ymd, scope, author, markdown) VALUES ($1, $2, $3, $4)`,
      [endDate, "weekly", actor, report]
    );

    // 파일로도 보고서 저장
    const reportsDir = path.join(process.cwd(), "reports", "weekly");
    await fs.mkdir(reportsDir, { recursive: true });

    const fileName = `${startDate}_${endDate}.md`;
    const filePath = path.join(reportsDir, fileName);

    await fs.writeFile(filePath, report, "utf-8");

    console.log(`✅ 주간 보고서 생성 완료: ${filePath}`);
    console.log(`✅ 데이터베이스에 주간 보고서 저장 완료`);
    return filePath;
  } catch (error) {
    console.error("❌ 주간 보고서 생성 실패:", error);
    throw error;
  }
}

export async function translateCommitMessage(message) {
  try {
    const response = await axios.post(
      "http://localhost:11434/api/completions",
      {
        model: "llama3.1:8b",
        prompt: `Translate the following commit message to Korean:\n\n"${message}"`,
      }
    );

    if (response.data && response.data.completion) {
      return response.data.completion.trim();
    } else {
      throw new Error("번역 결과를 가져오지 못했습니다.");
    }
  } catch (error) {
    console.error("❌ 커밋 메시지 번역 실패:", error.message);
    return message; // 번역 실패 시 원본 메시지를 반환
  }
}
