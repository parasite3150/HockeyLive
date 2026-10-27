// Goal alerts for favourite teams (web push).
//   GET  /api/push?action=key          the public key phones subscribe with
//   POST /api/push?action=subscribe    { subscription, favourites: { fih: [...], hi: [...], ... } }
//   POST /api/push?action=unsubscribe  { endpoint }
//   GET  /api/push?action=check        look for kick-offs, goals and full times; send alerts
//                                      (called once a minute by an external timer, e.g. cron-job.org)
import crypto from "node:crypto";
import webpush from "web-push";
import { DOMParser } from "linkedom";
import * as P from "../public/parse.js";
import { SITES, USER_AGENT, appId } from "./_sites.js";
import { redis, getJSON, setJSON, storeReady } from "./_store.js";

const MAX_SUBSCRIPTIONS = 5000;
const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "https://hockeylive.vercel.app";

export default async function handler(req, res) {
  if (!storeReady) {
    res.status(503).json({ error: "Goal alerts aren't set up on the server yet." });
    return;
  }
  try {
    const action = req.query.action;
    if (action === "key") return res.json({ publicKey: (await vapidKeys()).publicKey });
    if (action === "subscribe" && req.method === "POST") return res.json(await subscribe(req.body));
    if (action === "unsubscribe" && req.method === "POST") return res.json(await unsubscribe(req.body));
    if (action === "check") return res.json(await check());
    res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ---------------------------------------------------------------- Keys and subscriptions

/** The push keys are created once and kept in storage, so nothing secret needs configuring. */
async function vapidKeys() {
  let keys = await getJSON("push:vapid");
  if (!keys) {
    await redis("SET", "push:vapid", JSON.stringify(webpush.generateVAPIDKeys()), "NX");
    keys = await getJSON("push:vapid");
  }
  return keys;
}

const subscriptionId = (endpoint) => crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 24);
const cleanCodes = (list) =>
  (Array.isArray(list) ? list : []).filter((c) => typeof c === "string" && /^[A-Za-z0-9]{2,6}$/.test(c)).slice(0, 30);

async function subscribe(body) {
  const sub = body?.subscription;
  if (!sub?.endpoint?.startsWith("https://") || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error("Bad subscription.");
  const id = subscriptionId(sub.endpoint);
  const known = await redis("SISMEMBER", "push:subs", id);
  if (!known && (await redis("SCARD", "push:subs")) >= MAX_SUBSCRIPTIONS) throw new Error("Too many subscriptions.");
  await setJSON(`push:sub:${id}`, {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    favourites: Object.fromEntries(Object.keys(SITES).map((k) => [k, cleanCodes(body.favourites?.[k])]).filter(([, list]) => list.length)),
  });
  await redis("SADD", "push:subs", id);
  return { ok: true };
}

async function unsubscribe(body) {
  if (typeof body?.endpoint !== "string") throw new Error("Bad request.");
  const id = subscriptionId(body.endpoint);
  await redis("DEL", `push:sub:${id}`);
  await redis("SREM", "push:subs", id);
  return { ok: true };
}

// ---------------------------------------------------------------- Checking matches

const doc = (html) => new DOMParser().parseFromString(html, "text/html");
async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.text();
}

async function check() {
  // At most one check every 50 seconds, however often this is called.
  if (!(await redis("SET", "push:lock", "1", "NX", "EX", "50"))) return { skipped: "ran recently" };

  const ids = (await redis("SMEMBERS", "push:subs")) ?? [];
  const subs = (await Promise.all(ids.map((id) => getJSON(`push:sub:${id}`).then((s) => s && { id, ...s })))).filter(Boolean);
  const sent = [];

  for (const [key, site] of Object.entries(SITES)) {
    const wanted = new Set(subs.flatMap((s) => s.favourites?.[key] ?? []));
    if (!wanted.size) continue;
    try { await checkSite(key, site, subs, wanted, sent); } catch { /* one site being down shouldn't stop the others */ }
  }
  return { ok: true, subscribers: subs.length, sent: sent.length };
}

async function checkSite(key, site, subs, wanted, sent) {
  const { tournaments } = P.parseCatalog(doc(await get(`${site.base}/competitions?view=all&page=1`)));
  const today = new Date().toISOString().slice(0, 10);
  const running = tournaments.filter((t) => t.startKey <= addDays(today, 1) && t.endKey >= addDays(today, -1));

  for (const t of running) {
    const matches = P.parseMatchListing(doc(await get(`${site.base}/competitions/${t.id}/matches`)), t.id);
    const now = Date.now();
    for (const m of matches) {
      if (!wanted.has(m.home) && !wanted.has(m.away)) continue;
      if (m.start.getTime() > now + 3600e3 || m.start.getTime() < now - 6 * 3600e3) continue;   // only around kick-off

      const stateKey = `push:match:${key}:${m.id}`;
      const before = await getJSON(stateKey);
      const now_ = { state: P.matchState(m.status), h: m.homeScore ?? 0, a: m.awayScore ?? 0 };
      await setJSON(stateKey, now_, 2 * 86400);
      if (!before) continue;   // first time we see it: just remember it

      const alerts = await describeChanges(key, site, t, m, before, now_);
      if (!alerts.length) continue;
      const targets = subs.filter((s) => (s.favourites?.[key] ?? []).some((c) => c === m.home || c === m.away));
      for (const alert of alerts) sent.push(...(await sendAll(targets, alert)));
    }
  }
}

async function describeChanges(key, site, t, m, before, after) {
  const names = await teamNames(key, site, t.id);
  const home = names.get(m.home) ?? m.home, away = names.get(m.away) ?? m.away;
  const score = `${home} ${after.h}–${after.a} ${away}`;
  const url = `${SITE_URL}/#/m/${appId(key, m.id)}`;
  const base = { url, tag: `match-${key}-${m.id}` };
  const alerts = [];

  if (before.state === "upcoming" && after.state === "live") {
    alerts.push({ ...base, title: "Kick-off", body: `${home} v ${away} · ${t.name}` });
  }
  if (after.h + after.a > before.h + before.a && after.state !== "upcoming") {
    // Name the scorer from the match page's goal list.
    let scorer = "";
    try {
      const goals = P.parseMatchPage(doc(await get(`${site.base}/matches/${m.id}`))).goals;
      const last = goals[goals.length - 1];
      if (last) scorer = `${displayName(last.player)} ${last.minute}'${/corner/i.test(last.action) ? " (PC)" : /stroke/i.test(last.action) ? " (PS)" : ""} · `;
    } catch { /* score alone is fine */ }
    alerts.push({ ...base, title: "Goal!", body: `${scorer}${score}` });
  }
  if (before.state !== "finished" && after.state === "finished") {
    alerts.push({ ...base, title: "Full time", body: score });
  }
  return alerts;
}

/** Team names for alerts: country names (FIH) or the tournament's team list (other sites). */
async function teamNames(key, site, tournamentId) {
  if (key === "fih") return { get: (code) => P.countryName(code) };
  const cacheKey = key === "hi" ? `push:names:${tournamentId}` : `push:names:${key}:${tournamentId}`;
  const cached = await getJSON(cacheKey);
  if (cached) return new Map(cached);
  const names = new Map([...P.parseTeamCodes(doc(await get(`${site.base}/competitions/${tournamentId}`)))]
    .map(([code, name]) => [code, P.niceTeamName(name)]));
  await setJSON(cacheKey, [...names], 7 * 86400);
  return names;
}

async function sendAll(targets, alert) {
  const keys = await vapidKeys();
  webpush.setVapidDetails(SITE_URL, keys.publicKey, keys.privateKey);
  const payload = JSON.stringify(alert);
  const done = [];
  await Promise.all(targets.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 900 });
      done.push(s.id);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {   // the phone turned alerts off
        await redis("DEL", `push:sub:${s.id}`);
        await redis("SREM", "push:subs", s.id);
      }
    }
  }));
  return done;
}

// ---------------------------------------------------------------- Small helpers

function addDays(key, n) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "SINGH Harmanpreet" → "Harmanpreet Singh" (same rule as the app's scorer block). */
function displayName(name) {
  const words = name.split(" ").filter(Boolean);
  const isSurname = (w) => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
  const surname = words.filter(isSurname);
  if (!surname.length) return name;
  const lastIdx = words.length - 1 - [...words].reverse().findIndex(isSurname);
  const given = words.slice(lastIdx + 1).filter((w) => !isSurname(w));
  return [...given, surname.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ")].join(" ");
}
