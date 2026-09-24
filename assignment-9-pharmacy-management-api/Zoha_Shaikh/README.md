# 💊 Pharmacy & Healthcare Store REST API (RBAC & JWT)

> Production-grade Pharmacy Management and Medicine Ordering REST API built with Node.js, Express.js, MongoDB Atlas, and Mongoose, secured with strict multi-role Role-Based Access Control (RBAC) and JWT authentication.

---

## 🌟 Overview & Features

- **Multi-Role Access Hierarchy**: 3 distinct user tiers (`Admin`, `Pharmacist`, `Customer`) with strict permission boundaries.
- **Bootstrapping Admin Key**: Secure staff onboarding via `x-admin-key` header to bootstrap initial administrators and pharmacists.
- **Complex Schema Modeling**: Nested order item snapshots, integer-validated stock levels, prescription flags, and virtual expiration properties.
- **MongoDB Atlas Aggregations**: Fast pipeline queries for expiring medicines (`$dateDiff`, `$sort`, `$project`) and low-stock alerts with `$facet` category breakdowns.
- **Atomic Stock Deductions & Rollbacks**: Concurrency-safe order approval and post-approval cancellation restock algorithms ensuring zero negative stock and zero race conditions.
- **Production-Ready Hardening**: Helmet HTTP headers, IP-based rate limiting on authentication routes, clean MVC layering, structured JSON error mapping, and graceful in-memory MongoDB fallback for instant local testing.

---

## 🛠️ Tech Stack & Dependencies

- **Runtime**: Node.js (`>= 18.0.0`)
- **Web Framework**: Express.js (`4.x`)
- **Database & ODM**: MongoDB Atlas & Mongoose (`8.x`)
- **Authentication & Security**: JSON Web Tokens (`jsonwebtoken`), `bcryptjs` (10 salt rounds), `helmet`, `cors`, `express-rate-limit`
- **Environment**: `dotenv`
- **Development & Testing**: `nodemon`, `mongodb-memory-server` (local fallback)

---

## 👥 Role-Based Permission Matrix

| Endpoint / Action | Method | Customer | Pharmacist | Admin | Access Protection |
|---|:---:|:---:|:---:|:---:|---|
| `/api/auth/register` | `POST` | ✅ | ❌ | ❌ | Public (Forces `role: customer`) |
| `/api/auth/register-staff` | `POST` | ❌ | ✅ | ✅ | Header `x-admin-key` |
| `/api/auth/login` | `POST` | ✅ | ✅ | ✅ | Public |
| `/api/auth/profile` | `GET` | ✅ | ✅ | ✅ | JWT Authenticated |
| `/api/medicines` (Catalog) | `GET` | ✅ | ✅ | ✅ | Public (`includeExpired` staff only) |
| `/api/medicines/expiring` | `GET` | ❌ | ✅ | ✅ | `pharmacist`, `admin` |
| `/api/medicines/low-stock` | `GET` | ❌ | ✅ | ✅ | `pharmacist`, `admin` |
| `/api/medicines` (Add Drug) | `POST` | ❌ | ✅ | ✅ | `pharmacist`, `admin` |
| `/api/medicines/:id` (Update) | `PUT` | ❌ | ✅ | ✅ | `pharmacist`, `admin` |
| `/api/medicines/:id` (Delete) | `DELETE` | ❌ | ❌ | ✅ | `admin` Only |
| `/api/orders` (Place Order) | `POST` | ✅ | ❌ | ❌ | `customer` Only |
| `/api/orders/my-orders` | `GET` | ✅ | ❌ | ❌ | `customer` Only |
| `/api/orders` (List All) | `GET` | ❌ | ✅ | ✅ | `pharmacist`, `admin` |
| `/api/orders/:id/status` (Update) | `PATCH` | ❌ | ✅ | ✅ | `pharmacist`, `admin` |
| `/api/reports/expiring-soon` | `GET` | ❌ | ✅ | ✅ | `pharmacist`, `admin` |
| `/api/reports/low-stock` | `GET` | ❌ | ✅ | ✅ | `pharmacist`, `admin` |

---

## 📦 Order Lifecycle & Atomic Stock Deductions

### State Transition Diagram

