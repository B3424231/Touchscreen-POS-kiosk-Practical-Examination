# IT415 Touchscreen POS Kiosk

Campus Store self-service kiosk built with HTML5, CSS3, vanilla JavaScript, Node.js HTTP, and SQLite. All payments are simulations.

## Run

Install **Node.js 24 or later**, open a terminal in this folder, and run:

```powershell
npm start
```

Open **http://localhost:3000**. No `npm install` or frontend build is needed. SQLite is provided by Node's built-in `node:sqlite` module.

The database is created and seeded automatically at `database/pos.db`. The server listens on the local computer only. Stop it with Ctrl+C. Restarting preserves completed transactions. Reloading the browser clears an unfinished order; a new transaction clears the active customer's data. QR and card never collect real money or card data.

To use a different port or a separate practice database:

```powershell
$env:PORT = '3001'
$env:POS_DB_PATH = Join-Path $PWD 'database/practice.db'
npm start
```

## Verification

```powershell
npm run build
npm test
```

`build` verifies source syntax and asset references; there is no bundling step. The automated API tests use isolated temporary SQLite databases and never write into the practice history.

Browser tests require Playwright as a **test-only** tool and an installed Microsoft Edge:

```powershell
npm run test:browser
```

Selecting a product opens a confirmation with **Cancel** and **Add to Order**. Existing cart quantity buttons adjust quantities directly. After updating the source, refresh the browser to load the latest interface.

Additional browser checks use `npm run test:confirmation` for the confirmation dialog and rendering stability, and `npm run test:performance -- current` for comparative scrolling and cart update diagnostics.

In Codex's bundled runtime, set `NODE_PATH` to the Node.js packages path returned by `load_workspace_dependencies` before running the browser script. On another computer, a local `npm install --no-save playwright` provides this optional test tool. It is not needed to run the app. Use `POS_BROWSER_CHANNEL=chrome` to test Chrome instead of Edge. Browser tests create a separate `test-results/<timestamp>/browser.db`, record the 15 instructor results, and save screenshots.

## Files

- `public/index.html`, `public/css/style.css`, `public/js/`: kiosk UI and shared money/cart helpers.
- `public/images/products.svg`: small local illustrations and icons.
- `server/server.js`: static allowlist and three HTTP routes: health, products, payment completion.
- `server/database.js`: schema, seeds, validation, atomic sale storage.
- `database/pos.db`: practice history; amounts are integer centavos.
- `tests/`: money, API, SQLite, and real browser verification.
- `UI_SPEC.md`: redesigned interface and preserved functionality requirements.
- `REPORT.md`: actual development, test, and verification evidence.

Payment values are validated on both the client and server. Product names and prices come from SQLite. The success screen and receipt use the committed sale snapshot. A unique request ID prevents duplicate sales from double submissions or retrying a lost response.
