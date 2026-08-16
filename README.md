# Carbon Footprint App — Full Stack

Full-stack version of the Carbon Footprint tracker. Accounts and activity data live on the server (JSON file), so users can log in from any device and pick up where they left off.

## Stack

- **Backend:** Node.js + Express
- **Auth:** bcryptjs (password hashing) + JSON Web Tokens (30-day sessions)
- **Storage:** JSON file at `data/db.json` (atomic writes; auto-created on first run)
- **Frontend:** Vanilla HTML/CSS/JS — no framework, no build step

## Run locally

```bash
npm install
npm start
```

The app is served at **http://localhost:3000** — the frontend and API run on the same port.

## API

| Method | Path                   | Auth | Description                           |
|--------|------------------------|------|---------------------------------------|
| POST   | `/api/signup`          | —    | Create account, returns JWT           |
| POST   | `/api/login`           | —    | Log in, returns JWT                   |
| GET    | `/api/me`              | Yes  | Current user + entries + goal         |
| PATCH  | `/api/me`              | Yes  | Update profile (name)                 |
| DELETE | `/api/me`              | Yes  | Delete account and all data           |
| POST   | `/api/entries`         | Yes  | Add one activity entry                |
| POST   | `/api/entries/bulk`    | Yes  | Add many entries at once              |
| DELETE | `/api/entries/:id`     | Yes  | Delete one entry                      |
| DELETE | `/api/entries`         | Yes  | Delete all entries                    |
| PUT    | `/api/goal`            | Yes  | Set daily CO₂e cap                    |
| GET    | `/api/health`          | —    | Health check                          |

Auth header: `Authorization: Bearer <token>`

## Configuration

Environment variables (optional):

- `PORT` — default `3000`
- `JWT_SECRET` — generated per-run if not set. **Set this to a fixed value in production**, otherwise all sessions invalidate on server restart.

## Deployment

Any Node host works — Render, Railway, Fly.io, VPS. Just make sure `data/db.json` is on a persistent disk (Render free tier and Railway both give you this).

For production, set `JWT_SECRET` to a stable random string and consider swapping the JSON file for PostgreSQL / SQLite.