```
                +---------------------------------------+
                |                                       |
                v                                       | (Restock Inventory)
[ Customer: POST /api/orders ]                          |
                |                                       |
                v                                       |
          +-----------+   Reject / Cancel   +-----------+
          |  PENDING  | ------------------> | CANCELLED | (Terminal)
          +-----------+                     +-----------+
                |
                | (Atomic Stock Deduction & Rx Verification)
                v
          +-----------+   Dispense Order    +-----------+
          | APPROVED  | ------------------> | DISPENSED | (Terminal)
          +-----------+                     +-----------+
                |
                +---------------------------------------+
```

### Atomic Stock Deduction Algorithm

When staff approves a pending order (`PATCH /api/orders/:id/status` with `status: 'approved'`):
1. **Atomic Order Claiming**:
   ```javascript
   const claimedOrder = await Order.findOneAndUpdate(
     { _id: id, status: 'pending' },
     { status: 'approved', prescriptionVerified: true, reviewedBy: req.user._id },
     { new: true }
   );
   ```
   If `claimedOrder` returns `null`, the order was already processed concurrently — responding with `409 Conflict`.
2. **Conditional Stock Decrement**:
   For each item in the order, Mongoose executes:
   ```javascript
   await Medicine.updateOne(
     { _id: item.medicine, stockQuantity: { $gte: item.quantity } },
     { $inc: { stockQuantity: -item.quantity } }
   );
   ```
3. **Automatic Rollback on Insufficient Stock**:
   If any item fails (`modifiedCount !== 1`):
   - All previously decremented items are immediately restored using `$inc: { stockQuantity: item.quantity }`.
   - The order state reverts back to `pending`.
   - The API returns `400 Bad Request` (`"Insufficient stock for <medicine>"`).
4. **Post-Approval Cancellation Restock**:
   If an approved order is subsequently cancelled (`approved` -> `cancelled`), all item quantities are automatically credited back to inventory (`$inc: { stockQuantity: +quantity }`).

---

## 🔑 Seeded Demo Credentials

| Role | Email | Password | Permissions |
|---|---|---|---|
| **Admin** | `admin@pharmacy.com` | `Admin@123` | Full access (medicine CRUD + delete, staff orders, reports) |
| **Pharmacist** | `pharmacist@pharmacy.com` | `Pharma@123` | Medicine add/edit, order approve/dispense, reports |
| **Customer** | `customer@pharmacy.com` | `Customer@123` | Public catalog browse, order placement, order history |

---

## 🚀 Quick Start & Local Setup

### 1. Clone & Install
```bash
git clone https://github.com/kartikwagh21/itm-assignment-09-pharmacy-api.git
cd itm-assignment-09-pharmacy-api
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` as needed:
```env
PORT=5001
NODE_ENV=development
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/pharmacy_db?retryWrites=true&w=majority
JWT_SECRET=supersecurepharmacyjwtsecretkey2026!@#$%^&*()_+
JWT_EXPIRES_IN=1d
ADMIN_KEY=supersecretadminkey2026
CORS_ORIGIN=*
```
*(Note: If `MONGO_URI` is left blank during local development, the server automatically boots an in-memory MongoDB instance!)*

### 3. Seed Database
```bash
npm run seed
# Or to reset and wipe existing data:
npm run seed -- --reset
```

### 4. Run Server
```bash
# Development mode with hot reload
npm run dev

# Production start
npm start
```

### 5. Run Automated Smoke Test Suite
```bash
npm run test:smoke
```

---

## 📮 API Endpoints Specification

### 1. Authentication (`/api/auth`)
- `POST /api/auth/register` — Register a customer account. Body: `{ "name": "...", "email": "...", "password": "..." }`.
- `POST /api/auth/register-staff` — Register staff account (`pharmacist` or `admin`). Header `x-admin-key: <ADMIN_KEY>`. Body: `{ "name": "...", "email": "...", "password": "...", "role": "pharmacist" }`.
- `POST /api/auth/login` — Login with credentials. Returns `{ "token": "...", "user": { ... } }`.
- `GET /api/auth/profile` — Get authenticated user details. Header `Authorization: Bearer <token>`.

### 2. Medicines Catalog & Inventory (`/api/medicines`)
- `GET /api/medicines` — Public catalog with search & filters:
  - Query parameters: `search`, `category`, `dosageForm`, `minPrice`, `maxPrice`, `inStock=true`, `requiresPrescription=true`, `sort=price_asc|price_desc|name_asc|expiry_asc`, `page=1`, `limit=20`.
  - Expired medicines are excluded by default (`includeExpired=true` available for staff only).
