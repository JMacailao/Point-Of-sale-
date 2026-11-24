# Point of Sale (POS) System

A full-stack, production-oriented point-of-sale web application for small businesses
(retail, sari-sari/convenience stores, groceries, canteens, pharmacies, restaurants).

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite, JavaScript, Tailwind CSS v4, Lucide icons |
| Authentication | **Firebase Authentication** (email + password, password reset, sessions) |
| Backend API | Node.js + Express 5, Firebase Admin SDK, Zod validation, rate limiting, pino logging |
| Database | **Supabase PostgreSQL** with Row Level Security and PL/pgSQL business functions |
| File storage | **Supabase Storage** (store logos, product images) |
| Deployment | Vercel (frontend) + any Node.js host (backend) |

> **Firebase = login and identity. Supabase PostgreSQL = all business data.**
> No passwords are stored in Supabase. Firestore, Realtime Database and Supabase Auth are not used.

---

## Features

- **First-time setup wizard** – create the administrator → store information (logo, business type,
  ₱ PHP, Asia/Manila, DD/MM/YYYY, receipt footer) → "Your store is ready!". Registration is
  closed permanently once the administrator exists.
- **Login** – store-branded sign-in, show/hide password, remember session, forgot password,
  inactive-account handling, session expiry handling, protected routes.
- **Roles** – Administrator (everything) and Cashier (dashboard, cashier, products view-only, own sales).
  Enforced by the API **and** by database RLS.
- **Dashboard** – sales, transactions, products, low stock, recent sales, best sellers, daily chart;
  Today / Last 7 days / This month / custom range. Cashiers see only their own figures.
- **Cashier / POS** – search, category filter, USB barcode-scanner support, cart with stock checks,
  discounts (permission/limit controlled), VAT inclusive/exclusive, Cash / GCash / Maya / Other,
  change calculation, idempotent checkout, receipt preview and printing.
- **Products & categories** – add/edit/archive/restore, images, SKU/barcode uniqueness, search,
  filters, sorting, pagination. Cost prices are hidden from cashiers.
- **Stock / Inventory** – stock in, stock out, count adjustments, low-stock alerts, full movement
  history (previous / change / new quantity, reason, user, time), stock valuation.
- **Users** – create staff (Firebase account created server-side + password setup link/email),
  assign roles, activate/deactivate (also disables the Firebase account and revokes sessions),
  user details and activity log.
- **Revenue & Sales** – filters (date, cashier, payment, status), totals, transaction details,
  full refunds with restock, receipt reprint, CSV export.
- **Expenses** – add/edit (with field-level audit history), void instead of delete, filters, CSV export.
- **Reports** – daily/weekly/monthly/annual gross sales, discounts, refunds, net sales, tax,
  revenue ex-tax, COGS (from cost snapshots at time of sale), gross profit, expenses, net profit;
  top products, payment methods, cashier performance; inventory valuation and movement summary.
- **Receipts** – 58 mm and 80 mm thermal and A4 via the browser print dialog (CSS `@page`
  sized to the receipt). Works with OS-installed USB/network thermal printers and Android print
  services. *There is no direct Bluetooth printer integration.*
- **Settings** – store info & logo, regional/receipt, tax, discount policy, inventory thresholds,
  roles & permission matrix, my profile & password change, audit log.

---

## Architecture

```
Browser (React)                          Backend (Express)                    Supabase
─────────────────                        ──────────────────                   ─────────────────────────
Firebase JS SDK ── sign in ──► Firebase Auth
      │ ID token (Bearer)
      └──────────────────────► verifyIdToken (Admin SDK)
                               load profile + membership + permissions
                               (inactive / no store ⇒ 403)
                               BEGIN
                                 SET LOCAL ROLE authenticated            ► RLS policies apply
                                 request.jwt.claims = {sub: <uid>}       ► SECURITY DEFINER functions
                                 queries / process_sale() / ...            derive the actor from
                               COMMIT                                      the verified claims
                               service role key ───────────────────────► Storage (logos, images)
```

Key security decisions:

- **Identity is never taken from the browser.** The backend verifies every Firebase ID token with
  the Admin SDK (including revocation) and derives the user, role and store itself. The optional
  `X-Store-Id` header only *selects* among stores the user is verified to belong to.
