/**
 * GET /api/auth/verify (DEPRECATED - use /api/v1/auth/verify)
 *
 * Backwards compatibility redirect to v1 endpoint.
 */

import { GET as v1GET } from '../v1/auth/verify';

export const GET = v1GET;
