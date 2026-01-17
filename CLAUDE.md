# Overlap Development Guidelines

## Project Overview

Overlap is a Claude Code plugin + self-hosted Cloudflare service that:
- Tracks what you and your team are working on across Claude Code sessions
- Detects when multiple people are working on overlapping code areas
- Displays a real-time timeline of team activity
- Preserves personal work history across sessions and repos

**Spec Document**: [overlap_spec.md](overlap_spec.md) - Update when implementation differs from design.

## Architecture

| Component | Technology |
|-----------|------------|
| Frontend | Astro 5 + React (islands) |
| Backend | Cloudflare Pages Functions |
| Database | Cloudflare D1 (SQLite) |
| Real-time | Server-Sent Events (SSE) |
| Plugin Scripts | Python 3 |
| LLM Providers | Anthropic, OpenAI, xAI, Google + heuristic fallback |

## Directory Structure

```
overlap/
├── src/
│   ├── pages/              # Astro pages (file-based routing)
│   ├── components/         # React components (islands)
│   ├── layouts/            # Astro layouts
│   └── lib/
│       ├── db/             # D1 database queries & helpers
│       ├── llm/            # LLM provider implementations
│       ├── auth/           # Authentication utilities
│       └── utils/          # Shared utilities
├── functions/
│   └── api/v1/             # Cloudflare Functions (API endpoints)
├── plugin/
│   ├── .claude-plugin/     # Plugin manifest ONLY (plugin.json)
│   ├── hooks/              # hooks.json
│   ├── scripts/            # Python hook scripts
│   └── commands/           # Slash command .md files
├── migrations/             # D1 SQL migrations
├── public/                 # Static assets
└── wrangler.toml           # Cloudflare configuration
```

## Code Conventions

### TypeScript

- Strict mode enabled (`strict: true`)
- Prefer `type` over `interface` for object shapes
- Use Zod for runtime validation of API inputs
- Never use `any` - use `unknown` and narrow with type guards
- Explicit return types on exported functions

```typescript
// Good
type User = {
  id: string;
  name: string;
  email: string | null;
};

// Bad
interface User { ... }
```

### Database (D1)

- Always use prepared statements with `.bind()` - never interpolate values
- Access in API functions: `context.env.DB`
- Access in Astro pages: `Astro.locals.runtime.env.DB`
- Batch related queries with `db.batch()` for performance

```typescript
// Good
const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();

// Bad - SQL injection risk
const user = await db.prepare(`SELECT * FROM users WHERE id = '${userId}'`).first();
```

### API Responses

Consistent JSON shape for all endpoints:

```typescript
// Success
{ data: T }

// Error
{ error: string, message?: string }

// List with pagination
{ data: T[], cursor?: string, hasMore: boolean }
```

Use appropriate HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad request (validation error)
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not found
- `500` - Server error

### LLM Providers

All providers implement the same interface:

```typescript
type ClassificationResult = {
  scope: string;
  summary: string;
};

type LLMProvider = {
  classify(files: string[], context?: string): Promise<ClassificationResult>;
};
```

Provider files in `src/lib/llm/`:
- `anthropic.ts` - Claude models
- `openai.ts` - GPT models
- `xai.ts` - Grok models
- `google.ts` - Gemini models
- `heuristic.ts` - Free path-based fallback
- `index.ts` - Factory function to get provider by name

### Error Handling

```typescript
// API endpoints - wrap in try/catch, return structured errors
export async function onRequestPost(context) {
  try {
    // ... logic
    return Response.json({ data: result });
  } catch (error) {
    console.error('API error:', error);

    if (error instanceof ValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Use custom error classes for known error types
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

### React Components

```typescript
// File naming: PascalCase.tsx
// Component naming: PascalCase
// Props type: ComponentNameProps

type ActivityCardProps = {
  session: Session;
  user: User;
  onSelect?: (sessionId: string) => void;
};

