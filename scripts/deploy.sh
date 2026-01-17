#!/bin/bash
# Deploy script for Cloudflare with D1 and KV bindings
# Uses REST API to find/create resources, then deploys

set -e

# Get API credentials from environment
API_TOKEN="${CLOUDFLARE_API_TOKEN:-$CF_API_TOKEN}"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$CF_ACCOUNT_ID}"

echo "📋 Checking environment..." >&2
echo "   API_TOKEN: ${API_TOKEN:+set}${API_TOKEN:-not set}" >&2
echo "   ACCOUNT_ID: ${ACCOUNT_ID:-not set}" >&2

# Function to find or create D1 database
# Outputs ID to stdout, status to stderr
find_or_create_d1() {
  local DB_NAME="overlap-db"

  echo "🔍 Looking for D1 database '$DB_NAME'..." >&2

  # Try wrangler first
  local D1_LIST=$(npx wrangler d1 list --json 2>/dev/null || echo "[]")
  local D1_ID=$(echo "$D1_LIST" | node -pe "
    try {
      const dbs = JSON.parse(require('fs').readFileSync(0,'utf8'));
      const db = dbs.find(d => d.name === '$DB_NAME');
      db ? db.uuid : '';
    } catch(e) { '' }
  " 2>/dev/null || echo "")

  if [ -n "$D1_ID" ]; then
    echo "✅ Found existing D1 database: $D1_ID" >&2
    echo "$D1_ID"
    return 0
  fi

  # Try REST API if wrangler didn't work
  if [ -n "$API_TOKEN" ] && [ -n "$ACCOUNT_ID" ]; then
    echo "   Trying REST API..." >&2

    # List databases
    local RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/d1/database" \
      -H "Authorization: Bearer $API_TOKEN" \
      -H "Content-Type: application/json")

    D1_ID=$(echo "$RESPONSE" | node -pe "
      try {
        const data = JSON.parse(require('fs').readFileSync(0,'utf8'));
        const db = data.result?.find(d => d.name === '$DB_NAME');
        db ? db.uuid : '';
      } catch(e) { '' }
    " 2>/dev/null || echo "")

    if [ -n "$D1_ID" ]; then
      echo "✅ Found D1 database via API: $D1_ID" >&2
      echo "$D1_ID"
      return 0
    fi

    # Create database if not found
    echo "   Creating D1 database '$DB_NAME'..." >&2
    RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/d1/database" \
      -H "Authorization: Bearer $API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"name\": \"$DB_NAME\"}")

    D1_ID=$(echo "$RESPONSE" | node -pe "
      try {
        const data = JSON.parse(require('fs').readFileSync(0,'utf8'));
        data.result?.uuid || '';
      } catch(e) { '' }
    " 2>/dev/null || echo "")

    if [ -n "$D1_ID" ]; then
      echo "✅ Created D1 database: $D1_ID" >&2
      echo "$D1_ID"
      return 0
    fi
  fi

  echo "❌ Could not find or create D1 database" >&2
  return 1
}

# Function to find or create KV namespace
# Outputs ID to stdout, status to stderr
find_or_create_kv() {
  local KV_NAME="overlap-session"

  echo "🔍 Looking for KV namespace..." >&2

  # Try wrangler first
  local KV_LIST=$(npx wrangler kv:namespace list --json 2>/dev/null || echo "[]")
  local KV_ID=$(echo "$KV_LIST" | node -pe "
    try {
      const ns = JSON.parse(require('fs').readFileSync(0,'utf8'));
      const found = ns.find(n => n.title === '$KV_NAME' || n.title === 'overlap' || n.title.toLowerCase().includes('session'));
      found ? found.id : '';
    } catch(e) { '' }
  " 2>/dev/null || echo "")

  if [ -n "$KV_ID" ]; then
    echo "✅ Found existing KV namespace: $KV_ID" >&2
    echo "$KV_ID"
    return 0
  fi

  # Try REST API if wrangler didn't work
  if [ -n "$API_TOKEN" ] && [ -n "$ACCOUNT_ID" ]; then
    echo "   Trying REST API..." >&2

    # List namespaces
    local RESPONSE=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces" \
      -H "Authorization: Bearer $API_TOKEN" \
      -H "Content-Type: application/json")

    KV_ID=$(echo "$RESPONSE" | node -pe "
      try {
        const data = JSON.parse(require('fs').readFileSync(0,'utf8'));
        const ns = data.result?.find(n => n.title === '$KV_NAME' || n.title === 'overlap' || n.title.toLowerCase().includes('session'));
        ns ? ns.id : '';
      } catch(e) { '' }
    " 2>/dev/null || echo "")

    if [ -n "$KV_ID" ]; then
      echo "✅ Found KV namespace via API: $KV_ID" >&2
      echo "$KV_ID"
      return 0
    fi

    # Create namespace if not found
    echo "   Creating KV namespace '$KV_NAME'..." >&2
    RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces" \
      -H "Authorization: Bearer $API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"title\": \"$KV_NAME\"}")

    KV_ID=$(echo "$RESPONSE" | node -pe "
      try {
        const data = JSON.parse(require('fs').readFileSync(0,'utf8'));
        data.result?.id || '';
      } catch(e) { '' }
    " 2>/dev/null || echo "")

    if [ -n "$KV_ID" ]; then
      echo "✅ Created KV namespace: $KV_ID" >&2
      echo "$KV_ID"
      return 0
    fi
  fi

  echo "❌ Could not find or create KV namespace" >&2
  return 1
}

# Main script
echo "🔧 Overlap Deploy Script" >&2
echo "========================" >&2
echo "" >&2

D1_ID=$(find_or_create_d1)
if [ -z "$D1_ID" ]; then
  echo "" >&2
  echo "💡 To fix this, set these environment variables and retry:" >&2
  echo "   CLOUDFLARE_API_TOKEN=<your-api-token>" >&2
  echo "   CLOUDFLARE_ACCOUNT_ID=<your-account-id>" >&2
  exit 1
fi

echo "" >&2
KV_ID=$(find_or_create_kv)
if [ -z "$KV_ID" ]; then
  echo "" >&2
  echo "💡 To fix this, set these environment variables and retry:" >&2
  echo "   CLOUDFLARE_API_TOKEN=<your-api-token>" >&2
  echo "   CLOUDFLARE_ACCOUNT_ID=<your-account-id>" >&2
  exit 1
fi

echo "" >&2
echo "📝 Updating wrangler.toml with resource IDs..." >&2
echo "   D1_ID: $D1_ID" >&2
echo "   KV_ID: $KV_ID" >&2

# Use external script to avoid escaping issues
node scripts/update-wrangler.js "$D1_ID" "$KV_ID"

echo "" >&2
echo "🚀 Deploying to Cloudflare..." >&2
npx wrangler deploy

echo "" >&2
echo "✅ Deployment complete!" >&2
