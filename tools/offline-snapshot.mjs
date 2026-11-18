// Captures the public website data from a running SCHLUSS server into
// src/offline/sample-data.json, which the double-click offline preview uses.
// Usage: start the server (npm run start:prod), then: node tools/offline-snapshot.mjs [http://localhost:4000]
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4000';
const get = async (path) => {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
};

const site = await get('/api/public/site');
const categories = await get('/api/public/categories');
const productTypes = await get('/api/public/product-types');
const list = await get('/api/public/products?perPage=48&sort=newest');
const popular = (await get('/api/public/products?perPage=48&sort=popular')).data.map((p) => p.slug);
const products = list.data;
const details = {};
for (const p of products) details[p.slug] = await get(`/api/public/products/${encodeURIComponent(p.slug)}`);
const learning = await get('/api/public/learning');
const learningItems = {};
for (const l of learning) learningItems[l.id] = await get(`/api/public/learning/${l.id}`).catch(() => null);

const data = { capturedAt: new Date().toISOString(), site, categories, productTypes, products, popular, details, learning, learningItems };

// Inline public media (logos, screenshots) as data: URIs so the preview needs no server.
const cache = new Map();
async function inline(v) {
  if (typeof v === 'string' && v.startsWith('/api/media/')) {
    if (!cache.has(v)) {
      const r = await fetch(BASE + v);
      cache.set(v, r.ok ? `data:${r.headers.get('content-type') || 'application/octet-stream'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}` : null);
    }
    return cache.get(v);
  }
  if (Array.isArray(v)) return Promise.all(v.map(inline));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = await inline(x);
    return o;
  }
  return v;
}
const out = await inline(data);
writeFileSync(new URL('../src/offline/sample-data.json', import.meta.url), JSON.stringify(out));
console.log(`Saved ${products.length} products, ${categories.length} categories, ${learning.length} learning items, ${cache.size} media files.`);