- `GET /api/medicines/expiring?days=30` (Staff only) — Aggregation pipeline computing `daysUntilExpiry`.
- `GET /api/medicines/low-stock?threshold=10` (Staff only) — Aggregation pipeline with `$facet` category summary.
- `POST /api/medicines` (Staff only) — Add new medicine.
- `PUT /api/medicines/:id` (Staff only) — Update stock or pricing.
- `DELETE /api/medicines/:id` (Admin only) — Remove medicine from database.

### 3. Orders & Prescriptions (`/api/orders`)
- `POST /api/orders` (Customer only) — Place an order.
  ```json
  {
    "items": [{ "medicineId": "651f...", "quantity": 2 }],
    "prescriptionNotes": "Dr. Smith Rx#9012"
  }
  ```
- `GET /api/orders/my-orders` (Customer only) — View personal order history.
- `GET /api/orders?status=pending` (Staff only) — List all orders across pharmacy.
- `PATCH /api/orders/:id/status` (Staff only) — Approve, dispense, or cancel order:
  ```json
  {
    "status": "approved",
    "prescriptionVerified": true
  }
  ```

### 4. Reports (`/api/reports`)
- `GET /api/reports/expiring-soon?days=30` — Staff alias for expiring medicines pipeline.
- `GET /api/reports/low-stock?threshold=10` — Staff alias for low-stock inventory alerts.

---

## 🧪 Postman Collection & Testing Guide

The repository includes pre-configured collection and environment files in `postman/`:
- `postman/Pharmacy_API.postman_collection.json`
- `postman/Pharmacy_API.postman_environment.json`

### Import & Run in Postman:
1. Open Postman -> Click **Import** -> Select both JSON files from `postman/`.
2. Select the **Pharmacy API Environment** from the top-right environment selector.
3. If running locally, `baseUrl` defaults to `http://localhost:5001`. If testing on Render, change `baseUrl` to `https://<your-render-app>.onrender.com`.
4. Recommended execution order:
   1. `1. Health & Discovery` -> `Health Check`
   2. `2. Auth & RBAC Setup` -> `Login as Customer`, `Login as Pharmacist`, `Login as Admin` (Tokens are automatically saved into environment variables).
   3. `3. Medicines Inventory` -> Browse catalog, add, update, delete tests.
   4. `4. Orders & Prescriptions` -> Place order, list orders, approve, dispense, cancel.
   5. `5. Reports` -> Query expiring and low-stock aggregations.

---

## ☁️ Deployment Guide (Render + MongoDB Atlas)

### Step 1: MongoDB Atlas Setup
1. Log into [MongoDB Atlas](https://www.mongodb.com/atlas) and create a free M0 cluster.
2. In **Security -> Database Access**, create a user with read/write access.
3. In **Security -> Network Access**, click **Add IP Address** -> **Allow Access From Anywhere (`0.0.0.0/0`)** (required for Render outbound connections).
4. Copy your Connection String (`mongodb+srv://...`).

### Step 2: Push Repository to GitHub
```bash
git init
git add .
git commit -m "Initial commit: Pharmacy & Healthcare Store REST API"
git branch -M main
git remote add origin https://github.com/kartikwagh21/itm-assignment-09-pharmacy-api.git
git push -u origin main
```

### Step 3: Deploy to Render
1. Go to [Render Dashboard](https://dashboard.render.com/) -> **New +** -> **Web Service**.
2. Connect your GitHub repository `itm-assignment-09-pharmacy-api`.
3. Fill in settings:
   - **Environment**: `Node`
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
4. In **Advanced -> Health Check Path**, set `/health`.
5. In **Environment Variables**, add:
   - `NODE_ENV` = `production`
   - `MONGO_URI` = `<your_mongodb_atlas_connection_string>`
   - `JWT_SECRET` = `<long_random_secure_secret_key>`
   - `ADMIN_KEY` = `<your_custom_staff_secret_key>`
   - `JWT_EXPIRES_IN` = `1d`
6. Click **Create Web Service**.

> **Note on Render Free Tier**:
> - Free services on Render spin down during periods of inactivity. The initial cold request may take 30–60 seconds to respond.
> - Data in MongoDB Atlas persists across Render restarts and redeployments.


DEPLOYMENT LINK: 
https://assignment-9-pharmacy-management-api-5qct.onrender.com
