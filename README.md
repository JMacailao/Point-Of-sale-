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
supabase/upgrades/       add-ons for databases installed with an older setup.sql
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
- **GitHub Pages:** repo **Settings → Pages → Source: Deploy from a branch**, pick the branch and **/ (root)**.
  The top-level `index.html` forwards visitors to the app in `web/`. Site: `https://<user>.github.io/<repo>/`.
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

### Android app (APK)

The `android-app/` folder packages the same `web/` app as an Android app (Capacitor) with native extras:
**classic Bluetooth printer support** (lists paired printers and scans for nearby ones — this covers most
portable 58mm/80mm thermal printers, which browsers cannot reach), Android printing (Wi-Fi printers, PDF,
print apps) and saving CSV exports through the share sheet. Camera scanning works the same as on the web.

**Download:** every push that changes `web/` or `android-app/` runs the *Build Android APK* workflow, which puts
`POS-System.apk` on the repository's **Releases → apk-latest** page. On the phone: download it, open it, and allow
installing apps from that source. (It is a debug-signed build for direct installation; publishing on Google Play
needs a release signing key.)

**In the app:** Settings → Printer & Scanner → *Bluetooth printer* → **Scan for printers** → **Connect**.
Android asks for "Nearby devices" (or Location on Android 11 and older) the first time.

To build locally instead: install Node 20+, Java 21 and Android Studio, then:

```bash
cd android-app
```

```bash
npm install && npm run sync
```

```bash
cd android && ./gradlew assembleDebug
```

### Already installed? Add new modules

If your database was set up **before** the *Today's Menu* module existed, run `supabase/upgrades/add_daily_menu.sql`
once (Supabase → SQL Editor → paste → Run). Likewise, for store **registration** run `supabase/upgrades/add_store_registration.sql`, to limit cashiers to the
Cashier screen run `supabase/upgrades/cashier_only.sql`, and for per-user access checkboxes run
`supabase/upgrades/add_user_access.sql` (run them in that order).
Both are safe to run twice; a fresh `setup.sql` already includes them.

