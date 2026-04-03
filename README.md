# CV Forge - AI Resume Analyzer Platform

Production-grade resume analysis platform with asynchronous processing.

## System Architecture

- `frontend/`: Next.js dashboard and Monaco-based resume editor
- `backend/`: FastAPI API, analysis engines, Celery tasks
- `redis`: Celery broker + result backend
- `postgres`: analysis persistence
- `flower`: Celery monitoring UI
- `supabase auth`: user signup/login and JWT issuance

### Analysis Pipeline

`Client -> FastAPI -> Celery queue -> Worker -> Analysis engines -> Redis result -> Client polls status`

## Backend Structure

```text
backend/
  app/
    core/
      config.py
      database.py
      celery_app.py
    routes/
      analysis.py
      health.py
    tasks/
      analysis_tasks.py
    services/
      analysis_orchestrator.py
      resume_parser.py
      ats_engine.py
      keyword_extractor.py
      skill_matcher.py
      semantic_analyzer.py
      career_fit_engine.py
      highlight_engine.py
      report_generator.py
```

## Local Setup

1. Copy environment variables:
   - `cp .env.example .env`
2. Start infra + backend + workers:
   - `docker compose up --build`
3. Start frontend (separate terminal):
   - `cd frontend && npm install && npm run dev`

Service ports:
- FastAPI: `http://localhost:8000`
- Flower: `http://localhost:5555`
- Frontend: `http://localhost:3000`

Required auth env vars:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_JWT_SECRET`

## Async Analysis API

- `POST /api/v1/analysis/upload`
  - Returns: `{ "task_id": "...", "status": "processing" }`
- `POST /api/v1/analysis/reanalyze`
  - Returns: `{ "task_id": "...", "status": "processing" }`
- `GET /api/v1/analysis-status/{task_id}`
  - Processing: `{ "task_id": "...", "status": "processing" }`
  - Completed: `{ "task_id": "...", "status": "completed", "result": { ...analysis... } }`
  - Failed: `{ "task_id": "...", "status": "failed", "error": "..." }`

Additional endpoints:
- `GET /api/v1/analysis/{analysis_id}`
- `GET /api/v1/analysis/{analysis_id}/report`
- `GET /api/v1/analysis/history`
- `GET /api/v1/health`

All analysis routes require `Authorization: Bearer <supabase_access_token>`.

## Frontend Supabase Flow

```ts
import { getSupabaseClient } from "@/lib/supabase";
import { analyzeUpload, pollAnalysisResult } from "@/lib/api";

const supabase = getSupabaseClient();
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password,
});
if (error) throw error;

const accessToken = data.session?.access_token;
if (!accessToken) throw new Error("No Supabase access token");

const queued = await analyzeUpload(file, jobDescription, accessToken);
const analysis = await pollAnalysisResult(queued.task_id, accessToken, {
  intervalMs: 2000,
});
```

## Worker Command

The Celery worker runs with:

```bash
celery -A app.core.celery_app worker --loglevel=info
```
