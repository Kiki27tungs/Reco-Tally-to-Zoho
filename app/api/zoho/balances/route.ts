import { NextRequest, NextResponse } from 'next/server';
import { fetchAccountBalances } from '@/lib/zoho';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');
  const authHeader = req.headers.get('Authorization');
  const accessToken = authHeader?.replace('Zoho-oauthtoken ', '')?.replace('Bearer ', '');
  const apiDomain = req.headers.get('x-zoho-api-domain') || undefined;
  const organizationId = req.headers.get('x-zoho-organization-id') || undefined;

  if (!accessToken) {
    return NextResponse.json({ error: 'No access token provided' }, { status: 401 });
  }

  try {
    const balances = await fetchAccountBalances(
      accessToken, 
      apiDomain,
      organizationId || undefined
    );
    return NextResponse.json(balances);
  } catch (error) {
    console.error('Error in /api/zoho/balances:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch balances' }, { status: 500 });
  }
}
