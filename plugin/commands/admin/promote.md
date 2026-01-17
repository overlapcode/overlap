---
description: Promote a team member to admin (admin only)
argument-hint: [user-name-or-email]
allowed-tools: Bash(cat:*), Bash(curl:*)
---

# Promote User to Admin

Promote a team member to admin role. This command requires admin privileges.

User to promote: $ARGUMENTS

## Steps

1. First, list users to find the user ID
2. Then promote the user

## Find User

```bash
# Read config
SERVER_URL=$(cat ~/.overlap/config.json | grep -o '"server_url"[^,]*' | cut -d'"' -f4)
USER_TOKEN=$(cat ~/.overlap/config.json | grep -o '"user_token"[^,]*' | cut -d'"' -f4)
TEAM_TOKEN=$(cat ~/.overlap/config.json | grep -o '"team_token"[^,]*' | cut -d'"' -f4)

# List users to find the one matching the argument
curl -s -X GET "${SERVER_URL}/api/v1/admin/users" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}"
```

## Promote User

Once you have the user ID, promote them:

```bash
curl -s -X PUT "${SERVER_URL}/api/v1/admin/users/[USER_ID]" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}'
```

## Confirm

Display a confirmation message:
```
✓ [Name] has been promoted to admin.
```

If the user is already an admin, let them know.
If the request fails, show the error message.
