import { NextRequest, NextResponse } from 'next/server';
import { fetchChartOfAccounts } from '@/lib/zoho';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const accessToken = authHeader?.replace('Zoho-oauthtoken ', '')?.replace('Bearer ', '');
  const apiDomain = req.headers.get('x-zoho-api-domain') || undefined;
  const organizationId = req.headers.get('x-zoho-organization-id') || undefined;

  if (!accessToken) {
    return NextResponse.json({ error: 'No access token provided' }, { status: 401 });
  }

  try {
    const accounts = await fetchChartOfAccounts(accessToken, apiDomain, organizationId);
    return NextResponse.json(accounts);
  } catch (error) {
    console.error('Error in /api/zoho/accounts:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch accounts' }, { status: 500 });
  }
}
