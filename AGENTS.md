# Repository Guidelines

## Project Structure & Module Organization
This repo is split into two deployable surfaces plus local infrastructure. `backend/app` hosts the FastAPI service: `routes/analysis.py` exposes the API, `services/analysis_orchestrator.py` coordinates ATS, keyword, skill, semantic, career-fit, and highlight engines, and `models/` stores SQLAlchemy and Pydantic contracts. `core/` centralizes config, DB session, and logging, while `utils/text.py` contains shared text normalization helpers.

`frontend/` is a Next.js application. `pages/index.tsx` is the dashboard entry point, with feature areas separated into `resume-preview/`, `keyword-panel/`, and `score-dashboard/`. Shared UI primitives live in `components/ui`, and `lib/api.ts` contains backend integration methods.

`docker-compose.yml` provides local PostgreSQL (`cvforge-postgres`) used by backend persistence.

## Build, Test, and Development Commands
Use the commands already defined in the repo:

- `docker compose up -d` to start PostgreSQL.
- Backend setup/run:
  - `cd backend`
  - `python -m venv .venv && source .venv/bin/activate`
  - `pip install -r requirements.txt`
  - `uvicorn app.main:app --reload --port 8000`
- Frontend setup/run:
  - `cd frontend && npm install`
  - `npm run dev` (local dev), `npm run build` (production build), `npm run start` (serve build), `npm run lint` (Next.js lint task).

There is no dedicated automated test script yet; current verification is lint/build plus backend import/syntax checks.

## Coding Style & Naming Conventions
TypeScript is configured with `strict: true` in `frontend/tsconfig.json`; keep new frontend code fully typed and use the existing `@/*` path alias. Follow current frontend naming patterns: kebab-case filenames, React function components in PascalCase exports.

Backend code is strongly typed Python with service-class boundaries and Pydantic schemas. Keep engine logic inside `backend/app/services` and API wiring in `routes`.

No standalone ESLint/Prettier/Ruff/Pre-commit config files are committed yet, so avoid introducing new tooling conventions without team agreement.

## Commit & Pull Request Guidelines
`main` currently has no commit history, so no project-specific commit convention is established yet. Start with short imperative commit messages and keep commits scoped to one logical change (for example, backend engine update vs. frontend dashboard refinement). No PR template is present in the repository at this time.
