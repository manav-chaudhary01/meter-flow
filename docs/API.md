# MeterFlow API Documentation

## Base URL
Default local development base URL: `http://localhost:5000`

---

## Authentication & Headers
Protected endpoints require a JSON Web Token (JWT) sent in the HTTP `Authorization` header:

```http
Authorization: Bearer <your-jwt-token>
```

---

## 1. System & Health

### Health Check
Verify the service is reachable and retrieve operational readiness telemetry.

- **Method:** `GET`
- **Endpoint:** `/api/health`
- **Auth Required:** No
- **Success Response (200 OK):**
```json
{
  "success": true,
  "status": "healthy",
  "message": "MeterFlow API is running",
  "database": "connected",
  "uptime": 124,
  "timestamp": "2026-10-31T12:00:00.000Z"
}
```

> **Operational Health & Error Handling Policy:**
> - If the database connection is interrupted, `/api/health` reports `"status": "degraded"` and `"database": "disconnected"`.
> - When `NODE_ENV=production`, all unhandled 500 exceptions are automatically sanitized to `{"success": false, "message": "Internal server error"}` to prevent leakage of credentials, database URIs, or internal stack traces.

---

## 2. Authentication

### User Registration
Register a new user and create their initial workspace.

- **Method:** `POST`
- **Endpoint:** `/api/auth/register`
- **Auth Required:** No
- **Request Body:**
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "securepassword123",
  "organizationName": "Acme Cloud Services",
  "workspaceType": "organization"
}
```
- **Validation Rules:**
  - `name`, `email`, `password`, `organizationName` (or `workspaceName`) are required.
  - `password` must be at least 6 characters.
  - `workspaceType`: `"personal"` or `"organization"` (defaults to `"organization"` if `organizationName` provided, otherwise `"personal"`).
  - `email` must be unique across the platform.
- **Success Response (201 Created):**
```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "673f8b19...",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "tenantId": "673f8b19..."
    },
    "tenant": {
      "id": "673f8b19...",
      "name": "Acme Cloud Services",
      "type": "organization"
    }
  }
}
```
- **Error Responses:**
  - `400 Bad Request`: Missing fields or short password.
  - `409 Conflict`: User with email already exists.

---

### User Login
Authenticate an existing user.

- **Method:** `POST`
- **Endpoint:** `/api/auth/login`
- **Auth Required:** No
- **Request Body:**
```json
{
  "email": "jane@example.com",
  "password": "securepassword123"
}
```
- **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "673f8b19...",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "tenantId": "673f8b19..."
    },
    "tenant": {
      "id": "673f8b19...",
      "name": "Acme Cloud Services",
      "type": "organization"
    }
  }
}
```

---

### Get Current User Identity
Retrieve authenticated caller identity.

- **Method:** `GET`
- **Endpoint:** `/api/auth/me`
- **Auth Required:** Yes (`Bearer <token>`)
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "userId": "673f8b19...",
    "tenantId": "673f8b19..."
  }
}
```

---

## 3. Workspaces & Membership Management

Workspaces support two validated types:
- `personal`: Individual private tracking. A user may have at most **one** personal workspace. Additional members cannot be added.
- `organization`: Shared team/organization tracking. Supports role-based access (`owner`, `admin`, `member`).

### List Workspaces
List all workspaces accessible to the authenticated user.

- **Method:** `GET`
- **Endpoint:** `/api/workspaces`
- **Auth Required:** Yes
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "workspaces": [
      {
        "id": "673f8b19...",
        "name": "Acme Cloud Services",
        "type": "organization",
        "role": "owner",
        "isCurrent": true,
        "createdAt": "2026-10-24T14:00:00.000Z"
      },
      {
        "id": "673f8c20...",
        "name": "Jane Personal Workspace",
        "type": "personal",
        "role": "owner",
        "isCurrent": false,
        "createdAt": "2026-10-24T14:10:00.000Z"
      }
    ]
  }
}
```

---

### Create Workspace
Create a personal or organization workspace.

- **Method:** `POST`
- **Endpoint:** `/api/workspaces`
- **Auth Required:** Yes
- **Request Body:**
```json
{
  "name": "DevOps Core Team",
  "type": "organization"
}
```

