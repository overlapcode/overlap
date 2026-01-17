---
description: List all team members (admin only)
allowed-tools: Bash(cat:*), Bash(curl:*)
---

# List Team Users (Admin)

Fetch and display all team members. This command requires admin privileges.

## Fetch Users

```bash
# Read config
SERVER_URL=$(cat ~/.overlap/config.json | grep -o '"server_url"[^,]*' | cut -d'"' -f4)
USER_TOKEN=$(cat ~/.overlap/config.json | grep -o '"user_token"[^,]*' | cut -d'"' -f4)
TEAM_TOKEN=$(cat ~/.overlap/config.json | grep -o '"team_token"[^,]*' | cut -d'"' -f4)

# Fetch users (admin endpoint)
curl -s -X GET "${SERVER_URL}/api/v1/admin/users" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}"
```

## Display Format

```
Team Members
============

| Name            | Email                  | Role   | Status   |
|-----------------|------------------------|--------|----------|
| [name]          | [email]                | admin  | active   |
| [name]          | [email]                | member | active   |
| [name]          | -                      | member | inactive |

Total: [count] members ([active_count] active)
```

If the request fails with 403, inform the user that admin access is required.
