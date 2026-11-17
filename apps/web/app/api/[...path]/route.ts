import { forwardApi } from '../../../lib/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => forwardApi(request);
export const POST = GET;
export const DELETE = GET;
