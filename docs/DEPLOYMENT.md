# MeterFlow — Production Hosting & Deployment Guide

This document describes the production deployment architecture, environment requirements, database setup, and verification procedures for hosting MeterFlow on **Render** with **MongoDB Atlas**.

---

## 1. Architecture Overview

MeterFlow follows a single-origin web architecture:

```text
Browser Client (HTTPS)
       │
       ▼
Render Web Service (Node.js / Express v5)
  ├── Static Frontend Serving (Vanilla HTML5 / CSS3 / ES Modules)
  └── REST API (/api/...)
       │
       ▼
MongoDB Atlas (Cloud Managed Replica Set)
  ├── Multi-Tenant Compound Indexes
  └── High-Precision Decimal Documents
```

- **Single Application Origin**: The frontend is served directly from the Express backend via safe static file mounting (`frontendDir`). All API requests target `/api/...` on the identical host, eliminating cross-origin CORS overhead and pre-flight latency.
- **Stateless Backend**: Authentication is fully stateless using cryptographically signed JSON Web Tokens (JWT). The service can scale horizontally without session synchronization.
- **Zero Build Step**: The frontend uses native browser ES Modules, CSS custom properties, and standard web APIs. No Vite, Webpack, or frontend build tool is required.

---

## 2. Required Production Environment Variables

Configure the following environment variables in the Render Dashboard (under **Environment**):

| Variable | Description | Example / Constraint |
| :--- | :--- | :--- |
| `NODE_ENV` | Runtime environment flag | Set to `production` (enforces strict error sanitization and JWT validation) |
| `PORT` | HTTP server listen port | Automatically assigned by Render (default fallback: `5000`) |
| `HOST` | Bind network host address | Set to `0.0.0.0` (binds all container network interfaces) |
| `MONGODB_URI` | MongoDB Atlas SRV connection string | `mongodb+srv://<db_user>:<db_password>@<cluster>.mongodb.net/meterflow?retryWrites=true&w=majority` |
| `JWT_SECRET` | Cryptographic secret for signing JWTs | Minimum 16 characters (Render can auto-generate a secure 64-character random string) |

> [!CAUTION]
> Never commit actual credentials, connection strings, or `.env` files into source control. All secrets must be injected securely via Render's environment settings.

---

## 3. MongoDB Atlas Configuration

### A. Dedicated Database User
1. In the MongoDB Atlas Console, navigate to **Security** > **Database Access**.
2. Click **Add New Database User**.
3. Select **Password Authentication**.
4. Grant the **Read and write to any database** role, or scope specifically to `meterflow` (`readWrite@meterflow`).
5. Save the generated credentials securely.

### B. Network Access (IP Access List)
1. Navigate to **Security** > **Network Access**.
2. Click **Add IP Address**.
3. **Important Note on Render Free/Starter Tiers**: Render's standard web services use dynamic egress IP addresses from a shared pool. Therefore, you must add `0.0.0.0/0` ("Allow Access from Anywhere") to the IP Access List so that Render container instances can connect.
4. If utilizing Render Team/Enterprise tiers with dedicated **Static Outbound IP** add-ons, add Render's specific static outbound IPs instead of `0.0.0.0/0`.

### C. Target Database Name
Ensure the connection string explicitly references the production database name (e.g. `/meterflow`):
```text
mongodb+srv://<username>:<password>@cluster0.xnaulto.mongodb.net/meterflow?retryWrites=true&w=majority
```

### D. Conservative Connection Pool Sizing
MeterFlow's production configuration in `backend/src/config/database.js` specifies conservative initial pooling:
- `maxPoolSize`: `10`
- `minPoolSize`: `2`
- `serverSelectionTimeoutMS`: `10000` (10s fail-fast timeout)
- `socketTimeoutMS`: `45000`
- `heartbeatFrequencyMS`: `10000`

This prevents exceeding the connection limits of Atlas M0/M10 shared clusters (500 maximum connections).

---

## 4. Render Deployment Instructions

### Option 1: Automatic Blueprint Deployment (`render.yaml`)
1. MeterFlow includes a root [render.yaml](../render.yaml) configuration file.
2. In the Render Dashboard, click **New +** > **Blueprint**.
3. Select the `meter-flow` repository.
4. Render will parse `render.yaml`, configure the web service, set the health check path to `/api/health`, and prompt for `MONGODB_URI`.
5. Provide the Atlas connection URI and click **Apply**.

### Option 2: Manual Web Service Configuration
1. In Render Dashboard, click **New +** > **Web Service**.
2. Connect your GitHub repository (`manav-chaudhary01/meter-flow`).
3. Set the following build and run settings:
   - **Name**: `meterflow`
   - **Region**: Choose the region closest to your MongoDB Atlas cluster (e.g. `Frankfurt`, `Oregon`, or `Singapore`).
   - **Branch**: `main`
   - **Root Directory**: `backend` (or leave blank if using root `package.json`)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free` or `Starter`
4. Under **Advanced**:
   - **Health Check Path**: `/api/health`
   - **Auto-Deploy**: `Yes`
5. Under **Environment Variables**, add:
   - `NODE_ENV`: `production`
   - `HOST`: `0.0.0.0`
   - `MONGODB_URI`: `<your-atlas-connection-string>`
   - `JWT_SECRET`: `<your-secure-jwt-secret>`
6. Click **Create Web Service**.

---

## 5. Startup & Health Verification

Once deployed, Render assigns a public URL: `https://<service-name>.onrender.com`.

### 1. Health Check Endpoint
Query the health check endpoint:
```bash
curl -s https://<service-name>.onrender.com/api/health
```
Expected HTTP 200 JSON Response:
```json
{
  "success": true,
  "status": "healthy",
  "message": "MeterFlow API is running",
  "database": "connected",
  "uptime": 12,
  "timestamp": "2026-11-21T15:30:00.000Z"
}
```
If `status` reports `"degraded"` or `database` reports `"disconnected"`, check the Atlas Network Access IP whitelist and credentials.

### 2. Frontend Verification
Navigate to `https://<service-name>.onrender.com/` in any modern web browser:
1. **Register**: Create an initial owner account and organization workspace at `/register.html`.
2. **Login**: Authenticate at `/login.html` and verify redirection to `/dashboard.html`.
3. **Services**: Create a metered service at `/services.html`.
4. **Usage**: Ingest a metered usage event at `/usage.html`.
5. **Billing**: Generate a period invoice at `/billing.html` and inspect reconciled line items.
6. **Budgets**: Set a workspace spending budget and review the deterministic linear run-rate forecast at `/budgets.html`.

---

## 6. Production Security Considerations

MeterFlow includes comprehensive production security controls:
1. **Content Security Policy (CSP)**: Managed by Helmet with strict script, frame, object, and style sources.
2. **Anti-Clickjacking**: `X-Frame-Options: DENY` and `frame-ancestors: 'none'`.
3. **Payload Limit Guard**: Request body capped at `500kb`; malformed JSON syntax is intercepted with sanitized 400 Bad Request responses.
4. **Production Error Sanitization**: Internal 500 server errors suppress stack traces and database error internals, returning generic `"Internal server error"`.
5. **Static File Guard**: Dotfiles (e.g. `.env`) and parent directory traversal are strictly blocked by Express static serving rules.
6. **Stateless JWT Security**: Passwords hashed with `bcryptjs` (cost factor 10); JWT tokens verified on every protected request.
