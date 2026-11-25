# POS System

A point-of-sale web app built with **plain HTML, CSS and JavaScript** — no build step, no npm, no server.

- **Login:** Firebase Authentication (email + password, password reset)
- **Data:** Supabase PostgreSQL (products, stock, sales, expenses, users, settings, audit log)
- **Images:** Supabase Storage (store logo, product pictures)

The browser talks to Firebase and Supabase directly. Security is enforced **inside the database**:
Supabase checks every Firebase login token, and row level security + database functions decide
what each user may see and do. Nothing secret is stored in the website files.

```
web/                     the whole app (upload this folder to any static host)
  index.html
  css/styles.css
  js/                    app code (config.js holds the public Firebase/Supabase settings)
supabase/setup.sql       the whole database in ONE file — run it once
supabase/tests/          database test suite
```

---

## Setup (about 10 minutes)

### 1. Supabase — create the database

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Open `supabase/setup.sql`, copy **everything**, paste it, click **Run**. (Run it once, on a fresh project.)
3. Check: `select * from system_settings;` returns one row.

If it stops with an error, nothing was changed (it runs as one transaction):
- **"POS database is ALREADY INSTALLED"** → it already worked earlier; go to step 2.
- **"already has tables with the same names"** (or `relation "system_settings" already exists`) → this project
  contains another app's tables. Use a **new, empty Supabase project** (recommended), or, only if that data is not
  needed, run `supabase/reset.sql` (deletes those tables) and then `setup.sql` again.

### 2. Supabase — accept Firebase logins

Supabase → **Authentication** → **Sign In / Providers** → **Third-Party Auth** → **Add provider** →
**Firebase** → Project ID: `pointofsale-c6771` → **Create**.

Without this step the app shows *"Supabase did not accept the Firebase sign-in"*.

### 3. Firebase

1. **Authentication → Sign-in method:** Email/Password must be **enabled** (it is).
2. **Authentication → Settings → User actions:** keep **"Enable create (sign-up)" ON** —
   the setup wizard and the Users page create accounts from the browser. A stranger who signs up
   gets no access: the database only lets in people an administrator added.
3. **Authentication → Settings → Authorized domains:** add the domain where you host the app
   (e.g. `my-pos.netlify.app`). `localhost` is already there.

### 4. Put the website online

Upload the **`web`** folder to any static host — no build command:

- **Netlify:** drag-and-drop the `web` folder at app.netlify.com/drop
- **Vercel:** import the repo, Root Directory `web`, Framework *Other*, no build command
- **GitHub Pages:** repo **Settings → Pages → Source: GitHub Actions**. The included workflow
  (`.github/workflows/deploy-pages.yml`) publishes `web/` on every push. Site: `https://<user>.github.io/<repo>/`.
  Add `<user>.github.io` to Firebase authorized domains.
- **Firebase Hosting / cPanel:** upload the contents of `web`

To try it on your computer, serve the folder with any simple web server (opening `index.html`
directly from disk does not work because browsers block JavaScript modules from `file://`):

```bash
cd web
```

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

### 5. First run

Open the site → **"Welcome! Let's set up your POS."** → create the administrator → enter store
details (logo optional) → **Go to Dashboard**. From then on everyone sees the normal login page.

---

## Features

- **Setup wizard:** administrator → store info (₱ PHP, Asia/Manila, DD/MM/YYYY, receipt footer, logo) → "Your store is ready!".
  The first-administrator claim is a single atomic database operation, so two people registering at the same time cannot both become admin.
  Registration never appears again afterwards.
- **Login:** remember me, show/hide password, forgot password, clear error messages, deactivated-account blocking, session expiry handling.
- **Roles:** Administrator (everything) and Cashier (dashboard, cashier, products view-only, own sales). Enforced by the database.
- **Dashboard:** today's sales, transactions, cash vs card/e-wallet, products, low stock, sales chart, recent sales, best sellers, quick actions.
- **Cashier:** product cards, search, categories, USB barcode scanners, cart with stock limits, discounts (by permission/limit), VAT inclusive/exclusive,
  payment window (Cash, GCash, Maya, Card/Other) with change and reference number, double-click-safe checkout, receipt.
- **Products:** add/edit/archive/restore, images, SKU/barcode uniqueness, categories, search/filter/sort/paging, **Excel import/export** (CSV) with template.
- **Stock / Inventory:** stock in, stock out, count adjustments, low-stock alerts, full movement history, stock value.
- **Users:** create staff (Firebase emails them a password-setup link), roles, activate/deactivate, activity log.
- **Revenue & Sales:** filters, details, full refunds with restock, receipt reprint (58mm / 80mm / A4), CSV export.
- **Expenses:** add/edit with audit history, void instead of delete, filters, export.
- **Reports:** daily/weekly/monthly/annual gross sales, discounts, refunds, net sales, tax, cost of goods (from cost at time of sale),
  gross and net profit, top products, payments, cashiers, inventory valuation; export and Print/PDF.
- **Settings:** store info & logo, tax, discounts, inventory, printer (paper size + test print), scanner on/off, roles matrix, profile & password, audit log.

## Security notes

- Every request carries the user's Firebase token. Supabase verifies it and only accepts tokens from Firebase project `pointofsale-c6771`.
- Sales, refunds, stock changes and user management run in database functions that check permissions and do all writes in one transaction
  (sale + items + payment + stock + movement succeed or fail together). Prices come from the database, never from the browser.
- Stock can only change together with a recorded movement; sales, payments, movements and audit logs cannot be deleted or edited.
- The Supabase **publishable** key and Firebase web config in `web/js/config.js` are designed to be public.
  Never put the Supabase secret/service-role key in the website.

## Known limitations

- **Deactivated users** lose all access immediately (the database blocks them), but their Firebase login itself is not disabled —
  that needs Firebase Admin (a server). They can sign in to Firebase but see only "account deactivated".
- Cashiers cannot see cost prices in the app, but a technically skilled cashier could read them through the database API.
- Refunds are full refunds. Role permissions are a fixed matrix. One store is created by setup.
- Printing uses the browser print dialog (USB/network thermal printers, Android print services); no direct Bluetooth printing.
- "Excel" import/export uses CSV files, which Excel opens and saves.

## Tests

The database suite runs `setup.sql` on a local PostgreSQL and checks permissions, the atomic admin claim, sales math, discounts,
tax, overselling, refunds, immutability, store isolation and rejection of tokens from other Firebase projects:

```bash
./supabase/tests/run_db_tests.sh
```

The full browser flow (setup → products → barcode sale → GCash sale → refund → users → stock → expenses → reports →
logout/login → cashier permissions → deactivation → mobile layout) was exercised end-to-end in Chromium against the
Firebase Auth emulator and a local PostgreSQL with `setup.sql`.

If an administrator was registered but store setup was never finished, `supabase/scripts/reset_initial_setup.sql`
resets the claim (it refuses to run once a store exists).
