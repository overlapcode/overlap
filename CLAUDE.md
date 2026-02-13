# Overlap Development Guidelines

## Project Overview

Overlap is a **JSONL tracer + self-hosted Cloudflare service** that:
- Tracks what you and your team are working on across Claude Code sessions
- Detects when multiple people are working on overlapping code areas
- Displays a real-time timeline of team activity
- Preserves personal work history across sessions and repos

**Spec Document**: [overlap_spec.md](overlap_spec.md) - Update when implementation differs from design.
**API Documentation**: [docs/API.md](docs/API.md) - Full API reference for tracer development.
**Tracer Spec**: [docs/TRACER_SPEC.md](docs/TRACER_SPEC.md) - Specification for the tracer binary.

## Architecture

| Component | Technology |
|-----------|------------|
| Frontend | Astro 5 + React (islands) |
| Backend | Cloudflare Pages Functions |
| Database | Cloudflare D1 (SQLite) |
| Real-time | Server-Sent Events (SSE) |
| Tracer | Standalone binary (Go/Rust) |
| LLM Providers | Anthropic, OpenAI, xAI, Google + heuristic fallback |

### How It Works

1. **Claude Code** writes JSONL logs to `~/.claude/projects/{hash}/{session}.jsonl`
2. **Tracer binary** (`overlapdev`) parses JSONL and syncs events to server
3. **Server** stores sessions, file operations, prompts in D1
4. **Dashboard** displays real-time team activity timeline

## Directory Structure

```
overlap/
├── src/
│   ├── pages/              # Astro pages (file-based routing)
│   │   ├── api/v1/         # Versioned API endpoints
│   │   └── settings/       # Settings pages
│   ├── components/         # React components (islands)
│   ├── layouts/            # Astro layouts
│   └── lib/
│       ├── db/             # D1 database queries & helpers
│       │   ├── queries.ts  # All database queries
│       │   ├── types.ts    # TypeScript types for DB entities
│       │   └── migrate.ts  # Auto-migration on startup
│       ├── llm/            # LLM provider implementations
│       ├── auth/           # Authentication utilities
│       └── utils/          # Shared utilities
├── migrations/
│   └── 001_initial.sql     # Database schema
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
- Access in API functions: `context.locals.runtime.env.DB`
- Access in Astro pages: `Astro.locals.runtime.env.DB`
- Batch related queries with `db.batch()` for performance

```typescript
// Good
const user = await db.prepare('SELECT * FROM members WHERE user_id = ?').bind(userId).first();

// Bad - SQL injection risk
const user = await db.prepare(`SELECT * FROM members WHERE user_id = '${userId}'`).first();
```

### API Responses

All API endpoints are versioned under `/api/v1/`.

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
export async function POST(context: APIContext) {
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
```

### React Components

```typescript
// File naming: PascalCase.tsx
// Component naming: PascalCase
// Props type: ComponentNameProps

type ActivityCardProps = {
  session: Session;
  member: Member;
  onSelect?: (sessionId: string) => void;
};

export function ActivityCard({ session, member, onSelect }: ActivityCardProps) {
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

When creating commits, use concise commit messages without the Claude attribution footer:

```bash
git commit -m "Fix mobile responsive layout for dashboard"
```

Do NOT include:
- "Generated with Claude Code" footer
- "Co-Authored-By: Claude" lines

## Pre-Commit: Version Bump Check

**Before every commit**, evaluate whether the changes warrant a version bump:

**Bump version (update all 2 locations) when:**
- New features, pages, or API endpoints
- Bug fixes that affect user-facing behavior
- Database schema changes
- Any change that users would want to sync their fork to get

**Skip version bump when:**
- Documentation-only changes (CLAUDE.md, README, comments)
- Dev tooling or config changes that don't affect the deployed product
- Refactors with no user-visible behavior change

When bumping, update both locations in a single commit titled "Bump version to X.Y.Z":
1. `package.json` → `version` field
2. `src/lib/version.ts` → `VERSION` constant

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

# Clean up Cloudflare (delete all resources for fresh deploy)
npx wrangler delete --name overlap          # Delete worker
npx wrangler d1 delete overlap-db -y        # Delete D1 database
npx wrangler kv namespace list              # List KV namespaces to get IDs
npx wrangler kv namespace delete --namespace-id <id>  # Delete each KV namespace
```

