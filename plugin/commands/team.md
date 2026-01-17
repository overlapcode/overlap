---
description: Show current team activity from Overlap
allowed-tools: Bash(cat:*), Bash(curl:*)
---

# Team Activity

Fetch and display the current team activity from Overlap.

## Fetch Activity

```bash
# Read config
SERVER_URL=$(cat ~/.overlap/config.json | grep -o '"server_url"[^,]*' | cut -d'"' -f4)
USER_TOKEN=$(cat ~/.overlap/config.json | grep -o '"user_token"[^,]*' | cut -d'"' -f4)
TEAM_TOKEN=$(cat ~/.overlap/config.json | grep -o '"team_token"[^,]*' | cut -d'"' -f4)

# Fetch team activity
curl -s -X GET "${SERVER_URL}/api/v1/activity?limit=20" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}"
```

## Display Format

For each session in the response, display:

```
┌─────────────────────────────────────────────────────────────────
│ [Name] · [Device] · [STATUS]                          [Time ago]
│
│ ┌──────────────┐
│ │ [scope]      │
│ └──────────────┘
│
│ [Summary of what they're working on]
│
│ Files: [file1.ts] · [file2.ts] · [+N more]
│
│ [branch] · [repo-name]
└─────────────────────────────────────────────────────────────────
```

Status colors:
- ACTIVE (ongoing work)
- STALE (no recent activity)
- ENDED (session closed)

If there are no active sessions, display a friendly message saying the team is quiet.
