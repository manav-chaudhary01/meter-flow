# MeterFlow — Backend Demonstration Guide & Checklist

This document provides a step-by-step verification checklist and demonstration guide for the **MeterFlow** REST API. It is designed for evaluators, examiners, and developers to reproduce and demonstrate every core capability of the platform using standard HTTP requests (via `curl`, Postman, or PowerShell).

---

## Prerequisites & Setup

1. Start the backend server:
   ```bash
   cd meter-flow/backend
   npm install
   npm run dev
   ```
2. The server initializes on `http://localhost:5000` (or `PORT` specified in `.env`).
3. Set base URL: `BASE_URL="http://localhost:5000"`

---

## Demonstration Checklist

### Demo Step 1: Operational Health & Database Connectivity Check
- **Purpose:** Verify service health, uptime, and database connection state.
- **Request:**
  ```bash
  curl -X GET http://localhost:5000/api/health
  ```
- **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "status": "healthy",
    "message": "MeterFlow API is running",
    "database": "connected",
    "uptime": 45,
    "timestamp": "2026-10-31T12:00:00.000Z"
  }
  ```

---

### Demo Step 2: User Registration & Authentication
- **Purpose:** Register a new user and establish their initial organization workspace.
- **Request:**
  ```bash
  curl -X POST http://localhost:5000/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Alice Demo",
      "email": "alice.demo@acme.com",
      "password": "Password123!",
      "organizationName": "Acme Cloud Demo"
    }'
  ```
- **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "data": {
      "user": {
        "id": "674b0100a1b2c3d4e5f67890",
        "name": "Alice Demo",
        "email": "alice.demo@acme.com",
        "tenantId": "674b0100a1b2c3d4e5f67891"
      },
      "tenant": {
        "id": "674b0100a1b2c3d4e5f67891",
        "name": "Acme Cloud Demo",
        "type": "organization"
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- *Save the token for subsequent requests:* `TOKEN="<jwt-token>"`

---

### Demo Step 3: Workspace Architecture & Context Switching
- **Purpose:** Create an organization workspace and switch context to generate a freshly scoped JWT.
- **Request 3A (Create Workspace):**
  ```bash
  curl -X POST http://localhost:5000/api/workspaces \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Production Enterprise",
      "type": "organization"
    }'
  ```
- **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Workspace created successfully",
    "data": {
      "workspace": {
        "id": "674b0200a1b2c3d4e5f67892",
        "name": "Production Enterprise",
        "type": "organization",
        "role": "owner"
      }
    }
  }
  ```
- **Request 3B (Switch Active Workspace):**
  ```bash
  curl -X POST http://localhost:5000/api/workspaces/switch \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"workspaceId": "674b0200a1b2c3d4e5f67892"}'
  ```
- **Expected Response (200 OK):** Returns a fresh token scoped to `Production Enterprise`.

---

### Demo Step 4: Role-Based Access Control (RBAC) Enforcement
- **Purpose:** Demonstrate role restrictions between `owner`, `admin`, and `member`.
- **Action:**
  1. Owner invites a colleague: `POST /api/workspaces/:id/members` with `role: "member"`.
  2. Member logs in and attempts to call `POST /api/services` or `POST /api/billing/generate`.
- **Expected Response (403 Forbidden):**
  ```json
  {
    "success": false,
    "message": "Forbidden: this action requires one of the following roles: owner, admin"
  }
  ```

---

### Demo Step 5: Tracked Service Catalog Creation
- **Purpose:** Create services supporting different tracking models (hybrid, metered, subscription).
- **Request (Create Hybrid GPU Service):**
  ```bash
  curl -X POST http://localhost:5000/api/services \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Cloud GPU Cluster",
      "provider": "Acme Infra",
      "category": "compute",
      "trackingType": "hybrid",
      "currency": "USD",
      "unit": "gpu-hour",
      "unitPrice": 0.50,
      "subscriptionAmount": 100.00,
      "billingInterval": "monthly"
    }'
  ```
- **Expected Response (201 Created):** Service created with Decimal128 amounts and active status.

---

### Demo Step 6: Metered Usage Ingestion & Idempotency Protection
- **Purpose:** Ingest usage events and demonstrate database-enforced deduplication.
- **Request 6A (Initial Ingestion):**
  ```bash
  curl -X POST http://localhost:5000/api/usage \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "serviceId": "<gpu-service-id>",
      "quantity": 200,
      "unit": "gpu-hour",
      "occurredAt": "2026-05-10T14:30:00.000Z",
      "idempotencyKey": "demo-gpu-batch-001"
    }'
  ```
- **Expected Response (201 Created):** `idempotentReplay: false`
- **Request 6B (Identical Replay with same key):**
  Re-send the identical request.
