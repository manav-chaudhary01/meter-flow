# MeterFlow

**A Multi-Tenant SaaS Metered Billing Platform with Predictive Spend Alerts**

MeterFlow is a backend-focused SaaS platform designed to help individuals and organizations monitor paid digital-service consumption, calculate usage-based costs, manage budgets, and forecast future expenditure.

The system is built on a shared backend architecture supporting both personal and organization workspaces while enforcing strict workspace-level data isolation.

---

## Architecture & Technology Stack

| Layer | Technology | Description |
|---|---|---|
| **Runtime & Language** | Node.js (v24+) / ECMAScript Modules | Asynchronous backend runtime |
| **Framework** | Express.js (v5) | HTTP REST API framework |
| **Database** | MongoDB Atlas & Mongoose (v9) | Multi-tenant persistent document store |
| **Precision Math** | Decimal.js | Arbitrary-precision financial arithmetic |
| **Authentication** | JWT (`jsonwebtoken`) & `bcryptjs` | Stateless signed tokens & password hashing |
| **Workspaces & RBAC** | Multi-tenant Workspaces & RBAC | Personal/Organization workspace separation (`owner`, `admin`, `member`) |
| **Catalog & Ingestion** | Metered / Subscription / Hybrid Catalog | Usage tracking with database-backed idempotency protection |
| **Billing Engine** | High-Precision Billing Engine | Subscription & metered charge calculations, period generation, usage reconciliation, idempotency |
| **Budgets & Forecasts** | Workspace Budgets & Spend Forecasting | Actual-spend calculation, multi-threshold alerts, explainable linear burn-rate forecasts |
| **Security** | `helmet` & `cors` | HTTP security headers and CORS protection |
| **Testing** | Node native test runner (`node:test`), `supertest`, `mongodb-memory-server` | Zero-dependency, offline-capable automated test suite |

---

## Project Structure

```text
meter-flow/
├── backend/
│   ├── src/
│   │   ├── app.js               # Express app & route mounting
│   │   ├── server.js            # Entry point, DB connect & idempotent migration
│   │   ├── config/              # Database & environment configuration
│   │   ├── controllers/         # Handlers (auth, workspace, service, usage, billing, budget, resource)
│   │   ├── middleware/          # JWT auth & role-based access control
│   │   ├── models/              # Mongoose schemas (Tenant, User, Membership, TrackedService, UsageRecord, BillingRecord, Budget, BudgetAlert, Resource)
│   │   ├── routes/              # Express API route modules
│   │   ├── services/            # Pure calculation & evaluation engines (billingCalculator, spendCalculator, spendForecaster, alertEvaluator)
│   │   └── utils/               # Migration & workspace backfill utilities
│   └── tests/                   # Automated unit & integration test suite (118 tests)
│       ├── helpers/db.js        # In-memory test database runner
│       ├── health.test.js       # Health check & 404 tests
│       ├── auth.test.js         # Authentication tests
│       ├── workspace.test.js    # Workspace & membership tests
│       ├── trackedService.test.js # Service catalog (metered, subscription, hybrid) tests
│       ├── usage.test.js        # Usage ingestion, idempotency & aggregation tests
│       ├── billing.test.js      # Billing calculation, periods, reconciliation & idempotency tests
│       ├── budgets.test.js      # Budget CRUD, actual spend, threshold alerts & forecasting tests
│       ├── resource.test.js     # Resource CRUD tests
│       ├── tenantIsolation.test.js # Multi-tenant isolation tests
│       └── migration.test.js    # Idempotent migration verification
├── docs/
│   ├── API.md                   # Complete REST API specification
│   ├── Meter-Flow-Synopsis.pdf  # Project synopsis document
│   └── SYNOPSIS.md              # Project synopsis & original proposal
└── ml/
    └── requirements.txt         # Python dependencies for spend forecasting
```

---

## Getting Started

### 1. Prerequisites
- **Node.js**: v20 or higher (v24 recommended)
- **npm**: v10 or higher
- **Python**: v3.12+ (for forecasting service in Phase F)

### 2. Environment Configuration
Create a `.env` file in `backend/` (do not commit this file):

```ini
PORT=5000
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xnaulto.mongodb.net/meterflow
JWT_SECRET=your-secure-jwt-secret-key-here
```

> **Note:** If connecting to MongoDB Atlas, ensure your current public IP is added to the Atlas IP Access List (Network Access). Automated tests run with an embedded in-memory MongoDB instance and do not require Atlas network access.

### 3. Installation
```powershell
cd meter-flow/backend
npm install
```

### 4. Running the Development Server
```powershell
npm run dev
```
The server will start on `http://localhost:5000` and automatically backfill any missing workspace types or memberships idempotently.

### 5. Running Database Migration Standalone
```powershell
npm run migrate:workspaces
```

