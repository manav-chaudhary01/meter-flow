# MeterFlow

**A Multi-Tenant SaaS Metered Billing Platform with Predictive Spend Alerts**

MeterFlow is a backend-focused SaaS platform designed to help individuals and organizations monitor paid digital-service consumption, calculate usage-based costs, manage budgets, and forecast future expenditure.

The system is built on a shared backend architecture supporting both personal and organization workspaces while enforcing strict workspace-level data isolation.

---

## Architecture & Technology Stack

| Layer | Technology | Description |
|---|---|---|
| **Frontend UI** | HTML5 / CSS3 / Vanilla JavaScript | Single-origin responsive web app (no frameworks, no bundlers) |
| **Runtime & Language** | Node.js (v24+) / ECMAScript Modules | Asynchronous backend runtime |
| **Framework** | Express.js (v5) | HTTP REST API framework & static asset server |
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
│   │   ├── app.js               # Express app, static serving & route mounting
│   │   ├── server.js            # Entry point, DB connect & idempotent migration
│   │   ├── config/              # Database & environment configuration
│   │   ├── controllers/         # Handlers (auth, workspace, service, usage, billing, budget, resource)
│   │   ├── middleware/          # JWT auth & role-based access control
│   │   ├── models/              # Mongoose schemas (Tenant, User, Membership, TrackedService, UsageRecord, BillingRecord, Budget, BudgetAlert, Resource)
│   │   ├── routes/              # Express API route modules
│   │   ├── services/            # Pure calculation & evaluation engines (billingCalculator, spendCalculator, spendForecaster, alertEvaluator, forecasting/)
│   │   └── utils/               # Migration & workspace backfill utilities
│   └── tests/                   # Automated unit & integration test suite (293 tests across 83 suites)
│       ├── helpers/db.js        # In-memory test database runner
│       ├── health.test.js       # Health check & 404 tests
│       ├── auth.test.js         # Authentication tests
│       ├── workspace.test.js    # Workspace & membership tests
│       ├── trackedService.test.js # Service catalog (metered, subscription, hybrid) tests
│       ├── usage.test.js        # Usage ingestion, idempotency & aggregation tests
│       ├── billing.test.js      # Billing calculation, periods, reconciliation & idempotency tests
│       ├── budgets.test.js      # Budget CRUD, actual spend, threshold alerts & forecasting tests
│       ├── forecasting/         # Forecasting evaluation tests (Linear Run-Rate vs. ARIMA) (16 tests)
│       ├── reliability.test.js  # Milestone F reliability, reconciliation & operational tests
│       ├── e2eWorkflow.test.js  # Milestone G 15-step end-to-end integration lifecycle tests
│       ├── frontendServing.test.js # Frontend static serving, routing & security boundary tests (21 tests)
│       ├── securityHardening.test.js # Application security, CSP, input validation, prototype pollution & error sanitization tests (21 tests)
│       ├── responsiveA11yUx.test.js # Responsive UI, WCAG AA accessibility, focus trapping & UX tests (36 tests)
│       ├── apiContracts.test.js # API contract, status code, error handling & integration tests (30 tests)
│       ├── resource.test.js     # Resource CRUD tests
│       ├── tenantIsolation.test.js # Multi-tenant isolation tests
│       └── migration.test.js    # Idempotent migration verification
├── frontend/
│   ├── index.html               # Main SaaS overview dashboard
│   ├── services.html            # Tracked services catalog & management
│   ├── usage.html               # Metered usage ingestion & audit logs
│   ├── billing.html             # Invoices, billing cycles & reconciled usage
│   ├── budgets.html             # Budgets, threshold alerts & run-rate forecasts
│   ├── login.html               # User sign-in interface
│   ├── register.html            # User & workspace creation interface
│   ├── css/
│   │   └── styles.css           # Responsive, accessible WCAG AA design system
│   └── js/
│       ├── api.js               # Reusable API fetch driver & session manager
│       ├── auth.js              # Auth form handlers & route guard
│       ├── dashboard.js         # Dashboard metrics, invoices & alerts controller
│       ├── services.js          # Services CRUD & filter controller
│       ├── usage.js             # Usage ingestion & history controller
│       ├── billing.js           # Invoices, period generation & line-items controller
│       └── budgets.js           # Budgets, alerts & forecast projections controller
├── docs/
│   ├── API.md                   # Complete REST API specification
│   ├── FORECASTING_EVALUATION.md # Forecasting evaluation report: Linear Run-Rate vs. ARIMA (MAPE)
│   ├── PROJECT_DEMO.md          # Step-by-step backend demonstration guide & checklist
│   ├── TEST_PLAN.md             # Master test plan & empirical verification report (140 tests)
│   ├── PROJECT_REPORT_NOTES.md  # Architecture, data models & university report notes
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

