// How the release-email list is kept in the private Blob store (not a function itself):
//   waitlist/pending/<email>.json     asked for, not yet confirmed (deleted after 30 days by api/usage-prune.js)
//   waitlist/confirmed/<email>.json   confirmed from the email's link: the only addresses the release email goes to
//   waitlist/unsubscribed/<hash>.json a one-way fingerprint of an address that unsubscribed, so it isn't re-added
//   waitlist/signups/<email>.json     manual mode (no Resend set up): saved straight away, { email, at, welcomed }. The
//                                     publisher welcomes these by hand from their own address (admin.html), then marks them
// Older single-opt-in records, waitlist/<email>.json, are unconfirmed: see tools/migrate-waitlist.mjs.
const { fingerprint } = require("./_unsubscribe");

const PENDING_DAYS = 30;
const pendingPath = (email) => `waitlist/pending/${email}.json`;
const confirmedPath = (email) => `waitlist/confirmed/${email}.json`;
const legacyPath = (email) => `waitlist/${email}.json`;
const signupPath = (email) => `waitlist/signups/${email}.json`;
const unsubscribedPath = (email, secret) => `waitlist/unsubscribed/${fingerprint(email, secret)}.json`;

/** Resend set up: double opt-in by email. Otherwise manual mode: signups are kept and welcomed by hand. */
const mailReady = () => !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
/** Every record an address can have (unsubscribing or removing deletes them all). */
const allPaths = (email) => [pendingPath(email), confirmedPath(email), signupPath(email), legacyPath(email)];

module.exports = { PENDING_DAYS, pendingPath, confirmedPath, signupPath, legacyPath, unsubscribedPath, mailReady, allPaths };
