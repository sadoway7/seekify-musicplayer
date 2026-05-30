# Stocklog

Inventory management system for tracking assets, categories, locations, and accounts.

## Running

```bash
./start.sh        # Mac / Linux
start.bat         # Windows
```

Opens a local server at `http://localhost:8297`.

## Tech

- Go backend serving a single-page app
- SQLite database (sql.js, client-side via WASM)
- Vanilla JS, no build step

## Access

Password-protected. Sessions expire after 24 hours.
