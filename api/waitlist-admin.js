// /api/waitlist-admin (Authorization: Bearer <STATS_TOKEN>, the same token as the usage numbers): the signups list behind
// /admin.html, for welcoming people by hand in manual mode (see _waitlist.js).
//   GET                                   { signups: [{ email, at, welcomed, welcomedAt, unsubscribe }] }, newest first;
//                                         `unsubscribe` is the address's signed link, to paste into the welcome email
//   POST {action: "welcomed", emails: []} marks those signups as welcomed
//   POST {action: "remove", emails: []}   removes an address on request: deletes every record of it and leaves the
//                                         unsubscribed fingerprint, exactly as its unsubscribe link would
const { timingSafeEqual } = require("node:crypto");
const { blobAuth, listAll, putJson, findOne, deleteAll, getJson } = require("./_blob");
const { tokenFor } = require("./_unsubscribe");
const { signupPath, unsubscribedPath, allPaths } = require("./_waitlist");

const SITE = process.env.SITE_URL || "https://brainstorm-landing.vercel.app";
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const unsubscribeLink = (email, secret) => `${SITE}/unsubscribe.html?${new URLSearchParams({ e: email, t: tokenFor(email, secret) })}`;

/** Run `fn` over `items`, 10 at a time. */
async function each(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += 10) out.push(...await Promise.all(items.slice(i, i + 10).map(fn)));
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const want = process.env.STATS_TOKEN;
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!want || !given || !same(given, want)) return res.status(401).json({ error: "Wrong or missing token." });
  const auth = blobAuth(req), secret = process.env.UNSUBSCRIBE_SECRET;
  if (!auth || !secret) return res.status(503).json({ error: "The list isn't connected (Blob store or UNSUBSCRIBE_SECRET)." });

  try {
    if (req.method === "GET") {
      const blobs = await listAll(auth, "waitlist/signups/");
      const signups = await each(blobs, async (b) => {
        const email = b.pathname.replace(/^waitlist\/signups\//, "").replace(/\.json$/, "");
        const rec = (await getJson(auth, b.url)) || {};
        return { email, at: rec.at || b.uploadedAt, welcomed: !!rec.welcomed, welcomedAt: rec.welcomedAt || null, unsubscribe: unsubscribeLink(email, secret) };
      });
      signups.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return res.status(200).json({ signups });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return res.status(415).json({ error: "JSON only." });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const emails = Array.isArray(body.emails) ? [...new Set(body.emails.map((e) => String(e).trim().toLowerCase()).filter((e) => e && e.length <= 254 && !e.includes("/")))] : [];
    if (!emails.length || emails.length > 1000) return res.status(400).json({ error: "No addresses given." });

    if (body.action === "welcomed") {
      const now = new Date().toISOString();
      const done = await each(emails, async (email) => {
        const b = await findOne(auth, signupPath(email));
        if (!b) return 0;
        const rec = (await getJson(auth, b.url)) || { email, at: b.uploadedAt };
        if (!rec.welcomed) await putJson(auth, signupPath(email), { ...rec, welcomed: true, welcomedAt: now });
        return 1;
      });
      return res.status(200).json({ ok: true, marked: done.reduce((a, b) => a + b, 0) });
    }
    if (body.action === "remove") {
      await each(emails, async (email) => {
        await putJson(auth, unsubscribedPath(email, secret), { at: new Date().toISOString() }); // the marker first, as in unsubscribe.js
        const found = (await Promise.all(allPaths(email).map((p) => findOne(auth, p)))).filter(Boolean);
        await deleteAll(auth, found.map((b) => b.url));
      });
      return res.status(200).json({ ok: true, removed: emails.length });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    console.error("waitlist-admin:", e.message); // never an address
    return res.status(502).json({ error: "Couldn't reach the list right now." });
  }
};
