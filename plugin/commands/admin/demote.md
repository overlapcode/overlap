---
description: Demote an admin to regular member (admin only)
argument-hint: [user-name-or-email]
allowed-tools: Bash(cat:*), Bash(curl:*)
---

# Demote Admin to Member

Demote an admin to regular member role. This command requires admin privileges.

User to demote: $ARGUMENTS

## Steps

1. First, list users to find the user ID
2. Then demote the user

## Find User

```bash
# Read config
SERVER_URL=$(cat ~/.claude/overlap/config.json | grep -o '"server_url"[^,]*' | cut -d'"' -f4)
USER_TOKEN=$(cat ~/.claude/overlap/config.json | grep -o '"user_token"[^,]*' | cut -d'"' -f4)
TEAM_TOKEN=$(cat ~/.claude/overlap/config.json | grep -o '"team_token"[^,]*' | cut -d'"' -f4)

# List users to find the one matching the argument
curl -s -X GET "${SERVER_URL}/api/v1/admin/users" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}"
```

## Demote User

Once you have the user ID, demote them:

```bash
curl -s -X PUT "${SERVER_URL}/api/v1/admin/users/[USER_ID]" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"role": "member"}'
```

## Confirm

Display a confirmation message:
```
✓ [Name] has been demoted to member.
```

If the user is already a member, let them know.
If the request fails, show the error message.
Warn if they're demoting themselves (the last admin cannot be demoted).