### 4. Running the Application (Backend & Frontend)
```powershell
npm run dev
```
The server will start on `http://localhost:5000` and serve both the REST API and the static web frontend from a single local origin:
- **Web App Dashboard:** [http://localhost:5000/](http://localhost:5000/) (or `/index.html`)
- **Tracked Services Screen:** [http://localhost:5000/services](http://localhost:5000/services) (or `/services.html`)
- **Usage Ingestion & History:** [http://localhost:5000/usage](http://localhost:5000/usage) (or `/usage.html`)
- **Invoices & Billing Cycles:** [http://localhost:5000/billing](http://localhost:5000/billing) (or `/billing.html`)
- **Budgets, Alerts & Forecasts:** [http://localhost:5000/budgets](http://localhost:5000/budgets) (or `/budgets.html`)
- **User Sign-In:** [http://localhost:5000/login](http://localhost:5000/login) (or `/login.html`)
- **Workspace Registration:** [http://localhost:5000/register](http://localhost:5000/register) (or `/register.html`)
- **API Health Endpoint:** [http://localhost:5000/api/health](http://localhost:5000/api/health)

### 5. Running Database Migration Standalone
```powershell
npm run migrate:workspaces
```

### 6. Running the Automated Test Suite
```powershell
npm test
```
The test suite executes 293 automated tests across 83 test suites using Node's native test runner (`node:test`) with an isolated in-memory MongoDB instance. No external database connection is required.

### 7. Running the Forecasting Evaluation Experiment
```powershell
npm run evaluate:forecast
```
Executes the reproducible time-series evaluation comparing Model A (Linear Run-Rate) against Model B (ARIMA) over a 90-day synthetic chronological dataset and reports MAPE, MAE, and RMSE metrics (see [docs/FORECASTING_EVALUATION.md](docs/FORECASTING_EVALUATION.md)).

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

## Frontend Architecture & Authentication Security

The frontend is implemented as a lightweight, framework-free single-page interface using HTML5, CSS3, and Vanilla JavaScript ES Modules:
- **Zero Build Step:** Uses browser-native `fetch()` APIs and modern CSS custom properties without requiring Node bundling tools (Vite, Webpack, etc.).
- **Single-Origin Serving:** Express safely serves the static frontend assets from `/frontend` while preserving strict `/api/...` JSON routing and 404 handlers. Backend source files and `.env` are strictly excluded from static mounts.
- **Authentication Lifecycle:** JWT tokens issued by `/api/auth/login` and `/api/auth/register` are stored in browser `localStorage`. The API client module (`js/api.js`) automatically attaches `Authorization: Bearer <token>` to protected requests.
- **Session Expiration:** Upon receiving HTTP `401 Unauthorized`, the client purges stored tokens and immediately redirects to `login.html?expired=true`.
- **Security Boundaries:** Client-side route guarding is an ergonomic presentation layer; all authorization rules, role restrictions (`owner`/`admin`/`member`), and tenant data boundaries are strictly enforced server-side.

---

## Development Roadmap

- [x] **Milestone A — Stabilize Backend Foundation**: Automated testing, environment validation, tenant boundary verification, Mongoose 9 updates, API docs.
- [x] **Milestone B — Workspace Architecture**: Personal vs. organization workspaces, Membership model, workspace switching, RBAC (`owner`, `admin`, `member`), migration backfill.
- [x] **Milestone C — Service Catalog & Usage Ingestion**: Tracked service catalog (`metered`, `subscription`, `hybrid`), usage ingestion, database-enforced idempotency, history & aggregation pipelines.
- [x] **Milestone D — Billing Engine**: High-precision Decimal.js calculation, billing period calculation, invoice records, usage reconciliation, idempotency.
- [x] **Milestone E — Budgets & Analytics**: Budget allocation, spend tracking, threshold alerts, explainable linear burn-rate forecasts.
- [x] **Milestone F — Reliability, Reconciliation & Production Readiness**: Self-healing billing reconciliation, suspended membership protection, privilege anti-escalation, production error sanitization, operational health reporting, graceful shutdown, environment validation.
- [x] **Milestone G — Final Integration, Release Validation & Project Completion**: Full 15-step business workflow integration test suite, explicit line-item usage reconciliation, demonstration checklist (`PROJECT_DEMO.md`), master test plan (`TEST_PLAN.md`), academic report notes (`PROJECT_REPORT_NOTES.md`).
- [x] **Full-Stack Phase 1 — Frontend Foundation**: Vanilla HTML5, CSS3, and JavaScript web frontend, responsive SaaS dashboard shell, forms with client-side validation, password visibility toggles, submit debounce protection, session expiration handling, Express static asset serving, 149 passing automated tests.
- [x] **Full-Stack Phase 2 — Core Management Screens**: Comprehensive vanilla management screens for Tracked Services (`services.html`), Usage Ingestion & History (`usage.html`), Invoices & Reconciled Line Items (`billing.html`), and Budgets, Alerts & Linear Run-Rate Forecasting (`budgets.html`). Zero-build, standards-compliant, CSP-protected, workspace-scoped, with 155 passing automated tests.
- [x] **Full-Stack Phase 3 — Full Frontend Integration & Cross-Module Consistency**: Unified workspace picker, persistent workspace switching, active navigation state, cross-module invoice/alert notifications, accessible aria labels and safe DOM rendering (163 passing tests).
- [x] **Milestone Nov 16 — Authentication, Session & RBAC Hardening**: Server-side role returns on `/api/auth/me` and `/api/auth/login`, strict registration email/name validation, suspended membership login blocking (403), client-side JWT expiration auto-clearing, pre-flight form validation, RBAC-aware UI disablement, and comprehensive security testing (168 passing tests across 47 suites).
- [x] **Milestone Nov 17 — Multi-Tenant / Workspace Isolation & Authorization Audit**: Exhaustive multi-tenant security verification across all workspace-scoped subsystems (services, usage, billing, budgets, alerts, memberships), adversarial cross-tenant infiltration testing, tenant-scoped compound idempotency index validation, workspace switching security lifecycle (A1 -> A2 -> A1), request body/query tenantId injection immunity, error sanitization, and live browser verification (190 passing tests across 53 suites).
- [x] **Milestone Nov 18 — Security, CSP & Input Validation Audit**: Complete application-security audit across the stack. Hardened Helmet Content Security Policy (strict script/object/frame restrictions, anti-clickjacking DENY), request body size limit (500kb) and malformed JSON syntax error sanitization, parameter pollution prevention and query operator injection immunity across all list/filter endpoints, prototype pollution defense with recursive metadata validation and depth limits, path traversal immunity for static files, XSS adversarial string neutralization with 100% safe native DOM sinks, production error sanitization, and real browser verification (211 passing tests across 61 suites).
- [x] **Milestone Nov 19 — Responsive UI, Accessibility (A11y) & UX Polish**: Cross-device responsive design across Desktop (1440px/1280px), Tablet (1024px/768px), and Mobile (430px/390px/360px) viewports; full WCAG AA accessibility compliance with keyboard skip-links, high-contrast :focus-visible outlines, accessible explicit form labels, and horizontal scroll region accessibility (tabindex="0" role="region"); accessible modal lifecycle with complete Tab focus trapping, background scroll prevention (body.modal-open), Escape-to-dismiss, and trigger button focus restoration; mobile slide-out navigation drawer with smooth animations and Escape handling; minimum 44x44px touch targets on coarse pointers; user preference prefers-reduced-motion support; comprehensive automated testing (247 passing tests across 68 suites) and live browser verification.
- [x] **Milestone Nov 20 — API Contract, Error Handling & Frontend/Backend Integration Audit**: Exhaustive contract audit between vanilla frontend and Express backend. Verified all 23 API endpoints, status codes (200, 201, 400, 401, 403, 404, 409, 413, 500, network error), error response extraction (`data.message`, `data.error`, `data.errors`), `MeterFlowAPI.delete` payload support, safe integer cents aggregation avoiding IEEE-754 floating-point drift in client KPI summaries, budget modal target cleanup on workspace switch, dedicated contract test suite (`backend/tests/apiContracts.test.js`), full live browser verification with screenshots across all 9 checkpoints, and 277 automated tests passing across 77 suites (0 failures).
- [x] **Forecasting Evaluation Milestone (Linear Run-Rate vs. ARIMA)**: Evaluated MeterFlow's production linear run-rate forecasting model against an ARIMA(1,1,1) time-series model on a 90-day deterministic chronological dataset (60 days training, 30 days held-out evaluation window) with upward growth trend and weekly seasonality. Demonstrated that ARIMA achieved lower MAPE (17.27% vs. 24.63%) by modeling trend differencing and serial autocorrelation, while linear run-rate offers O(1) computational speed, zero external dependencies, immediate usability from Day 2 of budget cycles, and full financial explainability. Validated reproducibility via `npm run evaluate:forecast`, added 16 automated tests (expanding project suite to 293 passing tests across 83 suites, 0 failures), verified existing forecast UI in browser, and compiled complete evaluation report in `docs/FORECASTING_EVALUATION.md`.