---

### Switch Active Workspace
Switch context to an authorized workspace. Returns a newly signed JWT scoped to the target workspace.

- **Method:** `POST`
- **Endpoint:** `/api/workspaces/switch`
- **Auth Required:** Yes
- **Request Body:**
```json
{
  "workspaceId": "673f91..."
}
```

---

### List Workspace Members
List active members of a workspace. Caller must be an active member.

- **Method:** `GET`
- **Endpoint:** `/api/workspaces/:id/members`
- **Auth Required:** Yes

---

### Add Workspace Member
Add a user to an organization workspace. Caller must be `owner` or `admin`.

- **Method:** `POST`
- **Endpoint:** `/api/workspaces/:id/members`
- **Auth Required:** Yes (Owner/Admin)

---

### Remove Workspace Member
Remove a member from a workspace. Caller must be `owner` or `admin`.

- **Method:** `DELETE`
- **Endpoint:** `/api/workspaces/:id/members/:memberUserId`
- **Auth Required:** Yes (Owner/Admin)

---

## 4. Resources (Legacy Metered Resource Catalog)

Legacy resource endpoints for backward compatibility. Scoped to active workspace.

- `POST /api/resources` — Create resource
- `GET /api/resources` — List resources
- `GET /api/resources/:id` — Retrieve resource
- `PUT /api/resources/:id` — Update resource
- `DELETE /api/resources/:id` — Delete resource

---

## 5. Tracked Service Catalog

The Tracked Service Catalog represents paid digital services, SaaS tools, and cloud infrastructure being tracked by a workspace.

### Tracking Types
1. **`metered`**: Variable usage-based pricing.
   - `unit` is required (e.g. `"1k-tokens"`, `"GB"`, `"requests"`).
   - `unitPrice` is required (non-negative decimal string or number).
2. **`subscription`**: Fixed recurring cost.
   - `subscriptionAmount` is required (non-negative decimal string or number).
   - `billingInterval` is required (`"daily"`, `"monthly"`, `"quarterly"`, `"yearly"`).
3. **`hybrid`**: Fixed base subscription plus variable usage charges.
   - Requires `unit`, `unitPrice`, `subscriptionAmount`, and `billingInterval`.

### Create Tracked Service
Create a new service in the active workspace. Requires role `owner` or `admin`.

- **Method:** `POST`
- **Endpoint:** `/api/services`
- **Auth Required:** Yes (`owner` or `admin`)
- **Request Body (Metered Example):**
```json
{
  "name": "OpenAI GPT-4",
  "provider": "OpenAI",
  "category": "ai",
  "trackingType": "metered",
  "currency": "USD",
  "unit": "1k-tokens",
  "unitPrice": "0.0300"
}
```
- **Request Body (Subscription Example):**
```json
{
  "name": "GitHub Enterprise",
  "provider": "GitHub",
  "category": "dev-tools",
  "trackingType": "subscription",
  "currency": "USD",
  "subscriptionAmount": "21.00",
  "billingInterval": "monthly"
}
```
- **Success Response (201 Created):**
```json
{
  "success": true,
  "message": "Tracked service created successfully",
  "data": {
    "service": {
      "id": "674a10...",
      "tenantId": "673f8b...",
      "name": "OpenAI GPT-4",
      "provider": "OpenAI",
      "category": "ai",
      "trackingType": "metered",
      "currency": "USD",
      "unit": "1k-tokens",
      "unitPrice": "0.03",
      "subscriptionAmount": null,
      "billingInterval": null,
      "status": "active",
      "createdAt": "2026-10-30T20:00:00.000Z",
      "updatedAt": "2026-10-30T20:00:00.000Z"
    }
  }
}
```

---

### List Tracked Services
List services in the active workspace. Accessible to all active members.

- **Method:** `GET`
- **Endpoint:** `/api/services`
- **Auth Required:** Yes
- **Query Parameters:**
  - `status`: `"active"` (default), `"archived"`, or `"all"`.
  - `trackingType`: `"metered"`, `"subscription"`, or `"hybrid"`.
  - `category`: string filter.

---

### Get Tracked Service by ID
- **Method:** `GET`
- **Endpoint:** `/api/services/:id`
- **Auth Required:** Yes

