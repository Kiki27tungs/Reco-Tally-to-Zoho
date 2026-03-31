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
  
  // Normalize the apiDomain
  let domain = apiDomain.toLowerCase().trim();
  if (!domain.startsWith('http')) {
    domain = 'https://' + domain;
  }
  
  // Remove trailing slashes
  domain = domain.replace(/\/+$/, '');
  
  // If it's already a full Books API URL, return it
  if (domain.includes('/books/v3') || domain.includes('/api/v3')) {
    return domain;
  }

  // Extract the host part
  const host = domain.replace(/^https?:\/\//, '').split('/')[0];
  
  // Handle base zoho domains (e.g. zoho.com -> zohoapis.com)
  const regions = ['com', 'in', 'eu', 'com.au', 'jp', 'ca', 'uk'];
  for (const r of regions) {
    if (host === `zoho.${r}`) {
      return `https://www.zohoapis.${r}/books/v3`;
    }
  }
  
  // If it's a zohoapis domain, use /books/v3
  if (host.includes('zohoapis.')) {
    return `${domain}/books/v3`;
  }
  
  // If it's a books.zoho domain, use /api/v3
  if (host.includes('books.zoho.')) {
    return `${domain}/api/v3`;
  }

  // Default fallback: try to determine region and use zohoapis
  let region = 'com';
  const zohoMatch = host.match(/(?:zohoapis|zoho|books)\.(.+)$/);
  if (zohoMatch && zohoMatch[1]) {
    region = zohoMatch[1];
  }
  
  return `https://www.zohoapis.${region}/books/v3`;
}

/**
 * Robust fetch wrapper for Zoho API with automatic retries for common URL/Domain issues
 */
async function zohoRequest(
  url: string,
  accessToken: string,
  organizationId?: string,
  options: { method?: string; body?: any } = {}
) {
  const headers: Record<string, string> = {
    'Authorization': `Zoho-oauthtoken ${accessToken}`,
    'Accept': 'application/json',
  };
  
  if (organizationId) {
    headers['X-com-zoho-books-organizationid'] = organizationId;
  }

  const fetchOptions: RequestInit = {
    method: options.method || 'GET',
    headers,
  };
  
  if (options.body) {
    fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  }

  const makeRequest = async (targetUrl: string) => {
    console.log(`[Zoho API] Request: ${fetchOptions.method} ${targetUrl}`);
    try {
      const response = await fetch(targetUrl, fetchOptions);
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { code: -1, message: 'Invalid JSON response', raw: text.substring(0, 200) };
      }
      return { response, data, text };
    } catch (error) {
      console.error(`[Zoho API] Fetch error for ${targetUrl}:`, error);
      return { response: null, data: { code: -1, message: String(error) }, text: String(error) };
    }
  };

  let result = await makeRequest(url);

  // 1. Handle "Invalid URL Passed" or code 5 (Domain/Path mismatch)
  if (result.data.code === 5 || result.data.message === 'Invalid URL Passed') {
    let altUrl = url;
    if (url.includes('www.zohoapis.')) {
      altUrl = url.replace('www.zohoapis.', 'books.zoho.').replace('/books/v3/', '/api/v3/');
    } else if (url.includes('books.zoho.')) {
      altUrl = url.replace('books.zoho.', 'www.zohoapis.').replace('/api/v3/', '/books/v3/');
    }

    if (altUrl !== url) {
      console.log(`[Zoho API] Retrying with alternative URL structure: ${altUrl}`);
      result = await makeRequest(altUrl);
    }
  }

  // 2. Handle "You are not authorized" (Code 2) - sometimes happens if org_id is missing in query
  if (result.data.code === 2 || result.data.message?.toLowerCase().includes('not authorized')) {
    if (organizationId && !url.includes('organization_id=')) {
      const separator = url.includes('?') ? '&' : '?';
      const altUrl = `${url}${separator}organization_id=${organizationId}`;
      console.log(`[Zoho API] Retrying with organization_id in query: ${altUrl}`);
      result = await makeRequest(altUrl);
    }
  }

  return result;
}

