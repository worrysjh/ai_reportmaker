import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 템플릿 파일을 읽어오는 함수
function loadTemplate(templateName) {
  const templatePath = path.join(__dirname, "..", "templates", templateName);
  try {
    return fs.readFileSync(templatePath, "utf8");
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
    actor: actor,
    ymd: ymd,
    important_events: JSON.stringify(groups.important, null, 2),
    minor_events: JSON.stringify(groups.minor, null, 2),
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
