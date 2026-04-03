# CV Forge - AI Resume Analyzer Platform

Production-grade resume analysis SaaS architecture with a FastAPI backend and Next.js frontend.

## System Architecture

- `frontend/`: Next.js + Tailwind + ShadCN-style components + Monaco editor
- `backend/`: FastAPI microservice with modular analysis engines
- `docker-compose.yml`: local PostgreSQL

### Analysis Engines

- Resume Parser: PDF/DOCX/TXT ingestion with section extraction
- ATS Engine: deterministic rule-based scoring (0-100)
- Skill Matching Engine: embedding-based matching using `all-MiniLM-L6-v2`
- Semantic Analyzer: LLM-driven JSON feedback (OpenAI), with heuristic fallback
- Career Fit Engine: trajectory and gap analysis
- Highlight Engine: inline resume annotations (green/yellow/red)
- Report Generator: downloadable PDF analysis report

## Backend Structure

```text
backend/
  app/
    main.py
    core/
      config.py
      database.py
      logging.py
    routes/
      analysis.py
      health.py
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
      vector_store.py
    models/
      db_models.py
      schemas.py
    utils/
      text.py
```

## Frontend Structure

```text
frontend/
  components/
    analysis-sidebar.tsx
    ui/
  pages/
    _app.tsx
    index.tsx
  resume-preview/
    resume-preview.tsx
  keyword-panel/
    keyword-panel.tsx
  score-dashboard/
    score-dashboard.tsx
  lib/
    api.ts
    types.ts
    utils.ts
```

## Local Setup

1. Start PostgreSQL:
   - `docker compose up -d`
2. Backend:
   - `cd backend`
   - `python -m venv .venv && source .venv/bin/activate`
   - `pip install -r requirements.txt`
   - `cp .env.example .env` and set `OPENAI_API_KEY`
   - `uvicorn app.main:app --reload --port 8000`
3. Frontend:
   - `cd frontend`
   - `npm install`
   - `cp .env.local.example .env.local`
   - `npm run dev`

## API Endpoints

- `POST /api/v1/analysis/upload`: analyze uploaded resume file + job description
- `POST /api/v1/analysis/reanalyze`: analyze edited resume text
- `GET /api/v1/analysis/{analysis_id}`: fetch analysis detail
- `GET /api/v1/analysis/{analysis_id}/report`: download PDF report
- `GET /api/v1/health`: service health status

## Notes

- Semantic analysis returns strict structured JSON and gracefully falls back when LLM is unavailable.
- Score deltas are tracked across analysis versions using `previous_analysis_id`.
- Highlight spans are returned as character offsets for frontend rendering.
