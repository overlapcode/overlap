/**
 * /api/repos (DEPRECATED - use /api/v1/repos)
 *
 * Backwards compatibility redirect to v1 endpoint.
 */

import { GET as v1GET, POST as v1POST, PUT as v1PUT, DELETE as v1DELETE } from './v1/repos';

export const GET = v1GET;
export const POST = v1POST;
export const PUT = v1PUT;
export const DELETE = v1DELETE;