---

### Update Tracked Service
Update service properties. Requires role `owner` or `admin`.

- **Method:** `PUT`
- **Endpoint:** `/api/services/:id`
- **Auth Required:** Yes (`owner` or `admin`)

---

### Archive Tracked Service
Soft-archive a service to prevent future usage ingestion while preserving historical usage and billing records. Requires role `owner` or `admin`.

- **Method:** `DELETE`
- **Endpoint:** `/api/services/:id`
- **Auth Required:** Yes (`owner` or `admin`)
- **Success Response (200 OK):** Sets `status: "archived"`.

---

## 6. Usage Ingestion, History & Aggregation

### Ingest Usage Record
Ingest a metered usage event into the active workspace. Supports database-enforced idempotency to prevent duplicate event recording.

- **Method:** `POST`
- **Endpoint:** `/api/usage`
- **Auth Required:** Yes (Active workspace member)
- **Request Body:**
```json
{
  "serviceId": "674a10...",
  "quantity": "5000",
  "unit": "1k-tokens",
  "occurredAt": "2026-10-30T10:15:00.000Z",
  "source": "api-gateway",
  "idempotencyKey": "req_uuid_1234567890",
  "externalEventId": "evt_stripe_987654",
  "metadata": {
    "model": "gpt-4-turbo",
    "endpoint": "/v1/chat/completions"
  }
}
```
- **Validation & Business Rules:**
  - `serviceId`: Must belong to active workspace.
  - `status`: Archived services cannot receive usage (returns 400).
  - `trackingType`: Usage can only be ingested for `metered` or `hybrid` services (returns 400 for `subscription`).
  - `quantity`: Must be a valid, finite, non-negative decimal string or number (`quantity >= 0`). Zero (`0`) is accepted.
  - `unit`: Must match the service's configured unit.
  - `occurredAt`: Optional ISO 8601 string; defaults to current server time.
  - `idempotencyKey`: Optional token for client-level deduplication.
  - `externalEventId`: Optional upstream event identifier.
- **Idempotency Behavior:**
  - **First submission:** Creates document, returns **201 Created** with `{ idempotentReplay: false }`.
  - **Identical replay (matching key & payload):** Returns **200 OK** with existing record and `{ idempotentReplay: true }`. No duplicate database record is created.
  - **Payload mismatch (reusing key with different quantity/unit/service):** Returns **409 Conflict** with message `"Idempotency conflict: An event with this key already exists with a different payload"`.
  - **Concurrency:** Handled safely via database unique partial indexes; concurrent race conditions do not create duplicates or fail with internal server errors.

---

### Query Usage History
Query paginated usage records in the active workspace with deterministic sorting (`occurredAt: -1, _id: -1`).

