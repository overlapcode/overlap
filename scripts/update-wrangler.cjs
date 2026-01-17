#!/usr/bin/env node
// Update wrangler.toml with D1 and KV IDs
// Usage: node scripts/update-wrangler.js <d1_id> <kv_id>

const fs = require('fs');

const d1Id = process.argv[2];
const kvId = process.argv[3];

if (!d1Id || !kvId) {
  console.error('Usage: node update-wrangler.js <d1_id> <kv_id>');
  process.exit(1);
}

let toml = fs.readFileSync('wrangler.toml', 'utf8');

// Add database_id if not present
if (!toml.includes('database_id')) {
  toml = toml.replace(
    /database_name = "overlap-db"/,
    `database_name = "overlap-db"\ndatabase_id = "${d1Id}"`
  );
}

// Add KV id if not present
if (!/\[\[kv_namespaces\]\][^\[]*id = "/.test(toml)) {
  toml = toml.replace(
    /\[\[kv_namespaces\]\]\s*\nbinding = "SESSION"/,
    `[[kv_namespaces]]\nbinding = "SESSION"\nid = "${kvId}"`
  );
}

fs.writeFileSync('wrangler.toml', toml);
console.log('✅ Updated wrangler.toml');
