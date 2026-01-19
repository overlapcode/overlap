---
description: List all tracked repositories (admin only)
allowed-tools: Bash(cat:*), Bash(curl:*)
---

# List Tracked Repositories (Admin)

Fetch and display all repositories tracked by Overlap. This command requires admin privileges.

## Fetch Repos

```bash
# Read config
SERVER_URL=$(cat ~/.claude/overlap/config.json | grep -o '"server_url"[^,]*' | cut -d'"' -f4)
USER_TOKEN=$(cat ~/.claude/overlap/config.json | grep -o '"user_token"[^,]*' | cut -d'"' -f4)
TEAM_TOKEN=$(cat ~/.claude/overlap/config.json | grep -o '"team_token"[^,]*' | cut -d'"' -f4)

# Fetch repos (admin endpoint)
curl -s -X GET "${SERVER_URL}/api/v1/admin/repos" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}"
```

## Display Format

```
Tracked Repositories
====================

| Repository      | Remote URL                          | Public |
|-----------------|-------------------------------------|--------|
| [name]          | [remote_url]                        | Yes    |
| [name]          | [remote_url]                        | No     |
| [name]          | (local only)                        | No     |

Total: [count] repositories
```

Notes:
- Public repositories are visible without authentication
- Repositories are auto-registered when team members work in them
- Remote URL helps identify the same repo across different local paths

If the request fails with 403, inform the user that admin access is required.
