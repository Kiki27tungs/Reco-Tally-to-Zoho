import { NextRequest, NextResponse } from 'next/server';
import { fetchOpeningBalances } from '@/lib/zoho';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const accessToken = authHeader?.replace('Zoho-oauthtoken ', '')?.replace('Bearer ', '');
  const apiDomain = req.headers.get('x-zoho-api-domain') || undefined;
  const organizationId = req.headers.get('x-zoho-organization-id') || undefined;
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') || undefined;

  if (!accessToken) {
    return NextResponse.json({ error: 'No access token provided' }, { status: 401 });
  }

  try {
    const openingBalances = await fetchOpeningBalances(
      accessToken, 
      apiDomain,
      organizationId || undefined,
      date
    );
    return NextResponse.json(openingBalances);
  } catch (error) {
    console.error('Error in /api/zoho/opening-balances:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch opening balances' }, { status: 500 });
  }
}