The menu link uses the website's own address. In the Android app it uses `PUBLIC_APP_URL` in `web/js/config.js`
(set to this repository's GitHub Pages site) — change it if the website is hosted elsewhere.

### 5. First run

Open the site → **"Welcome! Let's set up your POS."** → create the administrator → enter store
details (logo optional) → **Go to Dashboard**. From then on everyone sees the normal login page.

---

## Features

- **Setup wizard:** administrator → store info (₱ PHP, Asia/Manila, DD/MM/YYYY, receipt footer, logo) → "Your store is ready!".
  The first-administrator claim is a single atomic database operation, so two people registering at the same time cannot both become admin.
  Registration never appears again afterwards.
- **Registration (new stores):** after the first setup, the login page shows **"New business? Create a store account"**.
  Anyone can sign up with their name, email, password and store details and becomes the administrator of their **own** store.
  Stores are completely separate: each sees only its own products, stock, sales, expenses, staff, menu and audit log
  (enforced by the database). One account belongs to one store. If a sign-up is interrupted, signing in continues it.
  With several stores, the login page shows the generic "POS System" title instead of one store's logo.
- **Login:** remember me, show/hide password, forgot password, clear error messages, deactivated-account blocking, session expiry handling.
- **Roles & access:** Administrator (everything) and Staff. For each staff member the administrator **ticks what they can use**
  in Create/Edit User: Cashier screen, discounts, Dashboard, view/edit products, view/change stock, own/all sales, refunds,
  expenses, reports and Today's Menu. New staff start with the Cashier screen only. Managing users and store settings is
  administrator-only. Enforced by the database (not just hidden in the app).
- **Dashboard:** today's sales, transactions, cash vs card/e-wallet, products, low stock, sales chart, recent sales, best sellers, quick actions.
- **Cashier:** product cards, search, categories, USB barcode scanners, cart with stock limits, discounts (by permission/limit), VAT inclusive/exclusive,
  payment window (Cash, GCash, Maya, Card/Other) with change and reference number, double-click-safe checkout, receipt.
- **Products:** add/edit/archive/restore, images, SKU/barcode uniqueness, categories, search/filter/sort/paging, **Excel import/export** (CSV) with template.
- **Stock / Inventory:** stock in, stock out, count adjustments, low-stock alerts, full movement history, stock value.
- **Today's Menu:** pick the products available today (or tomorrow / any day), add a note (e.g. "Order before 11 AM"), save, then
  share one link on Messenger, Facebook or any chat — **Share…** (phone share sheet), **Messenger**, **Post on Facebook**,
  **Copy link** or **Copy menu as text** (names and prices, ready to paste). Customers open the link without an account and see
  the store name, logo, note, pictures, prices and "Sold out" for items with no stock (can be turned off). The link always shows
  *today's* menu (store time zone), so it can be posted once and reused; **Reset link** makes the old link stop working.
  Only names, descriptions, pictures and selling prices are shown — never cost or stock counts.
- **Users:** create staff (Firebase emails them a password-setup link), roles, activate/deactivate, activity log.
- **Revenue & Sales:** filters, details, full refunds with restock, receipt reprint (58mm / 80mm / A4), CSV export.
- **Expenses:** add/edit with audit history, void instead of delete, filters, export.
- **Reports:** daily/weekly/monthly/annual gross sales, discounts, refunds, net sales, tax, cost of goods (from cost at time of sale),
  gross and net profit, top products, payments, cashiers, inventory valuation; export and Print/PDF.
- **Sales by Item report:** every item sold in a period — quantity, transactions, average price, sales, cost, profit, % of sales
  and refunded quantity, with a total row, search, category filter, sorting, "include items with no sales", Excel export and Print/PDF.
- **Camera barcode scanner:** scan with the phone/tablet camera or a webcam on the Cashier screen (continuous scanning, each item counted once
  while held in view) and in the product form. Uses the browser's built-in detector, or the ZXing reader loaded from the jsDelivr CDN. Needs HTTPS.
- **Bluetooth receipt printer:** Settings → Printer & Scanner → *Bluetooth printer* → **Find Bluetooth printers** opens the list of nearby
  Bluetooth devices; pick the printer and receipts print directly (ESC/POS, 58mm/80mm). Chrome/Edge on Android, Windows, macOS, ChromeOS,
  with Bluetooth Low Energy thermal printers. Otherwise “Printers on this device” uses the print window, which lists every installed printer.
- **Settings:** store info & logo, tax, discounts, inventory, printer (method, Bluetooth printer, paper size, test print), scanner on/off + camera test, roles matrix, profile & password, audit log.

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
- On the website, direct Bluetooth printing needs Chrome/Edge (not iPhone/iPad or Firefox) and a Bluetooth **Low Energy** printer.
  The Android app supports classic Bluetooth printers too. Bluetooth receipts are text only (no logo). There is no iPhone app.
- A website cannot list the printers installed on a computer or detect whether a USB/Bluetooth barcode scanner is connected:
  the print window shows the installed printers, and the hardware-scanner switch in Settings controls whether the camera button is the main scan option.
- "Excel" import/export uses CSV files, which Excel opens and saves.

## Tests

The database suite runs `setup.sql` on a local PostgreSQL and checks permissions, the atomic admin claim, sales math, discounts,
tax, overselling, refunds, immutability, store isolation, the public menu link, store registration, per-user access and rejection of tokens from other Firebase projects:

```bash
./supabase/tests/run_db_tests.sh
```

The full browser flow (setup → products → barcode sale → GCash sale → refund → users → stock → expenses → reports →
logout/login → cashier permissions → deactivation → mobile layout) was exercised end-to-end in Chromium against the
Firebase Auth emulator and a local PostgreSQL with `setup.sql`.

**Upgrading an existing database:** if `setup.sql` was run before a feature was added, run the matching file in
`supabase/upgrades/` once in the SQL Editor (for example `add_sales_by_item.sql` for the Sales by Item report).

If an administrator was registered but store setup was never finished, `supabase/scripts/reset_initial_setup.sql`
resets the claim (it refuses to run once a store exists).