- **Method:** `GET`
- **Endpoint:** `/api/usage`
- **Auth Required:** Yes
- **Query Parameters:**
  - `serviceId`: Optional ObjectId filter.
  - `startDate`: Optional ISO 8601 timestamp (inclusive: `occurredAt >= startDate`).
  - `endDate`: Optional ISO 8601 timestamp (exclusive: `occurredAt < endDate`).
  - `page`: Integer >= 1 (default `1`).
  - `limit`: Integer 1 to 100 (default `20`).
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "records": [
      {
        "id": "674a25...",
        "tenantId": "673f8b...",
        "serviceId": "674a10...",
        "serviceName": "OpenAI GPT-4",
        "quantity": "5000",
        "unit": "1k-tokens",
        "occurredAt": "2026-10-30T10:15:00.000Z",
        "source": "api-gateway",
        "idempotencyKey": "req_uuid_1234567890",
        "externalEventId": "evt_stripe_987654",
        "metadata": {
          "model": "gpt-4-turbo"
        },
        "createdAt": "2026-10-30T10:15:01.000Z"
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 20,
      "pages": 1
    }
  }
}
```

---

### Get Usage Summary & Aggregation
Aggregate usage quantities, event counts, min, and max using optimized MongoDB aggregation pipelines.

- **Method:** `GET`
- **Endpoint:** `/api/usage/summary`
- **Auth Required:** Yes
- **Query Parameters:**
  - `serviceId`: Optional filter.
  - `startDate`: Optional ISO string (inclusive).
  - `endDate`: Optional ISO string (exclusive).
  - `groupBy`: `"service"` (default), `"day"`, or `"month"`.
- **Success Response (200 OK - Group By Service):**
```json
{
  "success": true,
  "data": {
    "summary": [
      {
        "serviceId": "674a10...",
        "serviceName": "OpenAI GPT-4",
        "unit": "1k-tokens",
        "trackingType": "metered",
        "currency": "USD",
        "totalQuantity": "75000",
        "eventCount": 15,
        "minQuantity": "1000",
        "maxQuantity": "12000",
        "firstEventAt": "2026-10-01T08:00:00.000Z",
        "lastEventAt": "2026-10-30T18:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```
- **Success Response (200 OK - Group By Day/Month):**
```json
{
  "success": true,
  "data": {
    "summary": [
      {
        "serviceId": "674a10...",
        "serviceName": "OpenAI GPT-4",
        "period": "2026-10-30",
        "unit": "1k-tokens",
        "trackingType": "metered",
        "totalQuantity": "5000",
        "eventCount": 1,
        "firstEventAt": "2026-10-30T10:15:00.000Z",
        "lastEventAt": "2026-10-30T10:15:00.000Z"
      }
    ],
    "count": 1
  }
}
```

---

### Get Usage Record by ID
- **Method:** `GET`
- **Endpoint:** `/api/usage/:id`
- **Auth Required:** Yes
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "record": {
      "id": "674a25...",
      "tenantId": "673f8b...",
      "serviceId": "674a10...",
      "quantity": "5000",
      "unit": "1k-tokens",
      "occurredAt": "2026-10-30T10:15:00.000Z"
    }
  }
}
```

---

## 6. Billing Engine

The Billing Engine calculates subscription fees and metered usage charges, generates billing records for defined periods, and reconciles usage events to prevent duplicate billing. All financial calculations use `Decimal.js` with `ROUND_HALF_UP` rounding to 2 decimal places and are persisted as MongoDB `Decimal128`.

Billing periods use inclusive-start / exclusive-end boundaries in UTC (`billingPeriodStart <= occurredAt < billingPeriodEnd`).

### Generate Billing Record
Generate a bill for the active workspace covering a specified date range and currency. Only unbilled usage events (`billingRecordId: null`) within the period are reconciled.

- **Method:** `POST`
- **Endpoint:** `/api/billing/generate`
- **Auth Required:** Yes (`owner` or `admin` role required)
- **Request Body:**
```json
{
  "billingPeriodStart": "2026-03-01T00:00:00.000Z",
  "billingPeriodEnd": "2026-04-01T00:00:00.000Z",
  "currency": "USD"
}
```
- **Validation Rules:**
  - `billingPeriodStart` and `billingPeriodEnd` are required valid ISO-8601 UTC date strings.
  - `billingPeriodStart` must be strictly before `billingPeriodEnd`.
  - `currency`: 3-letter ISO code (e.g. `"USD"`, `"EUR"`), defaults to `"USD"`.
  - Calling user must have `owner` or `admin` role in the active workspace.
- **Idempotency, Concurrency & Self-Healing Reconciliation:**
  - A unique compound index `{ tenantId: 1, billingPeriodStart: 1, billingPeriodEnd: 1, currency: 1 }` prevents duplicate records.
  - Repeated generation for the same period returns HTTP `200 OK` with `isExisting: true`.
  - Self-healing reconciliation: If a billing run is interrupted before usage record reconciliation finishes, subsequent generation or retrieval (`GET /api/billing/:id/usage`) automatically links eligible unbilled usage records to the existing bill without double-counting.
- **Success Response (201 Created - New Bill):**
```json
{
  "success": true,
  "message": "Billing record generated successfully",
  "data": {
    "billingRecord": {
      "id": "674b0100a1b2c3d4e5f67890",
      "tenantId": "673f8b22a1b2c3d4e5f67890",
      "invoiceNumber": "INV-20260301-A1B2C3",
      "billingPeriodStart": "2026-03-01T00:00:00.000Z",
      "billingPeriodEnd": "2026-04-01T00:00:00.000Z",
      "currency": "USD",
      "lineItems": [
        {
          "id": "674b0100a1b2c3d4e5f67891",
          "serviceId": "674a1000a1b2c3d4e5f67890",
          "serviceName": "GitHub Enterprise",
          "chargeType": "subscription",
          "quantity": null,
          "unit": null,
          "unitPrice": null,
          "amount": "50.00",
          "usageRecordCount": 0,
          "description": "Monthly subscription fee for GitHub Enterprise"
        },
        {
          "id": "674b0100a1b2c3d4e5f67892",
          "serviceId": "674a1100a1b2c3d4e5f67890",
          "serviceName": "OpenAI GPT-4",
          "chargeType": "usage",
          "quantity": "350000",
          "unit": "tokens",
          "unitPrice": "0.00002",
          "amount": "7.00",
          "usageRecordCount": 2,
          "description": "Usage charge for 350000 tokens at USD 0.00002/tokens"
        }
      ],
      "subtotal": "57.00",
      "total": "57.00",
      "status": "issued",
      "generatedAt": "2026-04-01T00:00:01.000Z"
    },
    "isExisting": false
  }
}
```
- **Success Response (200 OK - Idempotent Replay):**
```json
{
  "success": true,
  "message": "Billing record already exists for this period",
  "data": {
    "billingRecord": {
      "id": "674b0100a1b2c3d4e5f67890",
      "invoiceNumber": "INV-20260301-A1B2C3",
      "subtotal": "57.00",
      "total": "57.00",
      "status": "issued"
    },
    "isExisting": true
  }
}
```

---

### List Billing Records
List paginated billing records for the active workspace.

- **Method:** `GET`
- **Endpoint:** `/api/billing`
- **Auth Required:** Yes (any active workspace member)
- **Query Parameters:**
  - `page` (optional): Page number (default: `1`).
  - `limit` (optional): Items per page (default: `20`, max: `100`).
  - `status` (optional): Filter by status (`issued`, `finalized`, `draft`, `void`).
  - `startDate` (optional): Filter records where `billingPeriodStart >= startDate`.
  - `endDate` (optional): Filter records where `billingPeriodEnd <= endDate`.
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "billingRecords": [
      {
        "id": "674b0100a1b2c3d4e5f67890",
        "invoiceNumber": "INV-20260301-A1B2C3",
        "billingPeriodStart": "2026-03-01T00:00:00.000Z",
        "billingPeriodEnd": "2026-04-01T00:00:00.000Z",
        "currency": "USD",
        "subtotal": "57.00",
        "total": "57.00",
        "status": "issued",
        "generatedAt": "2026-04-01T00:00:01.000Z"
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 20,
      "pages": 1
    }
  }
}
```

---

### Get Billing Record by ID
Retrieve details and line items for a specific billing record. Enforces tenant data isolation.

- **Method:** `GET`
- **Endpoint:** `/api/billing/:id`
- **Auth Required:** Yes (any active workspace member)
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "billingRecord": {
      "id": "674b0100a1b2c3d4e5f67890",
      "tenantId": "673f8b22a1b2c3d4e5f67890",
      "invoiceNumber": "INV-20260301-A1B2C3",
      "billingPeriodStart": "2026-03-01T00:00:00.000Z",
      "billingPeriodEnd": "2026-04-01T00:00:00.000Z",
      "currency": "USD",
      "lineItems": [ ... ],
      "subtotal": "57.00",
      "total": "57.00",
      "status": "issued",
      "generatedAt": "2026-04-01T00:00:01.000Z"
    }
  }
}
```

---

### Get Usage Reconciled to a Bill
Retrieve the specific usage records that were reconciled and billed in this billing record.

- **Method:** `GET`
- **Endpoint:** `/api/billing/:id/usage`
- **Auth Required:** Yes (any active workspace member)
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "billingRecordId": "674b0100a1b2c3d4e5f67890",
    "invoiceNumber": "INV-20260301-A1B2C3",
    "count": 2,
    "usageRecords": [
      {
        "id": "674a2500a1b2c3d4e5f67890",
        "serviceId": "674a1100a1b2c3d4e5f67890",
        "serviceName": "OpenAI GPT-4",
        "quantity": "100000",
        "unit": "tokens",
        "occurredAt": "2026-03-05T12:00:00.000Z",
        "billedAt": "2026-04-01T00:00:01.000Z"
      },
      {
        "id": "674a2500a1b2c3d4e5f67891",
        "serviceId": "674a1100a1b2c3d4e5f67890",
        "serviceName": "OpenAI GPT-4",
        "quantity": "250000",
        "unit": "tokens",
        "occurredAt": "2026-03-15T18:30:00.000Z",
        "billedAt": "2026-04-01T00:00:01.000Z"
      }
    ]
  }
}
```

