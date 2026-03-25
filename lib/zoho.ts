export interface ZohoAccount {
  account_id: string;
  account_name: string;
  account_code: string;
  account_type: string;
  organization_name?: string;
  balance?: number;
}

export interface ZohoTransaction {
  transaction_id?: string;
  date: string;
  account_name: string;
  description: string;
  transaction_type: string;
  transaction_number: string;
  reference_number: string;
  debit_amount: number;
  credit_amount: number;
  amount: number;
}

export interface ZohoAccountReport {
  transactions: ZohoTransaction[];
  summary: {
    opening_balance: number;
    closing_balance: number;
    total_debit: number;
    total_credit: number;
    opening_date: string;
    closing_date: string;
  } | null;
}

async function safeJson(response: Response) {
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  const text = await response.text();
  console.error('[Zoho API] Expected JSON but received:', text.slice(0, 200));
  throw new Error(`Expected JSON response from Zoho but received ${contentType || 'unknown content'}. This often happens when the API URL is incorrect or the session has expired.`);
}

async function getAccessToken(): Promise<string> {
  // 1. Check if we have a valid access token in environment
  const envAccessToken = process.env.ACCESS_TOKEN;
  const envTimestamp = process.env.TOKEN_TIMESTAMP;
  const refreshToken = process.env.REFRESH_TOKEN;
  
  // Use the exact credentials provided by the user
  const clientId = '1000.DTG8FAQWYRYWCMWIKW2VKU7LVRG7PE';
  const clientSecret = '775f2fbc3bdd9a11e1964a97e1c4f83dda8ecd502a';

  if (envAccessToken && envTimestamp) {
    const timestamp = parseInt(envTimestamp);
    const now = Date.now();
    // Zoho tokens usually last 1 hour (3600 seconds)
    if (now < timestamp + 3500 * 1000) {
      return envAccessToken;
    }
  }

  // 2. If not valid or expired, try to refresh using refresh_token
  if (refreshToken) {
    try {
      const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
        }),
      });

      const data = await safeJson(response);
      if (data.access_token) {
        // In a real app, you'd update the environment or a database here.
        // Since we can't update process.env permanently, we just return it.
        return data.access_token;
      }
    } catch (error) {
      console.error('Error refreshing Zoho token:', error);
    }
  }

  throw new Error('No valid Zoho access token available. Please connect your account.');
}

export interface ZohoOrganization {
  organization_id: string;
  name: string;
}

export function getBaseUrl(apiDomain?: string): string {
  if (!apiDomain) return 'https://www.zohoapis.com/books/v3';
  
  // Extract the domain part and normalize it
  let domain = apiDomain.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  
  // Extract the region/TLD (e.g., com, in, eu, com.au, com.cn)
  // We want to find the part after 'zohoapis.' or 'zoho.'
  let region = 'com';
  const zohoMatch = domain.match(/(?:zohoapis|zoho)\.(.+)$/);
  if (zohoMatch && zohoMatch[1]) {
    region = zohoMatch[1];
  } else {
    // Fallback if the above doesn't match
    if (domain.endsWith('.com.au')) {
      region = 'com.au';
    } else if (domain.endsWith('.com.cn')) {
      region = 'com.cn';
    } else {
      const parts = domain.split('.');
      region = parts[parts.length - 1];
    }
  }
  
  // Use the official zohoapis domain format as requested by Zoho error messages
  // https://www.zohoapis.{region}/books/v3 is the standard for Books API
  return `https://www.zohoapis.${region}/books/v3`;
}

export async function fetchOrganizations(accessToken: string, apiDomain?: string): Promise<ZohoOrganization[]> {
  const baseUrl = getBaseUrl(apiDomain);
  const url = `${baseUrl}/organizations`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
      },
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { code: -1, message: 'Invalid JSON response' };
    }

    if (data.code !== 0) {
      if (data.message === 'Invalid URL Passed') {
        // Try with books.zoho. instead of www.zohoapis.
        const altUrl = url.replace('www.zohoapis.', 'books.zoho.');
        if (altUrl !== url) {
          console.log(`[Zoho API] Retrying Organizations with alternative domain:`, altUrl);
          try {
            const altRes = await fetch(altUrl, {
              headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
              },
            });
            const altText = await altRes.text();
            const altData = JSON.parse(altText);
            if (altData.code === 0) {
              return altData.organizations.map((org: any) => ({
                organization_id: org.organization_id,
                name: org.name,
              }));
            }
          } catch (e) {}
        }
      }
      throw new Error(data.message || `Failed to fetch organizations (Code: ${data.code})`);
    }

    return data.organizations.map((org: any) => ({
      organization_id: org.organization_id,
      name: org.name,
    }));
  } catch (error) {
    console.error('[Zoho API] Error (Organizations):', error);
    throw error;
  }
}