- **RLS is enforced, not bypassed.** User requests run as the Postgres `authenticated` role with the
  verified Firebase UID in `request.jwt.claims` (the same mechanism the Supabase API uses). The
  `anon` role has no access to anything. The privileged connection is only used for setup and
  identity lookup.
- **Atomic first-admin claim.** `claim_initial_admin()` does a conditional `UPDATE` on a singleton
  row; concurrent attempts serialize on the row lock and exactly one succeeds. The backend creates
  the Firebase account first and deletes it again if the claim is lost. The public
  `/api/setup/status` endpoint is only used for screen routing, never for protection.
- **Atomic sales.** `process_sale()` locks the store row (transaction numbering + idempotency) and
  the product rows (sorted, deadlock-free), prices items from the database, validates stock,
  discount authorization and payment, then writes the sale, items (with cost snapshots), payment,
  stock deductions and stock movements in one transaction. A `client_request_id` makes retries and
  double-clicks safe.
- **Stock can only change with a movement record.** `stock_quantity` is not writable by users
  (column privileges) and a trigger blocks any change outside the stock functions.
- **Financial history is append-only.** Sales, sale items, payments, stock movements and audit logs
  cannot be deleted; sale amounts cannot be edited; refunds are a status transition with a reversing
  payment; expenses are voided, not deleted.
- **Audit trail** for store settings, members, profiles, products, categories, expenses (triggers),
  plus sales, refunds, logins and logouts.

### Project structure

```
backend/      Express API (config, middleware, routes, controllers, services, validators, utils, test)
frontend/     React app (components, layouts, pages/*, contexts, hooks, services, utils)
supabase/
  migrations/ 1 schema · 2 roles/permissions/identity/audit · 3 business functions · 4 RLS & grants · 5 storage buckets
  tests/      database test suite (RLS, sales, stock, refunds, isolation) + local bootstrap
  scripts/    reset_initial_setup.sql (authorized reset of an unfinished setup)
firebase.json Firebase Auth emulator config (local development/tests)
```

---

## Setup

### What the owner must supply

These cannot be generated by the code — create them in your own accounts:

1. **Firebase project** (console.firebase.google.com)
   - Authentication → Sign-in method → enable **Email/Password**.
   - Recommended: Authentication → Settings → User actions → **disable "Enable create (sign-up)"**.
     All accounts are created by the backend (first admin, staff), so public sign-up is not needed.
   - Authentication → Settings → Authorized domains → add your Vercel domain.
   - Project settings → General → add a **Web app** → copy the config into `frontend/.env`.
   - Project settings → Service accounts → **Generate new private key** → copy
     `project_id`, `client_email`, `private_key` into `backend/.env`.
2. **Supabase project** (supabase.com)
   - Database password → used in `DATABASE_URL` (Connect → *Session pooler* string, user `postgres`).
   - Project settings → API → **Project URL** (`SUPABASE_URL`) and **service_role key**
     (`SUPABASE_SERVICE_ROLE_KEY`, backend only).

### 1. Database

Apply the migrations in order (Supabase SQL editor, or the Supabase CLI: `supabase db push`):

```
supabase/migrations/20261124000001_schema.sql
supabase/migrations/20261124000002_rbac_and_identity.sql
supabase/migrations/20261124000003_business_functions.sql
supabase/migrations/20261124000004_rls_and_grants.sql
supabase/migrations/20261124000005_storage.sql   (creates the public "store-assets" and "product-images" buckets)
```

### 2. Backend

```bash
cd backend
```

```bash
cp .env.example .env    # fill in the values
```

```bash
npm install
```

```bash
npm start               # http://localhost:4000/api/health
```

On start the server verifies that the database user can assume the `authenticated` role and that
migrations are applied.

### 3. Frontend

```bash
cd frontend
```

```bash
cp .env.example .env    # Firebase web config + VITE_API_BASE_URL
```

```bash
npm install
```

```bash
npm run dev             # http://localhost:5173
```

Open the app: the setup wizard appears on first run.

---

## Running the tests

The tests run against **real** PostgreSQL and the **Firebase Auth emulator** (no mocked auth).