---

## 7. Budgets, Alerts & Spending Forecasting

MeterFlow provides workspace-scoped budgets, deterministic spend tracking from eligible billing records, multi-threshold alerts with database-enforced uniqueness, and an explainable linear run-rate spending forecast.

All financial calculations use `Decimal.js` and are stored as `Decimal128`. Spending sums only finalized/issued billing totals in the budget's currency, strictly distinguishing monetary expenditure from raw usage quantities.

### Create Budget
Create a new budget for the active workspace.

- **Method:** `POST`
- **Endpoint:** `/api/budgets`
- **Auth Required:** Yes (`owner` or `admin` role required)
- **Request Body:**
```json
{
  "name": "Q1 Infrastructure Budget",
  "amount": "1500.00",
  "currency": "USD",
  "periodType": "monthly",
  "startDate": "2026-03-01T00:00:00.000Z",
  "endDate": "2026-04-01T00:00:00.000Z",
  "thresholds": [50, 75, 90, 100]
}
```
- **Validation Rules:**
  - `name`: required string (2 to 100 characters).
  - `amount`: required positive number or decimal string (`> 0`).
  - `currency`: 3-letter ISO code (e.g. `"USD"`, `"EUR"`), defaults to `"USD"`.
  - `startDate` and `endDate`: required valid ISO-8601 UTC date strings (`startDate < endDate`).
  - `thresholds`: array of numbers between 1 and 200, defaults to `[50, 80, 90, 100]`.