export async function fetchOrganizations(accessToken: string, apiDomain?: string): Promise<ZohoOrganization[]> {
  const baseUrl = getBaseUrl(apiDomain);
  const url = `${baseUrl}/organizations`;
  
  try {
    const { data } = await zohoRequest(url, accessToken);

    if (data.code !== 0) {
      throw new Error(data.message || `Failed to fetch organizations (Code: ${data.code})`);
    }

    return (data.organizations || []).map((org: any) => ({
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
    const { data: initialData } = await zohoRequest(url, accessToken, orgId);
    let data = initialData;

    if (data.code !== 0) {
      throw new Error(data.message || `Failed to fetch chart of accounts (Code: ${data.code})`);
    }

    let accounts = data.chartofaccounts || [];
    
    if (accounts.length === 0) {
      const accUrl = `${baseUrl}/accounts?organization_id=${orgId}`;
      const { data: accData } = await zohoRequest(accUrl, accessToken, orgId);
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
      const { data } = await zohoRequest(url, accessToken, orgId);

      if (data.code === 0) {
        return data.account || data.bankaccount;
      }

      console.log(`[Zoho API] Account Details failed for ${url}: ${data.message} (Code: ${data.code})`);
      lastError = data;
    } catch (error) {
      console.error(`[Zoho API] Error fetching from ${url}:`, error);
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
      const result = await zohoRequest(url, accessToken, orgId);
      
      if (result.data.code === 0) return result;

      // If direct endpoint fails, try the general banktransactions endpoint
      console.log(`[Zoho API] Banking API (direct) failed: ${result.data.message}. Trying general endpoint...`);
      const generalParams = new URLSearchParams(params);
      generalParams.append('account_id', accountId);
      const generalUrl = `${baseUrl}/banktransactions?${generalParams.toString()}`;
      return await zohoRequest(generalUrl, accessToken, orgId);
    } catch (err) {
      console.error('[Zoho API] Error in tryBanking:', err);
      return { response: null, text: String(err), data: { code: -1, message: String(err) } };
    }
  };

  // Helper to call Report API
  const tryReport = async () => {
    const params = new URLSearchParams();
    params.append('organization_id', orgId!);
    params.append('account_id', accountId);
    if (fromDate && fromDate.trim() !== '') params.append('from_date', fromDate);
    if (toDate && toDate.trim() !== '') params.append('to_date', toDate);

    const endpoints = [
      'reports/accounttransactions', 
      'reports/account_transactions', 
      'reports/account_details',
      'accounttransactions',
      'account_transactions',
      `organizations/${orgId}/reports/accounttransactions`,
      `organizations/${orgId}/reports/account_transactions`
    ];
    let lastResult: any = { data: { code: -1, message: 'No endpoint tried' } };

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
        
        const result = await zohoRequest(url, accessToken, orgId);
        if (result.data.code === 0) {
          console.log(`[Zoho API] Report API succeeded!`);
          return result;
        }
        
        lastResult = result;

        // Try without organization_id in query string if it failed with auth error
        if (result.data.code === 2 || result.data.message?.toLowerCase().includes('not authorized')) {
          const noOrgParams = new URLSearchParams(queryStr);
          noOrgParams.delete('organization_id');
          const noOrgUrl = `${cleanBaseUrl}/${cleanEndpoint}?${noOrgParams.toString()}`;
          console.log(`[Zoho API] Retrying Report API without org_id in query:`, noOrgUrl);
          
          const noOrgResult = await zohoRequest(noOrgUrl, accessToken, orgId);
          if (noOrgResult.data.code === 0) return noOrgResult;
        }
      }
    }

    return lastResult;
  };

  try {
    // Try the most likely API first
    if (isBankOrCard) {
      const result = await tryBanking();
      data = result.data;
      responseText = result.text;
      response = result.response;
      
      if (data.code !== 0) {
        console.log(`[Zoho API] Banking API failed (${data.message}), trying Report API...`);
        const reportResult = await tryReport();
        data = reportResult.data;
        responseText = reportResult.text;
        response = reportResult.response;
      }
    } else {
      const result = await tryReport();
      data = result.data;
      responseText = result.text;
      response = result.response;
      
      if (data.code !== 0) {
        console.log(`[Zoho API] Report API failed (${data.message}), trying Banking API...`);
        const bankingResult = await tryBanking();
        data = bankingResult.data;
        responseText = bankingResult.text;
        response = bankingResult.response;
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
 * Fetches balances for all accounts as of a specific date.
 * If no date is provided, it fetches current balances using the provided reference logic.
 * If a date is provided, it uses the Trial Balance report to get balances as of that date.
 */
export async function fetchOpeningBalances(
  accessToken: string,
  apiDomain?: string,
  organizationId?: string,
  date?: string
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

  // If a date is provided, use the Trial Balance report for accurate "as of" balances
  if (date && date.trim() !== '') {
    try {
      console.log(`[Zoho API] Fetching Opening Balances as of ${date} using Trial Balance report`);
      const params = new URLSearchParams({
        organization_id: orgId!,
        date: date,
      });

      // Try multiple domain variations for reports
      const tryTrialBalance = async (domain: string) => {
        const url = `${domain}/reports/trialbalance?${params.toString()}`;
        const res = await fetch(url, {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'X-com-zoho-books-organizationid': orgId!,
            'Accept': 'application/json'
          },
        });
        const text = await res.text();
        try {
          return { res, text, json: JSON.parse(text) };
        } catch (e) {
          return { res, text, json: { code: -1, message: 'Invalid JSON' } };
        }
      };

      let result = await tryTrialBalance(baseUrl);
      if (result.json.code !== 0 && result.json.message === 'Invalid URL Passed') {
        const altBaseUrl = baseUrl.replace('www.zohoapis.', 'books.zoho.');
        if (altBaseUrl !== baseUrl) {
          result = await tryTrialBalance(altBaseUrl);
        }
      }

      if (result.json.code === 0 && result.json.trialbalance) {
        return result.json.trialbalance.map((acc: any) => {
          const debit = acc.debit_balance || 0;
          const credit = acc.credit_balance || 0;
          const balance = debit - credit;
          
          // Determine Dr/Cr based on account type if available, or just the sign
          // Trial balance doesn't always return account_type, so we use the sign
          return {
            account_id: acc.account_id,
            account_code: acc.account_code || "",
            account_name: acc.account_name,
            account_type: acc.account_type || "",
            balance: Math.abs(balance),
            dr_cr: balance === 0 ? "Nil" : (balance > 0 ? "Dr" : "Cr")
          };
        });
      }
      console.warn(`[Zoho API] Trial Balance report failed (Code: ${result.json.code}), falling back to current balances`);
    } catch (error) {
      console.error('[Zoho API] Error fetching Trial Balance:', error);
    }
  }

  // Fallback to current balances logic (the reference code provided by the user)
  return fetchAccountBalances(accessToken, apiDomain, orgId);
}

