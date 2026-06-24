# SQL Fixer — Offline SQL Compare & Fix

Compare two `.sql` dump files (Local vs Live), find missing tables/rows/schema differences, and download fix SQL — **no live database connection required**.

## Requirements

| Tool | Version |
|------|---------|
| **Node.js** | **20 LTS or newer** (minimum **18.18+**) |
| **npm** | **9+** (ships with Node 20+) |

Check your versions:

```bash
node -v
npm -v
```

## Setup

From the project root (`SQLFixer/`):

```bash
npm install
npm install --prefix server
npm install --prefix client
```

## Run (development)

```bash
npm run dev
```

Then open:

- **App:** http://localhost:5173
- **API:** http://localhost:3847

## Run (production)

```bash
npm run build
npm start
```

Then open **http://localhost:3847** (the server serves the built UI).

## License

MIT