- **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Usage recorded successfully (idempotent replay)",
    "data": {
      "record": { ... },
      "idempotentReplay": true
    }
  }
  ```
- **Request 6C (Conflicting Payload with same key):**
  Re-send with `quantity: 999`.
- **Expected Response (409 Conflict):**
  ```json
  {
    "success": false,
    "message": "Idempotency conflict: An event with this key already exists with a different payload"
  }
  ```

---

### Demo Step 7: Usage History & Aggregations
- **Purpose:** Query usage records and run aggregation pipelines.
- **Request:**
  ```bash
  curl -X GET "http://localhost:5000/api/usage/summary?startDate=2026-05-01T00:00:00.000Z&endDate=2026-06-01T00:00:00.000Z" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **Expected Response (200 OK):**
  Returns total quantity, event count, min, and max consumption grouped by service.

---

### Demo Step 8: High-Precision Billing Engine & Usage Reconciliation
- **Purpose:** Execute billing calculations and verify usage record reconciliation.
- **Request:**
  ```bash
  curl -X POST http://localhost:5000/api/billing/generate \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "billingPeriodStart": "2026-05-01T00:00:00.000Z",
      "billingPeriodEnd": "2026-06-01T00:00:00.000Z",
      "currency": "USD"
    }'
  ```
- **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Billing record generated successfully",
    "data": {
      "billingRecord": {
        "invoiceNumber": "INV-20260501-XXXXXX",
        "currency": "USD",
        "lineItems": [
          {
            "chargeType": "subscription",
            "amount": "100.00",
            "description": "Monthly subscription fee for Cloud GPU Cluster"
          },
          {
            "chargeType": "usage",
            "quantity": "200",
            "unitPrice": "0.5",
            "amount": "100.00",
            "usageRecordCount": 1
          }
        ],
        "subtotal": "200.00",
        "total": "200.00",
        "status": "issued"
      },
      "isExisting": false
    }
  }
  ```
- **Inspect Reconciled Usage:**
  ```bash
  curl -X GET http://localhost:5000/api/billing/<billing-record-id>/usage \
    -H "Authorization: Bearer $TOKEN"
  ```
  Returns `count: 1` with `billedAt` populated and `billingRecordId` matching the invoice.

---

### Demo Step 9: Idempotent Billing Replay
- **Purpose:** Prevent duplicate billing runs.
- **Request:** Repeat `POST /api/billing/generate` for the same period.
- **Expected Response (200 OK):**
  Returns `isExisting: true`, total `"200.00"`, and no duplicate record in MongoDB.

---

### Demo Step 10: Workspace Budgets & Actual Spend Tracking
- **Purpose:** Allocate budgets and monitor consumption against finalized billing.
- **Request (Create Budget):**
  ```bash
  curl -X POST http://localhost:5000/api/budgets \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Q2 Infrastructure Budget",
      "amount": 250.00,
      "currency": "USD",
      "startDate": "2026-05-01T00:00:00.000Z",
      "endDate": "2026-06-01T00:00:00.000Z",
      "thresholds": [50, 80, 100]
    }'
  ```
- **Expected Response (201 Created):**
  Actual spend is calculated from the finalized bill ($200.00). Percentage used = 80%.

---

### Demo Step 11: Spend Threshold Alerts & Acknowledgment
- **Purpose:** Evaluate alerts and update alert states.
- **Request 11A (List Alerts):**
  ```bash
  curl -X GET "http://localhost:5000/api/budgets/alerts?budgetId=<budget-id>" \
    -H "Authorization: Bearer $TOKEN"
  ```
- **Expected Response (200 OK):**
  Returns 2 alerts triggered (50% and 80%) with status `"active"`.
- **Request 11B (Acknowledge Alert):**
  ```bash
  curl -X PATCH http://localhost:5000/api/budgets/alerts/<alert-id>/ack \
    -H "Authorization: Bearer $TOKEN"
  ```
- **Expected Response (200 OK):**
  Alert status transitions to `"acknowledged"`.

---

### Demo Step 12: Explainable Linear Run-Rate Spend Forecasting
- **Purpose:** Inspect deterministic spending projections.
- **Request:**
  ```bash
  curl -X GET http://localhost:5000/api/budgets/<budget-id> \
    -H "Authorization: Bearer $TOKEN"
  ```
- **Expected Response (200 OK):**
  Returns budget details and forecast payload containing:
  - `method: "linear_run_rate"`
  - `dailyAverageSpend`
  - `forecastSpend`
  - `projectedVariance`
  - `isProjectedToExceed`
  - `dataWindow` (daysTotal, daysElapsed, daysRemaining)
  - Explicit `assumptions` and `limitations`

---

### Demo Step 13: Strict Cross-Tenant Isolation
- **Purpose:** Demonstrate that another workspace has zero visibility into Acme's resources.
- **Request:**
  Authenticate as User C (Competitor Corp) and attempt to fetch Acme's budget:
  ```bash
  curl -X GET http://localhost:5000/api/budgets/<acme-budget-id> \
    -H "Authorization: Bearer $COMPETITOR_TOKEN"
  ```
- **Expected Response (404 Not Found):**
  ```json
  {
    "success": false,
    "message": "Budget not found"
  }
  ```
- The same 404/403 boundary is enforced on `/api/services/:id`, `/api/usage/:id`, `/api/billing/:id`, and `/api/workspaces/:id/members`.
