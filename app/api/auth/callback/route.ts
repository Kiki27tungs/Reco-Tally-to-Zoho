import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state') || 'com'; // Region is passed in state

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  // Use the exact credentials provided by the user
  const clientId = '1000.DTG8FAQWYRYWCMWIKW2VKU7LVRG7PE';
  const clientSecret = '775f2fbc3bdd9a11e1964a97e1c4f83dda8ecd502a';
  
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

  const accountsUrl = state === 'in' ? 'https://accounts.zoho.in' : 
                     state === 'eu' ? 'https://accounts.zoho.eu' :
                     state === 'au' ? 'https://accounts.zoho.com.au' :
                     state === 'jp' ? 'https://accounts.zoho.jp' :
                     'https://accounts.zoho.com';

  try {
    // Exchange code for tokens
    const response = await fetch(`${accountsUrl}/oauth/v2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const data = await response.json();

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 400 });
    }

    // We'll return a script that sends a message to the opener and closes the popup
    return new NextResponse(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', tokens: ${JSON.stringify(data)} }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (err) {
    console.error('OAuth callback error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
