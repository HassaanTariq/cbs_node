# Core Banking System (CBS Node)

A simple Core Banking System demo built with Node.js, Express, and MySQL (`mysql2/promise`). It demonstrates transaction control (COMMIT/ROLLBACK/SAVEPOINT), basic banking operations, and a lightweight customer portal.

## Prerequisites
- Node.js 18+
- MySQL 8+
- Windows PowerShell (recommended) or any shell

## Quick Start

### 1) Clone and install
```powershell
# From PowerShell
git clone <your-fork-or-repo-url> cbs_node; cd cbs_node
npm install
```

### 2) Configure database
By default, the app connects with:
- `DB_HOST=127.0.0.1`
- `DB_USER=root`
- `DB_PASSWORD=root`
- `DB_NAME=cbs_db`

You can override these via environment variables or a `.env` (optional). See `server/db.js` for details.

Create the schema and seed data:
```powershell
# Run this with your MySQL credentials
mysql -u root -p < sql/database_schema.sql
```

### 3) Run the server
Development (nodemon):
```powershell
# If PowerShell script execution policy blocks npm scripts, run node directly
npm run dev
```
Production:
```powershell
npm start
# Equivalent to: node server/app.js
```

Open:
- Frontend: `http://localhost:3000/`
- Health: `http://localhost:3000/health`
- Customer Portal Login: `http://localhost:3000/customer_login.html`
- TCL Demos: `http://localhost:3000/tcl_complete.html`

## Project Structure
```
public/                 # Static frontend pages
server/                 # Express API
  app.js                # Entry; mounts routes and serves public/
  db.js                 # MySQL pool setup (mysql2/promise)
  controllers/          # Business logic with explicit transactions
  routes/               # API routers
sql/
  database_schema.sql   # Tables + seed data

```

## Common Workflows
- Initialize DB: `mysql -u <user> -p < sql/database_schema.sql`
- Start dev: `npm run dev`
- Start prod: `npm start`


## Key Endpoints
- `GET /health` — service status
- `GET /api/customers` — list customers
- `POST /api/customers` — create customer (payload: `fullname`, `email`, optional `phone`, `cnic`, `address`)
- `GET /api/accounts` — list accounts
- `POST /api/transactions/deposit|withdraw|transfer` — staff-side transactions
- Customer Portal (protected by token `cust_<id>_<timestamp>`):
  - `POST /api/customer/login` — debug login
  - `GET /api/customer/dashboard` — summary + recent
  - `POST /api/customer/transfer` — transfer (cross-customer destination allowed)
  - `GET /api/customer/transactions` — paginated history
  - `GET /api/customer/statement` — statement generation


## Troubleshooting
- PowerShell blocks `npm run`:
  - Use `node server/app.js` directly, or temporarily relax policy:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```
- MySQL connection errors:
  - Verify credentials in `server/db.js` or set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
  - Ensure schema loaded: `mysql -u root -p < sql/database_schema.sql`.
- Port in use:
  - Change `PORT` env var: `set PORT=4000; node server/app.js`

## Development Notes
- Controllers follow explicit transaction control (`beginTransaction`/`commit`/`rollback`) and `SELECT ... FOR UPDATE` for balance updates.
- Audit logging is used for state-changing operations (`AuditLog` table).
- TCL demo endpoints under `/api/tcl/*` show savepoints and partial rollbacks.

## Contributing
Small fixes welcome. See `.github/copilot-instructions.md` for AI-assistant guidance and architectural conventions.
