# Meme’d Campaign Payout Tracker

A full-stack creator campaign marketplace built for the SDE I assignment. Brands create Instagram/YouTube campaigns with milestone ladders and a fixed INR budget. Creators discover live campaigns, submit post URLs, and track milestone-based earnings.

## Features

- JWT signup/login with `brand` and `creator` roles; bcrypt password hashing.
- Brand campaign creation, editable milestone ladder, and budget spent/remaining dashboard.
- Creator campaign discovery, post submission, earnings totals, and view-sync simulation.
- Highest-milestone payout calculation; incremental payments only; campaign budget cap.
- MongoDB transactions plus a conditional budget update to protect against concurrent overspending. MongoDB transactions require a replica set (MongoDB Atlas is suitable).
- Unusual view-spike flagging when views jump by at least 1,000 and at least 3x the recent baseline within an hour.
- Jest unit tests for milestone calculation and budget caps.
- Responsive dashboard UI and Docker Compose setup for local development.

## Project structure

```text
/backend
  /src/server.ts
  /src/payout.ts
  /src/__tests__/payout.test.ts
/frontend
  /app/page.tsx
  /app/layout.tsx
  /app/globals.css
  .env.example
.env.example
README.md
docker-compose.yml
```

## Requirements

- Node.js 20+ (Node 22 LTS recommended)
- pnpm 9/10 or npm
- MongoDB replica set. MongoDB Atlas free cluster is the easiest option for transaction support.

## Run locally

1. Install pnpm if needed: `npm install -g pnpm`.
2. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI` to your MongoDB Atlas connection string, plus a strong random `JWT_SECRET`.
3. Copy `frontend/.env.example` to `frontend/.env.local`. The default API URL is `http://localhost:4000`.
4. From the repository root run `pnpm install`, then `pnpm dev`.
5. Open `http://localhost:3000`. The API health check is `http://localhost:4000/api/health`.

You can run each service separately using `pnpm dev:web` and `pnpm dev:api` from the root. For production, set `NEXT_PUBLIC_API_URL` to the deployed backend URL and `FRONTEND_URL` to the deployed frontend origin.

## Environment variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | API port (default `4000`) |
| `MONGODB_URI` | Yes | MongoDB replica-set connection string |
| `JWT_SECRET` | Yes in production | Long, random signing secret; development fallback is unsafe for deployment |
| `FRONTEND_URL` | No | Comma-separated allowed frontend origins; defaults to permissive CORS for local development |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Base URL of the Express API, no trailing slash needed |

## API overview

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/signup` | Public | Create brand/creator account |
| `POST` | `/api/auth/login` | Public | Log in and return JWT |
| `GET` | `/api/auth/me` | Authenticated | Current user profile |
| `POST` | `/api/campaigns` | Brand | Create campaign |
| `GET` | `/api/campaigns` | Authenticated | List campaigns with budget remaining and live status |
| `GET` | `/api/campaigns/mine` | Brand | List own campaigns |
| `POST` | `/api/campaigns/:id/submissions` | Creator | Submit a post URL |
| `GET` | `/api/submissions/mine` | Creator | List own submissions |
| `GET` | `/api/earnings` | Creator | Aggregated payout total |
| `PATCH` | `/api/submissions/:id/views` | Simulated platform sync; no auth by assignment | Update views and recalculate payout |

The view-sync endpoint is intentionally unauthenticated to match the brief. In a production deployment, protect it with a trusted platform webhook signature or internal service authentication.

## Tests

```bash
pnpm test
```

Tests cover highest crossed milestone, no payout below the first threshold, order-independent milestone ladders, budget caps, incremental payout on repeated updates, and preventing negative payments.

## Assumptions and edge cases

1. **Milestones:** Thresholds must be unique positive integers. Payouts must be non-negative, non-decreasing as thresholds rise, and no individual payout can exceed the campaign budget. The highest crossed milestone sets the target payout.
2. **Incremental payouts:** A view update pays only `target payout - already paid`; repeated updates at the same threshold do not pay again. If views decrease later, already-paid money is not clawed back.
3. **Budget runs out mid-payout:** Pay the lesser of the unpaid target amount and remaining campaign budget. This can leave a submission below its full milestone payout; no campaign can spend past its budget.
4. **Simultaneous updates:** A MongoDB transaction coordinates submission and campaign changes. A conditional campaign update is the final budget guard. MongoDB standalone mode does not support transactions; use Atlas or a local replica set.
5. **Live campaigns:** Campaigns remain discoverable while budget remains. When spent reaches total budget, the campaign is not live and new submissions are blocked.
6. **View spikes:** The system flags, but does not reject, unusually fast view growth. This is a basic heuristic, not fraud detection.
7. **Authentication:** JWTs expire after seven days; role-based routes prevent creators from creating campaigns and brands from submitting posts.
8. **Post URLs:** Any HTTP(S) URL is accepted; platform-specific URL verification is outside this simulation assignment.

## Scaling to 10,000 creators (short note)

Keep the API stateless behind a load balancer and scale the Node.js service horizontally. Use MongoDB Atlas with appropriate indexes on campaign owner, campaign status, creator submissions, and timestamps; use transactions only on payout-critical writes. Add a durable queue for view-sync ingestion, spike analysis, notifications, and analytics so bursts do not block user-facing requests. Cache read-heavy live campaign lists with Redis and invalidate on campaign/budget changes. Rate-limit authentication and public endpoints, validate webhook signatures for platform updates, and use idempotency keys for event processing. Add structured logs, tracing, metrics, alerts, and backups. At larger scale, separate analytics/read models from the transactional payout path and reconcile payout ledgers periodically.

## Deployment checklist

- Push this project to a **public** GitHub repository.
- Deploy `/backend` to Render (build: `pnpm install && pnpm --dir backend build`; start: `pnpm --dir backend start`) and configure backend environment variables.
- Deploy `/frontend` to Vercel (root directory `frontend`; build command `pnpm build`) and set `NEXT_PUBLIC_API_URL`.
- Configure `FRONTEND_URL` to the deployed Vercel origin, verify `/api/health`, signup/login, campaign creation, submission, and view-sync flows.
- Add the actual deployed URL here after deployment. No live deployment is claimed by this repository snapshot: **Live URL: pending deployment**.

## Docker

`docker-compose.yml` provides the frontend, API, and a single-node MongoDB replica set for local development. The MongoDB init step enables transactions for local testing.


## Local development troubleshooting

- The frontend can run on `http://localhost:3000` or `http://localhost:3001` if port 3000 is already occupied. The API CORS configuration allows local development ports on `localhost` and `127.0.0.1`.
- If signup/login fails, confirm the backend is running on port `4000`, `MONGODB_URI` is valid, and `http://localhost:4000/api/health` returns `{ "ok": true, "service": "memed-api" }`.
- If the browser still reports CORS, stop old Node processes (`Ctrl+C` in both terminals), then restart the API from the project root with `pnpm dev:api`. Check the health URL before restarting the frontend. A backend that failed to connect to MongoDB will exit and cannot answer the preflight request.
- After editing `backend/.env` or backend source, stop and restart the backend process.
