---
description: Show current Overlap session status and connection info
allowed-tools: Bash(cat:*), Bash(curl:*)
---

# Overlap Status

Check the current Overlap session status by:

1. Reading the configuration from `~/.overlap/config.json`
2. Reading the current session from `~/.overlap/session.json` (if exists)
3. Testing the connection to the server

## Check Configuration

First, check if the plugin is configured:

```bash
cat ~/.overlap/config.json 2>/dev/null || echo "Not configured"
```

## Check Current Session

Check if there's an active session:

```bash
cat ~/.overlap/session.json 2>/dev/null || echo "No active session"
```

## Test Connection

If configured, test the connection by fetching user info:

```bash
# Read config
SERVER_URL=$(cat ~/.overlap/config.json | grep -o '"server_url"[^,]*' | cut -d'"' -f4)
USER_TOKEN=$(cat ~/.overlap/config.json | grep -o '"user_token"[^,]*' | cut -d'"' -f4)
TEAM_TOKEN=$(cat ~/.overlap/config.json | grep -o '"team_token"[^,]*' | cut -d'"' -f4)

# Test connection
curl -s -X GET "${SERVER_URL}/api/v1/users/me" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}"
```

## Report Status

Summarize:
- Whether the plugin is configured
- The server URL being used
- Whether there's an active session
- Connection status (connected/disconnected)
- User info if connected
