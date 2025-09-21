// server.js - OpenSSL RNG + configurable weighted 0-9 digit generator
// Preview at minuteBoundary - 35000ms (i.e., 35 seconds before), reveal at minute boundary (:00)
// Emits preview and reveal via Socket.IO. Includes a public hash for basic auditability
import express from "express";
import http from "http";
import { Server } from "socket.io";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

// === CONFIGURATION ===
// Display name / ID requested
const DISPLAY_NAME = "Jai Shree SHYAM";
const DISPLAY_ID = "ID-001234";

// Weights for digits 0..9 (higher weight -> higher chance)
// You can edit these weights to make some digits rarer or more frequent.
// Example below: digit '7' is rarer (weight 1), '3' has high frequency (weight 20).
// Sum of weights determines probabilities.
let WEIGHTS = [5,5,5,20,5,5,5,1,5,4]; // indexes 0..9

// Server salt used only for public hashing (not secret). This helps tie hash to server instance.
const SERVER_SALT = crypto.randomBytes(8).toString('hex');

// === Helper functions ===
function totalWeight() {
  return WEIGHTS.reduce((a,b)=>a+b,0);
}

function pickWeightedDigit(randBuf) {
  // randBuf: Buffer with at least 8 bytes of randomness
  // map to [0, totalWeight-1] uniformly using BigInt scaling
  const total = BigInt(totalWeight());
  // use first 8 bytes
  const val = BigInt('0x' + randBuf.slice(0,8).toString('hex'));
  const mod = val % total;
  let acc = 0n;
  for (let d = 0; d <= 9; d++) {
    acc += BigInt(WEIGHTS[d]);
    if (mod < acc) return d;
  }
  return 9; // fallback
}

function computePublicHash(randomHex, minuteBoundaryIso) {
  // produce a public hash string clients can use for basic audit
  // combine server salt, randomHex and minuteBoundary
  const h = crypto.createHash('sha256').update(SERVER_SALT + '|' + randomHex + '|' + minuteBoundaryIso + '|' + WEIGHTS.join(',')).digest('hex');
  return h;
}

// === Scheduling ===
// preview at next minute boundary - 35000ms (35 seconds before), reveal at minute boundary
function msUntilNextPreview() {
  const now = Date.now();
  const nextMinute = Math.ceil(now/60000)*60000;
  const previewTime = nextMinute - 35000; // 35s before
  return previewTime - now;
}

let upcoming = { minuteBoundary: null, digit: null, hash: null, provider: "openssl", randomHex: null };

async function scheduleLoop() {
  try {
    const ms = msUntilNextPreview();
    const wait = Math.max(0, ms);
    console.log('Scheduling next preview in', wait, 'ms');
    setTimeout(async () => {
      const nextMinuteBoundary = Math.ceil(Date.now()/60000)*60000;
      const minuteBoundaryIso = new Date(nextMinuteBoundary).toISOString();

      // generate strong randomness once per round using OpenSSL (Node crypto)
      const randomBuf = crypto.randomBytes(16); // 128 bits
      const randomHex = randomBuf.toString('hex');

      // pick weighted digit deterministically from the randomBuf for this round
      const digit = pickWeightedDigit(randomBuf);

      // compute public hash for audit (includes weights and server salt)
      const hash = computePublicHash(randomHex, minuteBoundaryIso);

      upcoming = { minuteBoundary: minuteBoundaryIso, digit, hash, provider: 'openssl', randomHex };

      // emit preview at preview time (we're at preview time now because setTimeout waited until preview)
      io.emit('preview', { minuteBoundary: upcoming.minuteBoundary, previewAt: new Date(nextMinuteBoundary - 35000).toISOString(), digit: upcoming.digit, provider: upcoming.provider, hash: upcoming.hash });
      console.log('Preview emitted', upcoming);

      // schedule reveal at minute boundary
      const delayToReveal = nextMinuteBoundary - Date.now();
      setTimeout(() => {
        io.emit('reveal', { minuteBoundary: upcoming.minuteBoundary, revealAt: new Date(nextMinuteBoundary).toISOString(), digit: upcoming.digit, provider: upcoming.provider, hash: upcoming.hash });
        console.log('Reveal emitted', upcoming);
      }, Math.max(0, delayToReveal));

      // loop
      scheduleLoop();
    }, wait + 10);
  } catch (err) {
    console.error('scheduleLoop error', err);
    setTimeout(scheduleLoop, 5000);
  }
}

io.on('connection', (socket) => {
  console.log('Client connected', socket.id);
  // send current upcoming state so new clients see preview if active
  socket.emit('state', { upcoming, displayName: DISPLAY_NAME, displayId: DISPLAY_ID, weights: WEIGHTS });
  socket.on('disconnect', ()=> console.log('Client disconnected', socket.id));
});

// Simple admin endpoints (optional) - you can use these to view/update weights via HTTP requests
app.get('/api/state', (req, res) => res.json({ upcoming, displayName: DISPLAY_NAME, displayId: DISPLAY_ID, weights: WEIGHTS }));
app.post('/api/weights', express.json(), (req, res) => {
  const body = req.body;
  if (!Array.isArray(body.weights) || body.weights.length !== 10) return res.status(400).json({ error: 'weights must be array of 10 numbers' });
  WEIGHTS = body.weights.map(n => Math.max(0, Number(n) || 0));
  return res.json({ ok: true, weights: WEIGHTS });
});

// start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port', PORT);
  scheduleLoop();
});
