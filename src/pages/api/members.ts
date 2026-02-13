/**
 * GET /api/members - List team members
 * POST /api/members - Create a new member
 *
 * Auth: Web session (admin only)
 */

import type { APIContext } from 'astro';
import { z } from 'zod';
import {
  authenticateWebSession,
  errorResponse,
  successResponse,
  generateId,
  generateToken,
  hashToken,
} from '@lib/auth/middleware';
import { getAllMembers, createMember } from '@lib/db/queries';

// GET /api/members - List all members
export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Require web session auth
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const members = await getAllMembers(db);

  // Don't return token_hash
  return successResponse({
    members: members.map((m) => ({
      user_id: m.user_id,
      display_name: m.display_name,
      email: m.email,
      role: m.role,
      last_active_at: m.last_active_at,
      created_at: m.created_at,
    })),
  });
}

// POST /api/members - Create a new member
const CreateMemberSchema = z.object({
  display_name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'member']).default('member'),
});

export async function POST(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Require web session auth
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Parse request body
  let body: z.infer<typeof CreateMemberSchema>;
  try {
    const json = await context.request.json();
    body = CreateMemberSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
    }
    return errorResponse('Invalid JSON payload', 400);
  }

  // Generate token
  const token = generateToken();
  const tokenHash = await hashToken(token);

  // Create member
  const member = await createMember(db, {
    user_id: generateId(),
    display_name: body.display_name,
    email: body.email,
    token_hash: tokenHash,
    role: body.role,
  });

  // Return member info WITH the raw token (only shown once)
  return successResponse(
    {
      user_id: member.user_id,
      display_name: member.display_name,
      email: member.email,
      role: member.role,
      token, // Only time we return the raw token
      created_at: member.created_at,
    },
    201
  );
}
