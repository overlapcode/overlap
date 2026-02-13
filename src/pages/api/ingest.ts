/**
 * POST /api/ingest (DEPRECATED - use /api/v1/ingest)
 *
 * Backwards compatibility redirect to v1 endpoint.
 */

import { POST as v1POST } from './v1/ingest';

export const POST = v1POST;