### 6. Running the Automated Test Suite
```powershell
npm test
```
The test suite executes 118 automated tests across 39 test suites using Node's native test runner (`node:test`) with an isolated in-memory MongoDB instance. No external database connection is required.

---

## API Endpoints Overview

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | Service health status | No |
| `POST` | `/api/auth/register` | Register user & initial workspace | No |
| `POST` | `/api/auth/login` | Authenticate user | No |
| `GET` | `/api/auth/me` | Current user & active tenant identity | Yes |
| `GET` | `/api/workspaces` | List caller's accessible workspaces | Yes |
| `POST` | `/api/workspaces` | Create personal or organization workspace | Yes |
| `POST` | `/api/workspaces/switch` | Switch active workspace (issues fresh JWT) | Yes |
| `GET` | `/api/workspaces/:id/members` | List members of a workspace | Yes |
| `POST` | `/api/workspaces/:id/members` | Add member to organization workspace | Yes (Owner/Admin) |
| `DELETE` | `/api/workspaces/:id/members/:userId` | Remove member from workspace | Yes (Owner/Admin) |
| `POST` | `/api/services` | Create tracked service (metered, subscription, hybrid) | Yes (Owner/Admin) |
| `GET` | `/api/services` | List tracked services in active workspace | Yes |
| `GET` | `/api/services/:id` | Get tracked service by ID | Yes |
| `PUT` | `/api/services/:id` | Update tracked service | Yes (Owner/Admin) |
| `DELETE` | `/api/services/:id` | Archive tracked service | Yes (Owner/Admin) |
| `POST` | `/api/usage` | Ingest metered usage with idempotency protection | Yes |
| `GET` | `/api/usage` | List paginated usage history with date filters | Yes |
| `GET` | `/api/usage/summary` | Aggregate usage by service, day, or month | Yes |
| `GET` | `/api/usage/:id` | Get usage record by ID | Yes |
| `POST` | `/api/billing/generate` | Generate period bill with usage reconciliation | Yes (Owner/Admin) |
| `GET` | `/api/billing` | List paginated billing records for active workspace | Yes |
| `GET` | `/api/billing/:id` | Get billing record by ID with line items | Yes |
| `GET` | `/api/billing/:id/usage` | Inspect usage records reconciled to a bill | Yes |
| `POST` | `/api/budgets` | Create workspace budget with alert thresholds | Yes (Owner/Admin) |
| `GET` | `/api/budgets` | List workspace budgets with spend and forecasts | Yes |
| `GET` | `/api/budgets/:id` | Get budget by ID with forecast & alerts | Yes |
| `PUT` | `/api/budgets/:id` | Update budget amount, name, or thresholds | Yes (Owner/Admin) |
| `DELETE` | `/api/budgets/:id` | Soft-deactivate (archive) budget | Yes (Owner/Admin) |
| `POST` | `/api/budgets/:id/evaluate` | Manually evaluate thresholds & trigger alerts | Yes (Owner/Admin) |
| `GET` | `/api/budgets/alerts` | List workspace spend-threshold alerts | Yes |
| `PATCH` | `/api/budgets/alerts/:alertId/ack` | Acknowledge triggered budget alert | Yes |
| `POST` | `/api/resources` | Create legacy priced resource in active workspace | Yes |
| `GET` | `/api/resources` | List legacy resources | Yes |
| `GET` | `/api/resources/:id` | Get legacy resource by ID | Yes |
| `PUT` | `/api/resources/:id` | Update legacy resource details | Yes |
| `DELETE` | `/api/resources/:id` | Delete legacy resource | Yes |

For full request/response schemas, parameters, and examples, see [docs/API.md](docs/API.md).

---

## Development Roadmap

- [x] **Milestone A — Stabilize Backend Foundation**: Automated testing, environment validation, tenant boundary verification, Mongoose 9 updates, API docs.
- [x] **Milestone B — Workspace Architecture**: Personal vs. organization workspaces, Membership model, workspace switching, RBAC (`owner`, `admin`, `member`), migration backfill.
- [x] **Milestone C — Service Catalog & Usage Ingestion**: Tracked service catalog (`metered`, `subscription`, `hybrid`), usage ingestion, database-enforced idempotency, history & aggregation pipelines.
- [x] **Milestone D — Billing Engine**: High-precision Decimal.js calculation, billing period calculation, invoice records, usage reconciliation, idempotency.
- [x] **Milestone E — Budgets & Analytics**: Budget allocation, spend tracking, threshold alerts, explainable linear burn-rate forecasts.
- [ ] **Milestone F — Predictive Spending**: Python service, scikit-learn forecasting, predictive alerts.
- [ ] **Milestone G — Hardening & Final Verification**: Seed data, end-to-end flows, deployment guides.
