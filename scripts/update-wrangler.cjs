#!/usr/bin/env node
// Update wrangler.toml with D1 and KV IDs
// Usage: node scripts/update-wrangler.cjs <d1_id> <kv_id>

const fs = require('fs');

const d1Id = process.argv[2];
const kvId = process.argv[3];

if (!d1Id || !kvId) {
  console.error('Usage: node update-wrangler.cjs <d1_id> <kv_id>');
  process.exit(1);
}

let toml = fs.readFileSync('wrangler.toml', 'utf8');
const originalToml = toml;

// Add database_id after database_name line if not present
// Check for actual config line, not comments (which also contain "database_id")
if (!toml.includes('database_id =')) {
  // Split into lines for more reliable manipulation
  const lines = toml.split('\n');
  const newLines = [];

  for (const line of lines) {
    newLines.push(line);
    // Insert database_id after the database_name line
    if (line.includes('database_name') && line.includes('overlap-db')) {
      newLines.push(`database_id = "${d1Id}"`);
    }
  }

  toml = newLines.join('\n');
}

// Add KV id after binding = "SESSION" line if not present
// Check specifically within kv_namespaces section
if (!/\[\[kv_namespaces\]\][^\[]*\nid = "/.test(toml)) {
  const lines = toml.split('\n');
  const newLines = [];

  for (const line of lines) {
    newLines.push(line);
    // Insert id after the binding = "SESSION" line (within kv_namespaces section)
    if (line.includes('binding') && line.includes('SESSION')) {
      newLines.push(`id = "${kvId}"`);
    }
  }

  toml = newLines.join('\n');
}

if (toml === originalToml) {
  console.log('⚠️  No changes needed to wrangler.toml');
} else {
  fs.writeFileSync('wrangler.toml', toml);
  console.log('✅ Updated wrangler.toml');

  // Verify the changes
  const verified = fs.readFileSync('wrangler.toml', 'utf8');
  if (verified.includes(`database_id = "${d1Id}"`)) {
    console.log('   ✓ database_id added');
  } else {
    console.error('   ✗ database_id NOT found after update!');
    process.exit(1);
  }

  if (verified.includes(`id = "${kvId}"`)) {
    console.log('   ✓ kv id added');
  } else {
    console.error('   ✗ kv id NOT found after update!');
    process.exit(1);
  }
}