Prerequisites: PostgreSQL 15+ locally, Java 11+, and the Firebase CLI.

```bash
npx firebase-tools emulators:start --only auth --project demo-pos
```

**Database suite** (RLS, setup claim, sales math, idempotency, discounts, tax, overselling, refunds,
immutability, last-admin protection, cross-store isolation, audit):

```bash
./supabase/tests/run_db_tests.sh
```

**API integration suite** (26 tests: concurrent admin registration, setup flow, auth rejection,
products, inventory, users, permissions, sales incl. concurrent checkout of the last units, refunds,
expenses, reports, settings, cross-store access, deactivation). Needs an empty database owned by
`pos_owner` (created by the bootstrap above):

```bash
sudo -u postgres createdb -O pos_owner pos_e2e
```

```bash
cd backend && npm test
```

Results at the time of writing: database suite all passed; API suite 26/26 passed. The full UI flow
(setup wizard → store with logo → products → barcode sale → receipt → users → inventory → expenses →
reports → logout/login → mobile layout) was also exercised end-to-end in Chromium with Playwright at
desktop (1366×820) and Pixel 7 sizes, and the 58 mm print output was verified as a single 58 mm-wide page.

---

## Deployment

**Frontend → Vercel**: import the repo, root directory `frontend`, framework *Vite*. Set the
`VITE_*` variables. `frontend/vercel.json` handles SPA routing.

**Backend → Render / Railway / Fly.io / any Node 20+ host**: root directory `backend`,
start command `npm start`, set the backend variables, set `FRONTEND_URL` to the Vercel URL,
and point the frontend `VITE_API_BASE_URL` at the backend URL. Use HTTPS.

Never set `FIREBASE_AUTH_EMULATOR_HOST` in production (the server refuses to start if you do).

---

## API overview

All responses are JSON: `{ "data": ..., "meta"?: ... }` or `{ "error": { "code", "message", "details"? } }`.
Authenticated endpoints need `Authorization: Bearer <Firebase ID token>`.

| Area | Endpoints |
|---|---|
| Setup | `GET /api/setup/status` · `POST /api/setup/initialize-admin` · `POST /api/setup/store` |
| Auth | `POST /api/auth/verify` · `GET /api/auth/me` · `POST /api/auth/logout` · `PUT /api/auth/profile` |
| Dashboard | `GET /api/dashboard/summary` · `GET /api/dashboard/sales` |
| Products | `GET/POST /api/products` · `GET /api/products/lookup?code=` · `GET/PUT/DELETE /api/products/:id` · `POST /api/products/:id/restore` |
| Categories | `GET/POST /api/categories` · `PUT/DELETE /api/categories/:id` |
| Inventory | `GET /api/inventory` · `POST /api/inventory/stock-in` · `/stock-out` · `/adjustment` · `GET /api/inventory/movements` |
| Sales | `GET/POST /api/sales` · `GET /api/sales/export` · `GET /api/sales/:id` · `POST /api/sales/:id/refund` |
| Users | `GET/POST /api/users` · `GET/PUT /api/users/:id` · `PUT /api/users/:id/status` · `GET /api/users/:id/activity` · `GET /api/roles` |
| Expenses | `GET/POST /api/expenses` · `GET /api/expenses/export` · `GET/PUT/DELETE(void) /api/expenses/:id` |
| Reports | `GET /api/reports/sales` · `GET /api/reports/sales/export` · `GET /api/reports/inventory` |
| Settings | `GET/PUT /api/settings/store` · `GET /api/settings/audit-logs` |

---

## Known limitations

- Refunds are **full** refunds (all items restocked); partial refunds are not implemented.
  Refunds are reported in the period of the original sale.
- Role permissions are a fixed matrix (shown read-only in Settings); store-level policy such as
  cashier discounts is configurable.
- One store is created by the setup wizard. The schema, RLS and API are multi-store aware
  (`X-Store-Id`), but there is no UI to create additional stores.
- Receipt printing uses the browser/OS print system; no direct Bluetooth/ESC-POS integration.
- Negative stock prevention is always on (not configurable).
- Resetting an **unfinished** setup is a manual, owner-run SQL script
  (`supabase/scripts/reset_initial_setup.sql`); it refuses to run once a store exists.