- **Success Response (201 Created):**
```json
{
  "success": true,
  "message": "Budget created successfully",
  "data": {
    "budget": {
      "id": "674c0100a1b2c3d4e5f67890",
      "tenantId": "673f8b22a1b2c3d4e5f67890",
      "name": "Q1 Infrastructure Budget",
      "amount": "1500.00",
      "currency": "USD",
      "periodType": "monthly",
      "startDate": "2026-03-01T00:00:00.000Z",
      "endDate": "2026-04-01T00:00:00.000Z",
      "thresholds": [50, 75, 90, 100],
      "status": "active",
      "actualSpend": "0.00",
      "percentageUsed": 0,
      "forecast": {
        "hasSufficientData": false,
        "reason": "Insufficient historical data: at least 1 full day (24 hours) must elapse in the budget period to extrapolate spending."
      }
    }
  }
}
```

---

### List Budgets
List paginated budgets for the active workspace, including real-time actual spend and forecasts.

- **Method:** `GET`
- **Endpoint:** `/api/budgets`
- **Auth Required:** Yes (any active workspace member)
- **Query Parameters:**
  - `page` (optional): Page number (default: `1`).
  - `limit` (optional): Items per page (default: `20`, max: `100`).
  - `status` (optional): Filter by status (`active`, `inactive`, `archived`).
  - `currency` (optional): Filter by currency code.
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "budgets": [
      {
        "id": "674c0100a1b2c3d4e5f67890",
        "name": "Q1 Infrastructure Budget",
        "amount": "1500.00",
        "currency": "USD",
        "startDate": "2026-03-01T00:00:00.000Z",
        "endDate": "2026-04-01T00:00:00.000Z",
        "actualSpend": "450.00",
        "percentageUsed": 30,
        "forecast": {
          "hasSufficientData": true,
          "forecastSpend": "1395.00",
          "dailyAverageSpend": "45.0000",
          "projectedVariance": "-105.00",
          "isProjectedToExceed": false,
          "method": "linear_run_rate"
        }
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 20,
      "pages": 1
    }
  }
}
```

---

### Get Budget by ID
Retrieve budget details, calculated actual spend, forecast breakdown, and associated threshold alerts.

- **Method:** `GET`
- **Endpoint:** `/api/budgets/:id`
- **Auth Required:** Yes (any active workspace member)
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "budget": {
      "id": "674c0100a1b2c3d4e5f67890",
      "name": "Q1 Infrastructure Budget",
      "amount": "1500.00",
      "currency": "USD",
      "actualSpend": "1250.00",
      "percentageUsed": 83.33,
      "forecast": {
        "hasSufficientData": true,
        "forecastSpend": "1650.00",
        "projectedVariance": "150.00",
        "isProjectedToExceed": true,
        "dailyAverageSpend": "62.5000",
        "method": "linear_run_rate",
        "assumptions": "Assumes current daily expenditure rate will continue at a constant linear rate through the end of the budget period.",
        "limitations": "Does not account for non-linear usage spikes, weekend/weekday cycles, one-off subscription renewals, or seasonality."
      }
    },
    "alerts": [
      {
        "id": "674c0200a1b2c3d4e5f67890",
        "threshold": 80,
        "actualSpend": "1250.00",
        "percentageUsed": 83.33,
        "alertType": "threshold_reached",
        "status": "active",
        "triggeredAt": "2026-03-20T14:30:00.000Z"
      }
    ]
  }
}
```

