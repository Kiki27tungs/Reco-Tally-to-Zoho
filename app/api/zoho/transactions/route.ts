import { NextRequest, NextResponse } from 'next/server';
import { fetchAccountTransactions } from '@/lib/zoho';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId');
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');
  const authHeader = req.headers.get('Authorization');
  const accessToken = authHeader?.replace('Zoho-oauthtoken ', '')?.replace('Bearer ', '');
  const apiDomain = req.headers.get('x-zoho-api-domain') || undefined;
  const organizationId = req.headers.get('x-zoho-organization-id') || undefined;

  if (!accessToken) {
    return NextResponse.json({ error: 'No access token provided' }, { status: 401 });
  }

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  }

  try {
    const transactions = await fetchAccountTransactions(
      accountId, 
      accessToken, 
      apiDomain,
      fromDate || undefined, 
      toDate || undefined,
      organizationId
    );
    return NextResponse.json(transactions);
  } catch (error) {
    console.error('Error in /api/zoho/transactions:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch transactions' }, { status: 500 });
  }
}
