import { NextRequest, NextResponse } from 'next/server';
import { fetchOrganizations } from '@/lib/zoho';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const accessToken = authHeader?.replace('Zoho-oauthtoken ', '')?.replace('Bearer ', '');
  const apiDomain = req.headers.get('x-zoho-api-domain') || undefined;

  if (!accessToken) {
    return NextResponse.json({ error: 'No access token provided' }, { status: 401 });
  }

  try {
    const organizations = await fetchOrganizations(accessToken, apiDomain);
    return NextResponse.json(organizations);
  } catch (error) {
    console.error('Error in /api/zoho/organizations:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch organizations' }, { status: 500 });
  }
}