export async function fetchChartOfAccounts(accessToken: string, apiDomain?: string, organizationId?: string): Promise<ZohoAccount[]> {
  const baseUrl = getBaseUrl(apiDomain);
  
  let orgId = organizationId;
  let orgName = '';

  if (!orgId) {
    const orgs = await fetchOrganizations(accessToken, apiDomain);
    if (orgs.length === 0) {
      throw new Error('No organizations found for this user');
    }
    const org = orgs[0];
    orgId = org.organization_id;
    orgName = org.name;
  }

  const url = `${baseUrl}/chartofaccounts?organization_id=${orgId}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'X-com-zoho-books-organizationid': orgId!,
      },
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { code: -1, message: 'Invalid JSON response' };
    }

    if (data.code !== 0) {
      if (data.message === 'Invalid URL Passed') {
        const altUrl = url.replace('www.zohoapis.', 'books.zoho.');
        if (altUrl !== url) {
          console.log(`[Zoho API] Retrying ChartOfAccounts with alternative domain:`, altUrl);
          try {
            const altRes = await fetch(altUrl, {
              headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'X-com-zoho-books-organizationid': orgId!,
              },
            });
            const altText = await altRes.text();
            const altData = JSON.parse(altText);
            if (altData.code === 0) {
              data = altData;
            }
          } catch (e) {}
        }
      }
      if (data.code !== 0) {
        throw new Error(data.message || `Failed to fetch chart of accounts (Code: ${data.code})`);
      }
    }

    let accounts = data.chartofaccounts || [];
    
    if (accounts.length === 0) {
      const accUrl = `${baseUrl}/accounts?organization_id=${orgId}`;
      const accResponse = await fetch(accUrl, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'X-com-zoho-books-organizationid': orgId,
        },
      });
      const accData = await safeJson(accResponse);
      if (accData.code === 0) {
        accounts = accData.accounts || [];
      }
    }

    return accounts.map((acc: any) => ({
      account_id: acc.account_id || '',
      account_name: acc.account_name || '',
      account_code: acc.account_code || '',
      account_type: acc.account_type || '',
      organization_name: orgName,
    }));
  } catch (error) {
    console.error('[Zoho API] Error (ChartOfAccounts):', error);
    throw error;
  }
}

export async function fetchAccountDetails(
  accountId: string,
  accessToken: string,
  apiDomain?: string,
  organizationId?: string
): Promise<any> {
  const baseUrl = getBaseUrl(apiDomain);
  let orgId = organizationId;

  if (!orgId) {
    const orgs = await fetchOrganizations(accessToken, apiDomain);
    if (orgs.length === 0) {
      throw new Error('No organizations found for this user');
    }
    orgId = orgs[0].organization_id;
  }

  // Try multiple endpoints as Zoho sometimes categorizes accounts differently
  const endpoints = [
    `${baseUrl}/chartofaccounts/${accountId}?organization_id=${orgId}`,
    `${baseUrl}/accounts/${accountId}?organization_id=${orgId}`,
    `${baseUrl}/bankaccounts/${accountId}?organization_id=${orgId}`
  ];

  let lastError: any = null;

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'X-com-zoho-books-organizationid': orgId!,
        },
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { code: -1, message: 'Invalid JSON response' };
      }

      if (data.code === 0) {
        return data.account || data.bankaccount;
      }

      if (data.code !== 0 && data.message === 'Invalid URL Passed') {
        // Try with books.zoho. instead of www.zohoapis.
        const altUrl = url.replace('www.zohoapis.', 'books.zoho.');
        if (altUrl !== url) {
          console.log(`[Zoho API] Retrying Account Details with alternative domain:`, altUrl);
          try {
            const altRes = await fetch(altUrl, {
              headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'X-com-zoho-books-organizationid': orgId!,
              },
            });
            const altText = await altRes.text();
            const altData = JSON.parse(altText);
            if (altData.code === 0) {
              return altData.account || altData.bankaccount;
            }
          } catch (e) {}
        }
      }
      lastError = data;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || 'Account does not exist.');
}

export async function fetchAccountTransactions(
  accountId: string, 
  accessToken: string,
  apiDomain?: string,
  fromDate?: string,
  toDate?: string,
  organizationId?: string
): Promise<ZohoAccountReport> {
  const baseUrl = getBaseUrl(apiDomain);
  let orgId = organizationId;

  // 1. Fetch account details first to know the type and ensure it exists
  let accountDetails: any = null;
  try {
    if (!orgId) {
      const orgs = await fetchOrganizations(accessToken, apiDomain);
      if (orgs.length > 0) orgId = orgs[0].organization_id;
    }
    if (orgId) {
      accountDetails = await fetchAccountDetails(accountId, accessToken, apiDomain, orgId);
    }
  } catch (e) {
    console.warn('[Zoho API] Could not fetch account details before transactions:', e);
  }

  const isBankOrCard = accountDetails?.account_type === 'bank' || accountDetails?.account_type === 'credit_card';
  
  let data: any = { code: -1 };
  let response;
  let responseText;

  // Helper to call Banking API
  const tryBanking = async () => {
    const params = new URLSearchParams();
    params.append('organization_id', orgId!);
    if (fromDate && fromDate.trim() !== '') params.append('date_start', fromDate);
    if (toDate && toDate.trim() !== '') params.append('date_end', toDate);

    try {
      // Try the more direct bankaccounts/{id}/transactions endpoint first
      const url = `${baseUrl}/bankaccounts/${accountId}/transactions?${params.toString()}`;
      console.log('[Zoho API] Calling Banking API (direct):', url);
      const res = await fetch(url, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'X-com-zoho-books-organizationid': orgId!,
          'Accept': 'application/json'
        },
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        json = { code: -1, message: 'Invalid JSON' };
      }

      // If direct endpoint fails, try the general banktransactions endpoint
      if (json.code !== 0) {
        if (json.message === 'Invalid URL Passed') {
          // Try with books.zoho. instead of www.zohoapis.
          const altUrl = url.replace('www.zohoapis.', 'books.zoho.');
          if (altUrl !== url) {
            console.log(`[Zoho API] Retrying Banking API (direct) with alternative domain:`, altUrl);
            try {
              const altRes = await fetch(altUrl, {
                headers: {
                  'Authorization': `Zoho-oauthtoken ${accessToken}`,
                  'X-com-zoho-books-organizationid': orgId!,
                  'Accept': 'application/json'
                },
              });
              const altText = await altRes.text();
              const altJson = JSON.parse(altText);
              if (altJson.code === 0) {
                return { res: altRes, text: altText, json: altJson };
              }
            } catch (e) {}
          }
        }

        console.log(`[Zoho API] Banking API (direct) failed: ${json.message}. Trying general endpoint...`);
        const generalParams = new URLSearchParams(params);
        generalParams.append('account_id', accountId);
        const generalUrl = `${baseUrl}/banktransactions?${generalParams.toString()}`;
        const generalRes = await fetch(generalUrl, {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'X-com-zoho-books-organizationid': orgId!,
            'Accept': 'application/json'
          },
        });
        const generalText = await generalRes.text();
        let generalJson;
        try {
          generalJson = JSON.parse(generalText);
        } catch (e) {
          generalJson = { code: -1, message: 'Invalid JSON' };
        }

        if (generalJson.code !== 0 && generalJson.message === 'Invalid URL Passed') {
          // Try with books.zoho. instead of www.zohoapis.
          const altGeneralUrl = generalUrl.replace('www.zohoapis.', 'books.zoho.');
          if (altGeneralUrl !== generalUrl) {
            console.log(`[Zoho API] Retrying Banking API (general) with alternative domain:`, altGeneralUrl);
            try {
              const altGeneralRes = await fetch(altGeneralUrl, {
                headers: {
                  'Authorization': `Zoho-oauthtoken ${accessToken}`,
                  'X-com-zoho-books-organizationid': orgId!,
                  'Accept': 'application/json'
                },
              });
              const altGeneralText = await altGeneralRes.text();
              const altGeneralJson = JSON.parse(altGeneralText);
              if (altGeneralJson.code === 0) {
                return { res: altGeneralRes, text: altGeneralText, json: altGeneralJson };
              }
            } catch (e) {}
          }
        }

        return { res: generalRes, text: generalText, json: generalJson };
      }

      return { res, text, json };
    } catch (err) {
      console.error('[Zoho API] Error in tryBanking:', err);
      return { res: null, text: String(err), json: { code: -1, message: String(err) } };
    }
  };

  // Helper to call Report API
  const tryReport = async () => {
    const params = new URLSearchParams();
    params.append('organization_id', orgId!);
    params.append('account_id', accountId);
    if (fromDate && fromDate.trim() !== '') params.append('from_date', fromDate);
    if (toDate && toDate.trim() !== '') params.append('to_date', toDate);

    // Some Zoho environments use accounttransactions (no underscore)
    // Others use account_transactions (with underscore)
    // The correct endpoint for Account Transactions report is often just 'reports/accounttransactions'
    const endpoints = [
      'reports/accounttransactions', 
      'reports/account_transactions', 
      'reports/account_details',
      'accounttransactions',
      'account_transactions',
      `organizations/${orgId}/reports/accounttransactions`,
      `organizations/${orgId}/reports/account_transactions`
    ];
    let lastResult: any = { code: -1, message: 'No endpoint tried' };

    for (const endpoint of endpoints) {
      // Try both account_id and account_ids (some versions use plural)
      const paramVariants = [
        params.toString(),
        params.toString().replace('account_id=', 'account_ids=')
      ];

      for (const queryStr of paramVariants) {
        // Ensure the URL is constructed correctly without double slashes
        const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
        const url = `${cleanBaseUrl}/${cleanEndpoint}?${queryStr}`;
        console.log(`[Zoho API] Calling Report API (${endpoint}):`, url);
        
        try {
          const res = await fetch(url, {
            headers: {
              'Authorization': `Zoho-oauthtoken ${accessToken}`,
              'X-com-zoho-books-organizationid': orgId!,
              'Accept': 'application/json'
            },
          });
          
          const text = await res.text();
          let json;
          try {
            json = JSON.parse(text);
          } catch (e) {
            json = { code: -1, message: 'Invalid JSON response', raw: text };
          }

          if (json.code === 0) {
            console.log(`[Zoho API] Report API (${endpoint}) succeeded!`);
            return { res, text, json };
          }
          
          lastResult = { res, text, json };
          console.log(`[Zoho API] Report API (${endpoint}) failed with code ${json.code}: ${json.message}`);
          if (json.code !== 0 && json.message === 'Invalid URL Passed') {
            // Try with books.zoho. instead of www.zohoapis.
            const altUrl = url.replace('www.zohoapis.', 'books.zoho.');
            if (altUrl !== url) {
              console.log(`[Zoho API] Retrying Report API with alternative domain:`, altUrl);
              try {
                const altRes = await fetch(altUrl, {
                  headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'X-com-zoho-books-organizationid': orgId!,
                    'Accept': 'application/json'
                  },
                });
                const altText = await altRes.text();
                const altJson = JSON.parse(altText);
                if (altJson.code === 0) {
                  return { res: altRes, text: altText, json: altJson };
                }
                console.log(`[Zoho API] Alternative domain also failed: ${altJson.message}`);
              } catch (e) {}
            }

            // Try without organization_id in query string if header is present
            const noOrgParams = new URLSearchParams(queryStr);
            noOrgParams.delete('organization_id');
            const noOrgUrl = `${cleanBaseUrl}/${cleanEndpoint}?${noOrgParams.toString()}`;
            console.log(`[Zoho API] Retrying Report API without org_id in query:`, noOrgUrl);
            
            const noOrgRes = await fetch(noOrgUrl, {
              headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'X-com-zoho-books-organizationid': orgId!,
                'Accept': 'application/json'
              },
            });
            const noOrgText = await noOrgRes.text();
            try {
              const noOrgJson = JSON.parse(noOrgText);
              if (noOrgJson.code === 0) {
                return { res: noOrgRes, text: noOrgText, json: noOrgJson };
              }
              console.log(`[Zoho API] Report API without org_id also failed: ${noOrgJson.message}`);
            } catch (e) {}
          }
        } catch (err) {
          console.error(`[Zoho API] Error calling ${endpoint}:`, err);
          lastResult = { res: null, text: String(err), json: { code: -1, message: String(err) } };
        }
      }
    }

    return lastResult;
  };

  try {
    // Try the most likely API first
    if (isBankOrCard) {
      const result = await tryBanking();
      data = result.json;
      responseText = result.text;
      response = result.res;
      
      if (data.code !== 0) {
        console.log(`[Zoho API] Banking API failed (${data.message}), trying Report API...`);
        const reportResult = await tryReport();
        data = reportResult.json;
        responseText = reportResult.text;
        response = reportResult.res;
      }
    } else {
      const result = await tryReport();
      data = result.json;
      responseText = result.text;
      response = result.res;
      
      if (data.code !== 0) {
        console.log(`[Zoho API] Report API failed (${data.message}), trying Banking API...`);
        const bankingResult = await tryBanking();
        data = bankingResult.json;
        responseText = bankingResult.text;
        response = bankingResult.res;
      }
    }

    if (data.code !== 0) {
      throw new Error(data.message || `Zoho Error ${data.code}`);
    }

    // The banking API returns data in 'banktransactions'
    // The report API returns data in 'report.report_items'
    const rawItems = data.banktransactions || data.report?.report_items || data.account_transactions || data.transactions || [];
    
    console.log(`[Zoho API] Found ${rawItems.length} raw items`);
    if (rawItems.length > 0) {
      console.log(`[Zoho API] Sample raw item:`, JSON.stringify(rawItems[0]).substring(0, 200));
    }
    
    const parseVal = (val: any) => {
      if (val === undefined || val === null) return 0;
      if (typeof val === 'number') return val;
      let s = String(val).trim();
      // Handle parentheses for negative numbers
      const isNegative = (s.startsWith('(') && s.endsWith(')')) || s.startsWith('-');
      if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);
      // Remove currency symbols and non-numeric characters except . and -
      const cleaned = s.replace(/[^\d.-]/g, '');
      const num = parseFloat(cleaned) || 0;
      return isNegative ? -Math.abs(num) : num;
    };

    const findRow = (searchTerms: string[]) => {
      return (data.report?.report_items || []).find((item: any) => {
        const type = (item.transaction_type || '').toLowerCase();
        const name = (item.account_name || '').toLowerCase();
        const desc = (item.description || '').toLowerCase();
        return searchTerms.some(term => {
          const t = term.toLowerCase();
          return type.includes(t) || name.includes(t) || desc.includes(t);
        });
      });
    };

    let summary: ZohoAccountReport['summary'] = null;
    
    // Extract summary if available (usually in report API)
    if (data.report) {
      const openingRow = findRow(['Opening Balance', 'Opening balance']);
      const closingRow = findRow(['Closing Balance', 'Closing balance']);
      const totalRow = findRow(['Total']);
      
      // Try to find summary in report_summary first (more reliable in some Zoho reports)
      const reportSummary = data.report.report_summary || [];
      const openingSummary = reportSummary.find((s: any) => {
        const title = (s.title || '').toLowerCase();
        return title.includes('opening balance');
      });
      const closingSummary = reportSummary.find((s: any) => {
        const title = (s.title || '').toLowerCase();
        return title.includes('closing balance');
      });
      const debitSummary = reportSummary.find((s: any) => {
        const title = (s.title || '').toLowerCase();
        return title.includes('total debit');
      });
      const creditSummary = reportSummary.find((s: any) => {
        const title = (s.title || '').toLowerCase();
        return title.includes('total credit');
      });

      if (openingSummary || closingSummary || debitSummary || creditSummary) {
        summary = {
          opening_balance: openingSummary ? parseVal(openingSummary.value) * (openingSummary.type === 'credit' ? -1 : 1) : 0,
          closing_balance: closingSummary ? parseVal(closingSummary.value) * (closingSummary.type === 'credit' ? -1 : 1) : 0,
          total_debit: debitSummary ? parseVal(debitSummary.value) : 0,
          total_credit: creditSummary ? parseVal(creditSummary.value) : 0,
          opening_date: fromDate || '',
          closing_date: toDate || '',
        };
      } else if (openingRow || closingRow || totalRow) {
        const parseRowVal = (row: any) => {
          // Prioritize actual balance field if available
          if (row.balance !== undefined && row.balance !== null) return parseVal(row.balance);
          if (row.bcy_balance !== undefined && row.bcy_balance !== null) return parseVal(row.bcy_balance);
          
          const d = parseVal(row.debit_amount || row.bcy_debit_amount || row.debit || 0);
          const c = parseVal(row.credit_amount || row.bcy_credit_amount || row.credit || 0);
          return d - c;
        };

        summary = {
          opening_balance: openingRow ? parseRowVal(openingRow) : 0,
          closing_balance: closingRow ? parseRowVal(closingRow) : 0,
          total_debit: totalRow ? parseVal(totalRow.debit_amount || totalRow.bcy_debit_amount || totalRow.debit || 0) : 0,
          total_credit: totalRow ? parseVal(totalRow.credit_amount || totalRow.bcy_credit_amount || totalRow.credit || 0) : 0,
          opening_date: openingRow?.date || '',
          closing_date: closingRow?.date || '',
        };
      }
    }

    const transactions = rawItems
      .filter((item: any) => 
        item && 
        // Keep Opening/Closing balance rows for the main table to match Zoho UI
        // but exclude 'Total' rows
        item.transaction_type !== 'Total' &&
        item.account_name !== 'Total' &&
        item.date !== 'Total'
      )
      .map((tx: any) => {
        // ... (existing mapping logic)
        const rawDebit = tx.debit ?? tx.debit_amount ?? tx.bcy_debit ?? tx.bcy_debit_amount ?? 0;
        const rawCredit = tx.credit ?? tx.credit_amount ?? tx.bcy_credit ?? tx.bcy_credit_amount ?? 0;

        const debit = parseVal(rawDebit);
        const credit = parseVal(rawCredit);
        
        const rawAmount = tx.amount ?? tx.bcy_amount ?? 0;
        let amount = parseVal(rawAmount);
        
        // If we have debit/credit info, use it to ensure the amount has the correct sign (Debit is positive, Credit is negative)
        if (debit !== 0 || credit !== 0) {
          amount = debit - credit;
        }

        let finalDebit = debit;
        let finalCredit = credit;
        if (finalDebit === 0 && finalCredit === 0 && amount !== 0) {
          const type = (tx.transaction_type || tx.type || '').toLowerCase();
          const isAlwaysCredit = type.includes('withdrawal') || type.includes('expense') || type.includes('vendor_payment') || type.includes('bill_payment') || type.includes('check') || type.includes('card_payment');
          const isAlwaysDebit = type.includes('deposit') || type.includes('customer_payment') || type.includes('invoice_payment') || type.includes('sales_receipt');

          if (isAlwaysCredit) {
            finalCredit = Math.abs(amount);
            finalDebit = 0;
          } else if (isAlwaysDebit) {
            finalDebit = Math.abs(amount);
            finalCredit = 0;
          } else if (amount > 0) {
            finalDebit = amount;
          } else {
            finalCredit = Math.abs(amount);
          }
        }

        return {
          transaction_id: tx.transaction_id || tx.banktransaction_id || '',
          date: tx.date || '',
          account_name: tx.account_name || '',
          description: tx.description || tx.memo || tx.payee || '',
          transaction_type: tx.transaction_type || tx.type || '',
          transaction_number: tx.transaction_number || tx.number || tx.invoice_number || tx.bill_number || '',
          reference_number: tx.reference_number || tx.reference || tx.ref_number || '',
          debit_amount: finalDebit,
          credit_amount: finalCredit,
          amount: amount,
        };
      });

    // If summary is still incomplete, try to extract from the transactions list
    if (summary) {
      if (summary.opening_balance === 0) {
        const openingTx = transactions.find((t: any) => t.transaction_type.toLowerCase().includes('opening balance'));
        if (openingTx) {
          summary.opening_balance = openingTx.amount;
          summary.opening_date = openingTx.date;
        }
      }
    }

    return {
      transactions,
      summary
    };
  } catch (error) {
    console.error('[Zoho API] Error (Transactions):', error);
    throw error;
  }
}

export interface ClosingBalance {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  balance: number;
  dr_cr: "Dr" | "Cr" | "Nil";
}

const DEBIT_NORMAL_TYPES = new Set([
  "other_asset",
  "other_current_asset",
  "cash",
  "bank",
  "fixed_asset",
  "accounts_receivable",
  "expense",
  "cost_of_goods_sold",
  "other_expense",
]);

function getDrCr(accountType: string, balance: number): "Dr" | "Cr" | "Nil" {
  if (balance === 0) return "Nil";
  if (DEBIT_NORMAL_TYPES.has(accountType)) {
    return balance > 0 ? "Dr" : "Cr";
  }
  // Credit-normal accounts (liabilities, equity, income)
  return balance > 0 ? "Cr" : "Dr";
}

async function getChartOfAccountsBalances(
  accessToken: string,
  baseUrl: string,
  orgId: string,
  page = 1
): Promise<ClosingBalance[]> {
  const params = new URLSearchParams({
    organization_id: orgId,
    showbalance: 'true',
    per_page: '200',
    page: page.toString(),
  });

  const response = await fetch(`${baseUrl}/chartofaccounts?${params.toString()}`, {
    headers: { 
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'X-com-zoho-books-organizationid': orgId
    },
  });

  const data = await safeJson(response);
  const accounts: any[] = data.chartofaccounts ?? [];

  const results: ClosingBalance[] = accounts.map((acc) => ({
    account_id: acc.account_id,
    account_code: acc.account_code || "",
    account_name: acc.account_name,
    account_type: acc.account_type,
    balance: acc.current_balance,
    dr_cr: getDrCr(acc.account_type, acc.current_balance),
  }));

  if (data.page_context?.has_more_page) {
    const nextPage = await getChartOfAccountsBalances(accessToken, baseUrl, orgId, page + 1);
    return [...results, ...nextPage];
  }

  return results;
}

async function getBankAccountBalances(
  accessToken: string,
  baseUrl: string,
  orgId: string
): Promise<ClosingBalance[]> {
  const params = new URLSearchParams({
    organization_id: orgId,
    per_page: '200',
  });

  const response = await fetch(`${baseUrl}/bankaccounts?${params.toString()}`, {
    headers: { 
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'X-com-zoho-books-organizationid': orgId
    },
  });

  const data = await safeJson(response);
  const accounts: any[] = data.bankaccounts ?? [];

  return accounts.map((acc) => ({
    account_id: acc.account_id,
    account_code: acc.account_code || "",
    account_name: acc.account_name,
    account_type: acc.account_type,
    balance: acc.bcy_balance ?? 0,
    dr_cr: getDrCr(acc.account_type, acc.bcy_balance ?? 0),
  }));
}

/**
 * Fetches all closing balances by combining Chart of Accounts and Bank Accounts.
 * This follows the reference code provided by the user.
 */
export async function fetchAccountBalances(
  accessToken: string,
  apiDomain?: string,
  organizationId?: string
): Promise<ClosingBalance[]> {
  const baseUrl = getBaseUrl(apiDomain);
  let orgId = organizationId;

  if (!orgId) {
    try {
      const orgs = await fetchOrganizations(accessToken, apiDomain);
      if (orgs.length === 0) return [];
      orgId = orgs[0].organization_id;
    } catch (e) {
      return [];
    }
  }

  try {
    const [coaBalances, bankBalances] = await Promise.all([
      getChartOfAccountsBalances(accessToken, baseUrl, orgId!),
      getBankAccountBalances(accessToken, baseUrl, orgId!),
    ]);

    // Deduplicate — bank accounts also appear in CoA, prefer bcy_balance version
    const bankIds = new Set(bankBalances.map((b) => b.account_id));
    const filteredCoA = coaBalances.filter((a) => !bankIds.has(a.account_id));

    return [...filteredCoA, ...bankBalances];
  } catch (error) {
    console.error('[Zoho API] Error (AccountBalances):', error);
    return [];
  }
}

/**
 * Fetches the Opening Balances from Zoho Books settings.
 * As per the provided documentation reference.
 */
export async function fetchOpeningBalances(
  accessToken: string,
  apiDomain?: string,
  organizationId?: string
): Promise<any> {
  const baseUrl = getBaseUrl(apiDomain);
  let orgId = organizationId;

  if (!orgId) {
    try {
      const orgs = await fetchOrganizations(accessToken, apiDomain);
      if (orgs.length === 0) return null;
      orgId = orgs[0].organization_id;
    } catch (e) {
      return null;
    }
  }

  const url = `${baseUrl}/settings/openingbalances?organization_id=${orgId}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'X-com-zoho-books-organizationid': orgId!,
      },
    });

    const data = await safeJson(response);
    if (data.code !== 0) {
      throw new Error(data.message || `Failed to fetch opening balances (Code: ${data.code})`);
    }

    return data.opening_balance;
  } catch (error) {
    console.error('[Zoho API] Error (OpeningBalances):', error);
    return null;
  }
}

