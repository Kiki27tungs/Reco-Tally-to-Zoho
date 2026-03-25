import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const region = searchParams.get('region') || 'com';
  
  // Use the exact credentials provided by the user
  const clientId = '1000.DTG8FAQWYRYWCMWIKW2VKU7LVRG7PE';
  let baseUrl = process.env.APP_URL || '';
  if (!baseUrl && req.headers.get('host')) {
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    baseUrl = `${protocol}://${req.headers.get('host')}`;
  }
  // Remove trailing slash if present
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const redirectUri = `${baseUrl}/api/auth/callback`;

  // Zoho OAuth 2.0 Authorize URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'ZohoBooks.fullaccess.ALL ZohoBooks.accountants.ALL ZohoBooks.banking.READ ZohoBooks.reports.READ',
    state: region, // Pass region in state
    access_type: 'offline',
    prompt: 'consent'
  });

  const accountsUrl = region === 'in' ? 'https://accounts.zoho.in' : 
                     region === 'eu' ? 'https://accounts.zoho.eu' :
                     region === 'au' ? 'https://accounts.zoho.com.au' :
                     region === 'jp' ? 'https://accounts.zoho.jp' :
                     'https://accounts.zoho.com';

  const authUrl = `${accountsUrl}/oauth/v2/auth?${params.toString()}`;

  return NextResponse.json({ url: authUrl });
}
