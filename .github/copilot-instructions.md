# GitHub Copilot Instructions for CBS Node (Core Banking System)

These concise, project-specific guidelines help AI coding agents be immediately productive in this repository.

- Project entry: `server/app.js` (Express API) and `public/` (static frontend pages).
- Purpose: Node.js + Express backend using `mysql2/promise`. Focus: Transaction control (TCL) demos, basic banking operations (customers, accounts, transactions), and a simple customer portal.

Key workflows

- Start server (development): `npm run dev` (requires `nodemon`)
- Start server (production): `npm start` (runs `node server/app.js`)
- Run quick DB + app checks: `node test_cbs.js` and `node test_customers.js`
- Initialize database: `mysql -u <user> -p < sql/database_schema.sql` (runs schema + seeds)

Architecture overview

- `server/app.js`: central Express app that mounts routers under `/api/*`, serves `public/`, and exposes `/health`.
- `server/db.js`: exports a `mysql2/promise` connection pool. Uses env vars `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` with sensible defaults.
- Router pattern: `server/routes/*.js` map to controllers in `server/controllers/*.js`.
  - `customers` -> `customerController.js`
  - `accounts` -> `accountController.js`
  - `transactions` -> `transactionController.js`
  - `tcl` -> `tclController.js` (TCL = Transaction Control Language demos)
  - `customerPortal` -> `authController.js` + `customerPortalController.js`

Data model highlights (see `sql/database_schema.sql`)

- Tables: `UserAccount`, `Customer`, `Branch`, `Account`, `TransactionLog`, `AuditLog`.
- Important constraints: `Account.customerid -> Customer`, `Account.branchid -> Branch`, `TransactionLog.accountno -> Account`, `TransactionLog.reference_account -> Account`, `AuditLog.userid -> UserAccount`.
- Seed data present for quick local testing.

Project-specific patterns and conventions

- Explicit transaction control: controllers use `pool.getConnection()` + `conn.beginTransaction()` / `conn.commit()` / `conn.rollback()` patterns. Always `conn.release()` in `finally`.
- FOR UPDATE locking: when updating balances, controllers use `SELECT ... FOR UPDATE` to lock rows.
- Savepoint demos: `tclController` contains multiple examples demonstrating `SAVEPOINT` and partial rollbacks — copy these patterns when implementing new batch operations.
- Audit logging: after state-changing operations, controllers insert rows into `AuditLog` (userid, action, description). Use this for traceability.
- Error handling: controllers typically log to console and return 500 with `err.message`. Duplicate-entry errors (`ER_DUP_ENTRY`) are handled in a few places.

Auth and session

- Customer login is a debug implementation (`authController.customerLogin`) that returns a `cust_<id>_<timestamp>` token. Use `authController.verifyCustomer` middleware to protect routes in `server/routes/customerPortal.js`.
- No production JWT or password hashing flow for customers; `UserAccount` table exists for staff accounts with hashed passwords, but no login flow implemented for staff in this repo.

Testing and debugging tips

- Local DB defaults: user=`root`, password=`root`, host=`127.0.0.1`, db=`cbs_db`. Override with env vars in `server/db.js`.
- If queries fail, run `node test_cbs.js` to see connection and table checks. Useful troubleshooting hints printed by test scripts.
- To inspect transaction demos, use API endpoints under `/api/tcl/*` (e.g., `/api/tcl/savepoint-demo`, `/api/tcl/nested-transactions`). These endpoints demonstrate partial rollbacks and are a canonical source for correct TCL usage.

Editing guidance for AI agents

- Prefer minimal, targeted changes: follow existing controller patterns for acquiring `conn`, transaction control, and `finally` releasing the connection.
- When adding new DB queries, use parameterized queries (`?` placeholders) and avoid constructing SQL with string concatenation.
- Reuse existing AuditLog and TransactionLog insert patterns for traceability.
- Follow error messages and HTTP statuses used across controllers (400 for validation, 404 for not found, 500 for server errors).

Files to reference when implementing features

- `server/app.js` — app entry and route mounting
- `server/db.js` — DB pool config and env var names
- `server/controllers/*.js` — canonical transaction + audit patterns
- `server/routes/*.js` — endpoint patterns and route-level middleware
- `sql/database_schema.sql` — schema, constraints, and seed data
- `test_cbs.js`, `test_customers.js` — simple test harnesses and startup checks

Do not change

- Do not assume JWT-based auth for customers — `verifyCustomer` expects token format `cust_<id>_<timestamp>`.
- Do not remove savepoint/demo endpoints — they are teaching examples for TCL and used in the UI.

If unsure

- Run `node test_cbs.js` to validate DB connectivity and table presence.
- Ask for clarification if you need a production auth design or staff login flows — this repo uses simplified flows for demo purposes.

---

If you'd like, I can: add short examples for common tasks (e.g., add new transactional endpoint), or open a PR with small fixes. What would you like next?