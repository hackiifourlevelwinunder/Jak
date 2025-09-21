OpenSSL Weighted RNG (Render-ready)
----------------------------------
- Uses Node.js crypto.randomBytes (OpenSSL) as source entropy.
- Applies a configurable weighted selection across digits 0-9 so you can make some digits rarer or more frequent.
- Preview is emitted 35 seconds before each minute (:25 second mark), reveal at minute boundary (:00).
- Public hash is emitted for basic audit (hash ties random bytes + minute + weights + server salt).
- Frontend shows India wall clock, preview/reveal, weights, display name and ID.
- To change weights: POST JSON { "weights": [w0,w1,...,w9] } to /api/weights
- Deploy on Render/Replit: npm install, npm start
