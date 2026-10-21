# SmartFreight AI

Freight forwarding assistant that turns client offers and live carrier/container supply into a
Best Formula Matrix: Option A (lowest cost), B (fastest transit) and C (balanced).

## Run locally

```bash
# API on :8000
cd backend
pip install -e ".[dev]"
uvicorn app.main:app --reload

# Dashboard on :5173 (proxies /api to :8000)
cd frontend
npm install
npm run dev
```

Without the API running, the dashboard shows a bundled example offer.
`npm run build:preview` builds a single self-contained HTML file in `frontend/dist-preview/`.

## Layout

- `backend/app/agent/prompts/best_formula_matrix.md`: the agent's system prompt
- `backend/app/agent/schemas.py`: the matrix contract (exactly A/B/C, margin formula, equipment, risk)
- `backend/app/main.py`: API for the dashboard (offers, matrix, answer validation)
- `frontend/`: React + Vite + Tailwind dashboard
