"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET ||
  "dev-secret-change-me-" + require("crypto").randomBytes(16).toString("hex");
const DATA_FILE = path.join(__dirname, "data", "db.json");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ------------------------------------------------------------------
// data layer — a small JSON file, atomic writes, in-memory cache
// ------------------------------------------------------------------
function emptyDb() {
  return { users: {}, entries: {}, goals: {}, folders: {} };
}
function loadDb() {
  try {
    if (!fs.existsSync(DATA_FILE)) return emptyDb();
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Object.assign(emptyDb(), parsed);
  } catch (e) {
    console.error("failed to read db.json, starting fresh:", e.message);
    return emptyDb();
  }
}
function saveDb() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
let db = loadDb();

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
function sanitizeUser(u) {
  return { name: u.name, email: u.email, createdAt: u.createdAt };
}
function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}
function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function issueToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: "30d" });
}
function authRequired(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "not authenticated" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!db.users[payload.email]) return res.status(401).json({ error: "account no longer exists" });
    req.user = payload;
    next();
  } catch (e) {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

// ------------------------------------------------------------------
// API routes
// ------------------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, users: Object.keys(db.users).length });
});

app.post("/api/signup", async (req, res) => {
  const { name, email, password } = req.body || {};
  const key = normalizeEmail(email);
  if (!name || !key || !password) return res.status(400).json({ error: "name, email and password are required" });
  if (!isEmail(key)) return res.status(400).json({ error: "please enter a valid email" });
  if (password.length < 6) return res.status(400).json({ error: "password must be at least 6 characters" });
  if (db.users[key]) return res.status(409).json({ error: "an account with that email already exists" });
  const passwordHash = await bcrypt.hash(password, 10);
  db.users[key] = { name: String(name).trim(), email: key, passwordHash, createdAt: new Date().toISOString() };
  db.entries[key] = [];
  db.goals[key] = { dailyCap: 10 };
  saveDb();
  res.json({ token: issueToken(key), user: sanitizeUser(db.users[key]) });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  const key = normalizeEmail(email);
  if (!key || !password) return res.status(400).json({ error: "email and password are required" });
  const user = db.users[key];
  if (!user) return res.status(401).json({ error: "no account with that email — sign up first" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "wrong password" });
  res.json({ token: issueToken(key), user: sanitizeUser(user) });
});

app.get("/api/me", authRequired, (req, res) => {
  const email = req.user.email;
  res.json({
    user: sanitizeUser(db.users[email]),
    entries: db.entries[email] || [],
    goal: db.goals[email] || { dailyCap: 10 },
    folders: db.folders[email] || []
  });
});

// ---------------------------- folders ----------------------------
app.get("/api/folders", authRequired, (req, res) => {
  res.json({ folders: db.folders[req.user.email] || [] });
});

app.post("/api/folders", authRequired, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "folder name is required" });
  const email = req.user.email;
  db.folders[email] = db.folders[email] || [];
  const folder = { id: uid(), name: String(name).trim(), createdAt: new Date().toISOString() };
  db.folders[email].push(folder);
  saveDb();
  res.json({ folder });
});

app.patch("/api/folders/:id", authRequired, (req, res) => {
  const email = req.user.email;
  const folder = (db.folders[email] || []).find(function (f) { return f.id === req.params.id; });
  if (!folder) return res.status(404).json({ error: "folder not found" });
  const { name } = req.body || {};
  if (name && String(name).trim()) folder.name = String(name).trim();
  saveDb();
  res.json({ folder });
});

app.delete("/api/folders/:id", authRequired, (req, res) => {
  const email = req.user.email;
  const id = req.params.id;
  const foldersBefore = (db.folders[email] || []).length;
  db.folders[email] = (db.folders[email] || []).filter(function (f) { return f.id !== id; });
  const entriesBefore = (db.entries[email] || []).length;
  db.entries[email] = (db.entries[email] || []).filter(function (e) { return e.folderId !== id; });
  saveDb();
  res.json({
    ok: true,
    foldersRemoved: foldersBefore - db.folders[email].length,
    entriesRemoved: entriesBefore - db.entries[email].length
  });
});

app.patch("/api/me", authRequired, (req, res) => {
  const { name } = req.body || {};
  const user = db.users[req.user.email];
  if (name && String(name).trim()) user.name = String(name).trim();
  saveDb();
  res.json({ user: sanitizeUser(user) });
});

app.delete("/api/me", authRequired, (req, res) => {
  const email = req.user.email;
  delete db.users[email];
  delete db.entries[email];
  delete db.goals[email];
  saveDb();
  res.json({ ok: true });
});

app.post("/api/entries", authRequired, (req, res) => {
  const { date, category, activity, label, qty, unit, co2, folderId, meta } = req.body || {};
  if (!date || !category || !activity || qty === undefined || co2 === undefined) {
    return res.status(400).json({ error: "missing required entry fields" });
  }
  const entry = {
    id: uid(),
    date: String(date),
    category: String(category),
    activity: String(activity),
    label: String(label || activity),
    qty: Number(qty),
    unit: String(unit || ""),
    co2: Number(co2),
    folderId: folderId ? String(folderId) : undefined,
    meta: meta && typeof meta === "object" ? meta : undefined,
    createdAt: new Date().toISOString()
  };
  const email = req.user.email;
  db.entries[email] = db.entries[email] || [];
  db.entries[email].push(entry);
  saveDb();
  res.json({ entry });
});

// Bulk-add — used by the industrial "compound activity" (coal + electricity + transport in one submit)
app.post("/api/entries/bulk", authRequired, (req, res) => {
  const items = Array.isArray(req.body && req.body.entries) ? req.body.entries : null;
  if (!items || !items.length) return res.status(400).json({ error: "entries[] required" });
  const email = req.user.email;
  db.entries[email] = db.entries[email] || [];
  const added = items.map(function (e) {
    const entry = {
      id: uid(),
      date: String(e.date),
      category: String(e.category),
      activity: String(e.activity),
      label: String(e.label || e.activity),
      qty: Number(e.qty),
      unit: String(e.unit || ""),
      co2: Number(e.co2),
      groupId: e.groupId ? String(e.groupId) : undefined,
      createdAt: new Date().toISOString()
    };
    db.entries[email].push(entry);
    return entry;
  });
  saveDb();
  res.json({ entries: added });
});

app.delete("/api/entries/:id", authRequired, (req, res) => {
  const email = req.user.email;
  const before = (db.entries[email] || []).length;
  db.entries[email] = (db.entries[email] || []).filter(function (e) { return e.id !== req.params.id; });
  saveDb();
  res.json({ ok: true, removed: before - db.entries[email].length });
});

app.delete("/api/entries", authRequired, (req, res) => {
  db.entries[req.user.email] = [];
  saveDb();
  res.json({ ok: true });
});

app.put("/api/goal", authRequired, (req, res) => {
  const { dailyCap } = req.body || {};
  const cap = Number(dailyCap);
  if (!cap || cap <= 0) return res.status(400).json({ error: "dailyCap must be a positive number" });
  db.goals[req.user.email] = { dailyCap: cap };
  saveDb();
  res.json({ goal: db.goals[req.user.email] });
});

// ------------------------------------------------------------------
// static frontend
// ------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

app.use(function (err, req, res, next) {
  console.error("server error:", err);
  res.status(500).json({ error: "internal server error" });
});

app.listen(PORT, function () {
  console.log("");
  console.log("  🌿  Carbon Footprint app running");
  console.log("  →  http://localhost:" + PORT);
  console.log("  →  data file: " + DATA_FILE);
  console.log("");
});
