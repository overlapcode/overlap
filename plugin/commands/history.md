---
description: Show your personal activity history from Overlap
argument-hint: [days]
allowed-tools: Bash(cat:*), Bash(curl:*)
---

# Personal History

Fetch and display your personal activity history from Overlap.

The optional argument specifies how many days of history to show (default: 7).

Days to show: $ARGUMENTS (use 7 if not specified)

## Fetch History

```bash
# Read config
SERVER_URL=$(cat ~/.claude/overlap/config.json | grep -o '"server_url"[^,]*' | cut -d'"' -f4)
USER_TOKEN=$(cat ~/.claude/overlap/config.json | grep -o '"user_token"[^,]*' | cut -d'"' -f4)
TEAM_TOKEN=$(cat ~/.claude/overlap/config.json | grep -o '"team_token"[^,]*' | cut -d'"' -f4)

# Fetch personal timeline
curl -s -X GET "${SERVER_URL}/api/v1/users/me/timeline?limit=50" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}"
```

## Display Format

Group sessions by date and display:

```
## [Date]

### [Time] - [Repo Name] ([Branch])
[Summary]
Files: [file list]
Duration: [X hours/minutes]

### [Time] - [Repo Name] ([Branch])
[Summary]
Files: [file list]
Duration: [X hours/minutes]

---

## [Previous Date]
...
```

Include a summary at the end:
- Total sessions in the period
- Most active repos
- Most common work areas (by semantic scope)