---

### Update Budget
Update budget configuration, thresholds, or status.

- **Method:** `PUT`
- **Endpoint:** `/api/budgets/:id`
- **Auth Required:** Yes (`owner` or `admin` role required)
- **Request Body:**
```json
{
  "name": "Updated Infrastructure Budget",
  "amount": "2000.00",
  "thresholds": [60, 80, 95, 100]
}
```
- **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Budget updated successfully",
  "data": {
    "budget": { ... }
  }
}
```

---

### Soft-Deactivate (Archive) Budget
Soft-deactivates a budget by setting `status: "archived"`. Historical spending and alert records are preserved.

- **Method:** `DELETE`
- **Endpoint:** `/api/budgets/:id`
- **Auth Required:** Yes (`owner` or `admin` role required)
- **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Budget deactivated successfully (archived)"
}
```

---

### Evaluate Budget Alerts
Manually triggers threshold evaluation for a budget. Automatically creates alerts for any newly crossed thresholds without duplicating existing alerts.

- **Method:** `POST`
- **Endpoint:** `/api/budgets/:id/evaluate`
- **Auth Required:** Yes (`owner` or `admin` role required)
- **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Budget evaluated successfully",
  "data": {
    "budgetId": "674c0100a1b2c3d4e5f67890",
    "budgetName": "Q1 Infrastructure Budget",
    "actualSpend": "1250.00",
    "budgetAmount": "1500.00",
    "percentageUsed": 83.33,
    "newAlerts": [ ... ],
    "existingAlerts": [ ... ]
  }
}
```

---

### List Workspace Alerts
List threshold alert records for the active workspace.

- **Method:** `GET`
- **Endpoint:** `/api/budgets/alerts`
- **Auth Required:** Yes (any active workspace member)
- **Query Parameters:** `status` (`active`, `acknowledged`, `resolved`), `budgetId`, `page`, `limit`.
- **Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "alerts": [
      {
        "id": "674c0200a1b2c3d4e5f67890",
        "budgetId": "674c0100a1b2c3d4e5f67890",
        "budgetName": "Q1 Infrastructure Budget",
        "threshold": 80,
        "actualSpend": "1250.00",
        "budgetAmount": "1500.00",
        "currency": "USD",
        "percentageUsed": 83.33,
        "alertType": "threshold_reached",
        "status": "active",
        "triggeredAt": "2026-03-20T14:30:00.000Z"
      }
    ],
    "pagination": { "total": 1, "page": 1, "limit": 50, "pages": 1 }
  }
}
```

---

### Acknowledge Alert
Mark a triggered budget alert as acknowledged.

- **Method:** `PATCH`
- **Endpoint:** `/api/budgets/alerts/:alertId/ack`
- **Auth Required:** Yes (any active workspace member)
- **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Alert acknowledged successfully",
  "data": {
    "alert": {
      "id": "674c0200a1b2c3d4e5f67890",
      "status": "acknowledged"
    }
  }
}
```


