# AI Report Maker

GitLab/GitHub 이벤트를 자동으로 수집하고 AI를 활용하여 일일/주간 보고서를 생성하는 시스템입니다.
pull test 2입니다.

## 📋 주요 기능

- **웹훅 수신**: GitLab/GitHub에서 발생하는 커밋, 이슈, 머지 요청 등의 이벤트를 실시간으로 수집
- **자동 스케줄링**: 매일 18:00에 일일 보고서, 매주 금요일 17:00에 주간 보고서 자동 생성
- **AI 요약**: Ollama AI 모델을 활용하여 개발 활동을 자연어로 요약
- **보고서 생성**: 마크다운 형식으로 구조화된 보고서 파일 생성

## 🏗️ 시스템 구조

```
src/
├── index.js              # Express 서버 진입점
├── webhooks.gitlab.js    # GitLab 웹훅 처리
├── scheduler.js          # 자동 보고서 생성 스케줄러
├── sync.gitlab.account.js # GitLab 계정 활동 동기화
├── db.js                 # PostgreSQL 데이터베이스 연결
├── summarize.js          # AI 요약 기능
├── condenser.js          # 데이터 압축 및 정리
├── utils.js              # 유틸리티 함수
└── schema.sql            # 데이터베이스 스키마
```

## 🚀 설치 및 실행

### 1. 환경 요구사항

- Node.js (16.0 이상)
- PostgreSQL
- Ollama AI 모델 서버
- GitLab/GitHub 계정 및 Personal Access Token

### 2. 의존성 설치

```bash
npm install
```

### 3. 환경 변수 설정

`.env` 파일을 생성하고 다음 내용을 설정하세요:

```env
# 서버 설정
PORT=3000

# GitLab 웹훅 보안
WEBHOOK_SECRET=your_webhook_secret_here

# GitLab API 설정
GITLAB_BASE_URL=https://gitlab.example.com/api/v4
GITLAB_TOKEN=glpat-your_gitlab_personal_access_token
GITLAB_USERNAME=your_gitlab_username
GITLAB_AUTHOR_EMAIL=your_email@example.com

# Ollama AI 모델 설정
OLLAMA_URL=http://localhost:11434
LLM_MODEL=llama3.1:8b

# 타임존 설정
TZ=Asia/Seoul

# 보고서 작성자
REPORT_ACTOR=홍길동

# PostgreSQL 데이터베이스 설정
PGHOST=localhost
PGPORT=5432
PGDATABASE=reportmaker
PGUSER=postgres
PGPASSWORD=your_password
```

### 4. PostgreSQL 데이터베이스 실행

Docker Compose를 사용하여 PostgreSQL을 실행하세요:

```bash
docker-compose up -d
```

### 5. 서버 실행

```bash
# 개발 모드
npm run dev

# 프로덕션 모드
npm start
```

서버가 정상적으로 실행되면 다음 메시지가 출력됩니다:
```
dev-echo listening on :3000
```

## ⚙️ GitLab 웹훅 설정

1. GitLab 프로젝트의 **Settings → Webhooks**로 이동
2. 다음 정보를 입력:
   - **URL**: `http://<서버IP>:3000/webhooks`
   - **Secret Token**: `.env` 파일의 `WEBHOOK_SECRET` 값
   - **Trigger**: Push events, Merge request events 체크
3. **Add webhook** 버튼 클릭

## 🤖 Ollama AI 모델 설정

1. [Ollama](https://ollama.ai/) 설치
2. AI 모델 다운로드:
   ```bash
   ollama pull llama3.1:8b
   ```
3. Ollama 서버 실행:
   ```bash
   ollama serve
   ```

## 📊 API 엔드포인트

- `GET /health` - 서버 상태 확인
- `POST /webhooks` - GitLab 웹훅 수신
- `POST /sync/today` - 오늘 활동 수동 동기화 (개발용)

## 📈 보고서 형식

생성되는 보고서는 다음과 같은 구조를 가집니다:

```markdown
# YYYY-MM-DD 일일보고 - 작성자명

## 1) 오늘의 성과
- 주요 완료 작업 내용

## 2) 주요 변경사항
- 핵심 기술적 변경사항

## 3) 이슈/리스크 및 대응
- 발생한 문제점과 해결 방안

## 4) 내일/다음 계획
- 구체적인 액션 플랜

## 5) 참고 링크
- [제목](URL) - 한줄 설명
```

## 🔄 자동 스케줄링

- **일일 보고서**: 매일 18:00 (KST) 자동 생성
- **주간 보고서**: 매주 금요일 17:00 (KST) 자동 생성
- **데이터 수집**: 매일 17:50 (KST) GitLab 활동 동기화

## 📁 파일 출력

생성된 보고서는 `reports/` 디렉토리에 저장됩니다:
- 일일 보고서: `YYYY-MM-DD-작성자명-daily.md`
- 주간 보고서: `YYYY-MM-DD-작성자명-weekly.md`

## 🔧 개발 및 디버깅

### 로그 확인
서버 실행 시 콘솔에서 다음 정보를 확인할 수 있습니다:
- 웹훅 수신 로그
- AI 요약 처리 상태
- 스케줄러 실행 로그
- 데이터베이스 연결 상태

### 수동 테스트
```bash
# 오늘 활동 수동 동기화
curl -X POST http://localhost:3000/sync/today

# 서버 상태 확인
curl http://localhost:3000/health
```

## 🛡️ 보안 고려사항

- `.env` 파일은 절대 Git에 커밋하지 마세요
- GitLab Personal Access Token은 최소 권한으로 설정하세요
- 웹훅 Secret Token은 예측하기 어려운 값으로 설정하세요
- 서버 외부 공개 시 적절한 방화벽 설정을 하세요

## 🐛 문제 해결

### 웹훅이 동작하지 않는 경우
1. GitLab 웹훅 설정 확인
2. 서버 외부 접근 가능 여부 확인
3. Secret Token 일치 여부 확인
4. 서버 로그에서 에러 메시지 확인

### AI 요약이 실패하는 경우
1. Ollama 서버 실행 상태 확인
2. `OLLAMA_URL` 환경 변수 확인
3. AI 모델 다운로드 여부 확인

### 데이터베이스 연결 실패
1. PostgreSQL 컨테이너 실행 상태 확인
2. 데이터베이스 접속 정보 확인
3. 네트워크 연결 상태 확인

## 📄 라이선스

MIT License

## 👥 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

**Note**: 이 프로젝트는 개발팀의 활동을 자동으로 요약하여 보고서를 생성하는 도구입니다. 실제 운영 환경에서 사용할 때는 보안 및 개인정보 보호에 주의하세요.