## Cloudflare Cleanup

When user says "clean up Cloudflare", delete ALL these resources so they can do a fresh deploy:

1. **Worker**: `npx wrangler delete --name overlap`
2. **D1 Database**: `npx wrangler d1 delete overlap-db -y`
3. **KV Namespaces**: List with `npx wrangler kv namespace list`, then delete each with `npx wrangler kv namespace delete --namespace-id <id>`

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

## Versioning & Updates

### Critical: User Deployments Depend On This Repo

Users deploy Overlap by:
1. Clicking Deploy to Cloudflare button → forks this repo
2. Installing tracer binary (`brew install overlapdev/tap/overlap`)

**When you push to main, users can sync their fork to get updates.** This means:
- Breaking changes can break ALL user deployments
- Database schema changes need migration support
- API changes must be backward compatible (or versioned under `/api/v2/`)

### Version Locations (Keep In Sync)

| File | Location | Purpose |
|------|----------|---------|
| `package.json` | `version` field | NPM version |
| `src/lib/version.ts` | `VERSION` constant | Used by API and footer |

**Always update both when releasing.**

### Database Migrations

The database auto-migrates via `src/lib/db/migrate.ts` using `CREATE TABLE IF NOT EXISTS`.

**Adding new tables:**
1. Add to `migrations/001_initial.sql` (for new deployments)
2. Add to `src/lib/db/migrate.ts` schema string (for auto-migration)
3. Both must match exactly

**Adding columns to existing tables:**
1. Use `ALTER TABLE ... ADD COLUMN` with `IF NOT EXISTS` (SQLite 3.35+)
2. Or use a check-then-alter pattern in migrate.ts
3. New columns MUST have defaults or be nullable

**Never do:**
- Drop tables or columns (breaks existing data)
- Rename tables or columns (breaks existing queries)
- Change column types (data loss risk)

### API Backward Compatibility

**Safe changes:**
- Adding new endpoints
- Adding optional fields to responses
- Adding optional parameters to requests

**Breaking changes (avoid or version):**
- Removing endpoints
- Removing fields from responses
- Changing required parameters
- Changing response structure

If you must make breaking changes, create a new API version (`/api/v2/`).

### Release Checklist

Before pushing significant changes:
1. [ ] Update version in both locations
2. [ ] Test with fresh deployment (new D1 database)
3. [ ] Test upgrade path (existing D1 database)
4. [ ] Update docs/API.md if API changed
5. [ ] Update CHANGELOG.md if exists

### How Users Update

**Cloudflare Service (Dashboard + API):**
1. Go to their fork on GitHub
2. Click "Sync fork" → "Update branch"
3. Cloudflare auto-deploys from the synced fork

**Tracer Binary:**
```bash
brew upgrade overlapdev/tap/overlap
```

## Don't Do

- Don't use `any` type - use `unknown` and narrow
- Don't store raw API keys in D1 - always use `llm_api_key_encrypted`
- Don't use `fetch` for D1 - use the binding API
- Don't add Co-Authored-By or Claude attribution to commits
- Don't create feature branches - commit to main
- Don't interpolate user input into SQL - use prepared statements
- Don't make breaking API changes without versioning (see Versioning section)
- Don't drop or rename database columns/tables
- Don't change version in one place without updating both locations

## External Documentation

### Cloudflare
- [D1 Documentation](https://developers.cloudflare.com/d1/)
- [Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [Workers Bindings](https://developers.cloudflare.com/pages/functions/bindings/)

### Astro
- [Astro Docs](https://docs.astro.build/)
- [Cloudflare Adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)

### Claude Code JSONL Format
- [Hooks Reference](https://docs.anthropic.com/en/docs/claude-code/hooks)
- JSONL files at `~/.claude/projects/{hash}/{session}.jsonl`

### LLM APIs
- [Anthropic API](https://docs.anthropic.com/en/api/)
- [OpenAI API](https://platform.openai.com/docs/)
- [Google Gemini](https://ai.google.dev/docs)
- [xAI Grok](https://docs.x.ai/)