export function ActivityCard({ session, user, onSelect }: ActivityCardProps) {
  // Destructure props at top
  // Event handlers prefixed with "handle"
  const handleClick = () => onSelect?.(session.id);

  return (
    <div className="activity-card" onClick={handleClick}>
      {/* ... */}
    </div>
  );
}
```

Styling approach:
- Use Tailwind CSS for utility classes
- Custom CSS in `src/styles/` for complex components
- Follow Claude Code color palette from spec

### SSE Patterns

```typescript
// Server-side SSE response
export function createSSEStream(controller: ReadableStreamDefaultController) {
  const encoder = new TextEncoder();

  return {
    send(event: string, data: unknown) {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    keepalive() {
      controller.enqueue(encoder.encode(': keepalive\n\n'));
    },
    close() {
      controller.close();
    }
  };
}

// Include id: field for client reconnection
// Send keepalive every 30 seconds
```

## Git Commit Messages

When creating commits, use concise commit messages without the Claude attribution footer. Just write the commit message itself:

```bash
git commit -m "Fix mobile responsive layout for dashboard"
```

Do NOT include:
- "🤖 Generated with Claude Code" footer
- "Co-Authored-By: Claude" lines
```

## Common Commands

```bash
# Install dependencies
npm install

# Local development (with D1 bindings)
npm run dev

# Run D1 migrations locally
wrangler d1 execute overlap-db --local --file=migrations/001_initial.sql

# Run D1 migrations on production
wrangler d1 execute overlap-db --remote --file=migrations/001_initial.sql

# Type checking
npm run typecheck

# Build for production
npm run build

# Deploy to Cloudflare
wrangler pages deploy dist

# Test a hook script manually
echo '{"hook_event_name":"SessionStart","source":"startup","session_id":"test"}' | \
  python3 plugin/scripts/session-start.py
```

## Environment Variables

### Cloudflare Dashboard (Secrets)
- `TEAM_ENCRYPTION_KEY` - AES key for encrypting stored LLM API keys

### Local Development (`.dev.vars`)
```
TEAM_ENCRYPTION_KEY=local-dev-key-32-chars-long!!
```

### D1 Binding
Configure in `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "overlap-db"
database_id = "your-database-id"
```

## Testing Hooks Locally

```bash
# SessionStart
echo '{"hook_event_name":"SessionStart","source":"startup","session_id":"abc123","cwd":"/path/to/project"}' | \
  python3 plugin/scripts/session-start.py

# PreToolUse (conflict check)
echo '{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"src/auth/oauth.ts"}}' | \
  python3 plugin/scripts/conflict-check.py

# PostToolUse (heartbeat)
echo '{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"src/api/users.ts"}}' | \
  python3 plugin/scripts/heartbeat.py
```

## Don't Do

- Don't use `any` type - use `unknown` and narrow
- Don't store raw API keys in D1 - always use `llm_api_key_encrypted`
- Don't use `fetch` for D1 - use the binding API
- Don't put commands/hooks/skills inside `.claude-plugin/` - only `plugin.json` goes there
- Don't use jq in hook scripts - we use Python for JSON
- Don't add Co-Authored-By or Claude attribution to commits
- Don't create feature branches - commit to main
- Don't interpolate user input into SQL - use prepared statements

## External Documentation

### Cloudflare
- [D1 Documentation](https://developers.cloudflare.com/d1/)
- [Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [Workers Bindings](https://developers.cloudflare.com/pages/functions/bindings/)

### Astro
- [Astro Docs](https://docs.astro.build/)
- [Cloudflare Adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)

### Claude Code
- [Hooks Reference](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Plugins Guide](https://docs.anthropic.com/en/docs/claude-code/plugins)

### LLM APIs
- [Anthropic API](https://docs.anthropic.com/en/api/)
- [OpenAI API](https://platform.openai.com/docs/)
- [Google Gemini](https://ai.google.dev/docs)
- [xAI Grok](https://docs.x.ai/)
