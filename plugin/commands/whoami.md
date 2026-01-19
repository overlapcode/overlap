---
description: Show your Overlap user information
allowed-tools: Bash(cat:*), Bash(curl:*)
---

# Who Am I

Fetch and display your Overlap user information.

## Fetch User Info

```bash
# Read config
SERVER_URL=$(cat ~/.claude/overlap/config.json | grep -o '"server_url"[^,]*' | cut -d'"' -f4)
USER_TOKEN=$(cat ~/.claude/overlap/config.json | grep -o '"user_token"[^,]*' | cut -d'"' -f4)
TEAM_TOKEN=$(cat ~/.claude/overlap/config.json | grep -o '"team_token"[^,]*' | cut -d'"' -f4)

# Fetch user info
curl -s -X GET "${SERVER_URL}/api/v1/users/me" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}"
```

## Display Format

```
┌─────────────────────────────────────────
│ Overlap User Info
├─────────────────────────────────────────
│ Name:           [name]
│ Email:          [email or "Not set"]
│ Role:           [admin/member]
│ Team:           [team_name]
│ Active Sessions: [count]
│ Stale Timeout:  [hours] hours
└─────────────────────────────────────────
```

If the user is an admin, mention that they can use `/overlap:admin:*` commands.
