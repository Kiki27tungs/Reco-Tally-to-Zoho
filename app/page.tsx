'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  RefreshCw, BookOpen, ArrowRightLeft, CheckCircle2, AlertCircle, LogOut, 
  ChevronDown, Search, X, FileText, CreditCard, Receipt, Book, 
  ArrowDownCircle, ArrowUpCircle, Info, Hash, Tag, Maximize2, Minimize2,
  ChevronUp, ChevronLeft, ChevronRight
} from 'lucide-react';

interface ZohoAccount {
  account_id: string;
  account_name: string;
  account_code: string;
  account_type: string;
  organization_name?: string;
  balance?: number;
}

interface ZohoTransaction {
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

interface ZohoSummary {
  opening_balance: number;
  closing_balance: number;
  total_debit: number;
  total_credit: number;
  opening_date: string;
  closing_date: string;
}

interface ZohoTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  api_domain: string;
  token_type: string;
}

interface ZohoOrganization {
  organization_id: string;
  name: string;
}

interface ClosingBalance {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  balance: number;
  dr_cr: "Dr" | "Cr" | "Nil";
}

export default function Home() {
  const [tokens, setTokens] = useState<ZohoTokens | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState('com');
  
  // Zoho Data
  const [organizations, setOrganizations] = useState<ZohoOrganization[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState<ZohoOrganization | null>(null);
  const [accounts, setAccounts] = useState<ZohoAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<ZohoAccount | null>(null);
  const [transactions, setTransactions] = useState<ZohoTransaction[]>([]);
  const [summary, setSummary] = useState<ZohoSummary | null>(null);
  const [fetchingData, setFetchingData] = useState(false);
  const [balances, setBalances] = useState<Record<string, any>>({});
  const [openingBalances, setOpeningBalances] = useState<any>(null);
  const [showOpeningBalances, setShowOpeningBalances] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const tableRef = React.useRef<HTMLDivElement>(null);
  const summaryRef = React.useRef<HTMLDivElement>(null);

  const scrollElement = (ref: React.RefObject<HTMLDivElement | null>, direction: 'up' | 'down' | 'left' | 'right') => {
    if (!ref.current) return;
    const amount = 300;
    const options: ScrollToOptions = { behavior: 'smooth' };
    
    if (direction === 'up') ref.current.scrollBy({ top: -amount, ...options });
    if (direction === 'down') ref.current.scrollBy({ top: amount, ...options });
    if (direction === 'left') ref.current.scrollBy({ left: -amount, ...options });
    if (direction === 'right') ref.current.scrollBy({ left: amount, ...options });
  };
  const [showAccountList, setShowAccountList] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');
  
  const getTransactionIcon = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('invoice')) return <FileText className="w-4 h-4" />;
    if (t.includes('bill')) return <Receipt className="w-4 h-4" />;
    if (t.includes('payment')) return <CreditCard className="w-4 h-4" />;
    if (t.includes('journal')) return <Book className="w-4 h-4" />;
    if (t.includes('credit note')) return <ArrowDownCircle className="w-4 h-4" />;
    if (t.includes('vendor credit')) return <ArrowUpCircle className="w-4 h-4" />;
    return <Info className="w-4 h-4" />;
  };

  const getTransactionBadgeColor = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('invoice')) return 'bg-blue-100 text-blue-700 border-blue-200';
    if (t.includes('bill')) return 'bg-orange-100 text-orange-700 border-orange-200';
    if (t.includes('payment')) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    if (t.includes('journal')) return 'bg-purple-100 text-purple-700 border-purple-200';
    if (t.includes('credit note')) return 'bg-red-100 text-red-700 border-red-200';
    if (t.includes('vendor credit')) return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const formatCurrency = (amount: number) => {
    return '₹' + Math.abs(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const getBaseUrl = (apiDomain?: string) => {
    let tld = 'com';
    if (apiDomain) {
      if (apiDomain.includes('.in')) tld = 'in';
      else if (apiDomain.includes('.eu')) tld = 'eu';
      else if (apiDomain.includes('.com.au')) tld = 'com.au';
      else if (apiDomain.includes('.jp')) tld = 'jp';
    }
    return `https://www.zohoapis.${tld}/books/v3`;
  };
  
  // Date Filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const safeJson = async (res: Response) => {
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return res.json();
    }
    const text = await res.text();
    console.error('[App] Expected JSON but received:', text.slice(0, 200));
    throw new Error(`Server returned ${contentType || 'unknown content'} instead of JSON. This often happens when the API route is not found or has crashed.`);
  };

  const fetchOrganizations = React.useCallback(async () => {
    if (!tokens?.access_token) return;
    setFetchingData(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        'Authorization': `Zoho-oauthtoken ${tokens.access_token}`
      };
      if (tokens.api_domain) {
        headers['x-zoho-api-domain'] = tokens.api_domain;
      }

      const res = await fetch('/api/zoho/organizations', {
        headers
      });
      if (!res.ok) {
        const errorData = await safeJson(res).catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch organizations');
      }
      const data = await safeJson(res);
      setOrganizations(data);
      if (data.length > 0 && !selectedOrganization) {
        setSelectedOrganization(data[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch organizations');
    } finally {
      setFetchingData(false);
    }
  }, [tokens, selectedOrganization]);

  const fetchAccounts = React.useCallback(async () => {
    if (!tokens?.access_token) return;
    setFetchingData(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        'Authorization': `Zoho-oauthtoken ${tokens.access_token}`
      };
      if (tokens.api_domain) {
        headers['x-zoho-api-domain'] = tokens.api_domain;
      }
      if (selectedOrganization) {
        headers['x-zoho-organization-id'] = selectedOrganization.organization_id;
      }

      const res = await fetch('/api/zoho/accounts', {
        headers
      });
      if (!res.ok) {
        const errorData = await safeJson(res).catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch accounts');
      }
      const data = await safeJson(res);
      setAccounts(data);

      // Also fetch balances (Closing Balances)
      const balUrl = `/api/zoho/balances`;
      const balRes = await fetch(balUrl, {
        headers
      });
      if (balRes.ok) {
        const balData = await safeJson(balRes);
        // Transform ClosingBalance[] to Record<string, any>
        const balRecord: Record<string, any> = {};
        if (Array.isArray(balData)) {
          balData.forEach((b: any) => {
            balRecord[b.account_id] = b;
          });
        }
        setBalances(balRecord);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch accounts');
    } finally {
      setFetchingData(false);
    }
  }, [tokens, selectedOrganization, toDate]);

  const fetchOpeningBalances = React.useCallback(async () => {
    if (!tokens?.access_token || !selectedOrganization) return;
    setFetchingData(true);
    try {
      const headers: Record<string, string> = {
        'Authorization': `Zoho-oauthtoken ${tokens.access_token}`,
        'x-zoho-organization-id': selectedOrganization.organization_id
      };
      if (tokens.api_domain) {
        headers['x-zoho-api-domain'] = tokens.api_domain;
      }

      let url = '/api/zoho/opening-balances';
      if (fromDate) {
        url += `?date=${fromDate}`;
      }

      const res = await fetch(url, {
        headers
      });
      if (res.ok) {
        const data = await safeJson(res);
        // Transform array to object structure for UI compatibility if needed
        // or just store as array. The UI expects { total, accounts, date }
        if (Array.isArray(data)) {
          const total = data.reduce((sum: number, acc: any) => {
            const val = acc.dr_cr === 'Dr' ? acc.balance : -acc.balance;
            return sum + val;
          }, 0);
          
          setOpeningBalances({
            accounts: data,
            total: total,
            date: fromDate || 'Current'
          });
        } else {
          setOpeningBalances(data);
        }
        setShowOpeningBalances(true);
      }
    } catch (err) {
      console.error('Failed to fetch opening balances:', err);
    } finally {
      setFetchingData(false);
    }
  }, [tokens, selectedOrganization, fromDate]);

  const fetchTransactions = React.useCallback(async (accountId: string, fDate?: string, tDate?: string) => {
    if (!tokens?.access_token) return;
    setFetchingData(true);
    try {
      let url = `/api/zoho/transactions?accountId=${accountId}`;
      if (fDate) url += `&fromDate=${fDate}`;
      if (tDate) url += `&toDate=${tDate}`;

      const headers: Record<string, string> = {
        'Authorization': `Zoho-oauthtoken ${tokens.access_token}`
      };
      if (tokens.api_domain) {
        headers['x-zoho-api-domain'] = tokens.api_domain;
      }
      if (selectedOrganization) {
        headers['x-zoho-organization-id'] = selectedOrganization.organization_id;
      }

      const res = await fetch(url, {
        headers
      });
      if (!res.ok) {
        const errorData = await safeJson(res).catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch transactions');
      }
      const data = await safeJson(res);
      
      // Client-side filtering fallback to ensure strict date range compliance
      let filteredTransactions = data.transactions || [];
      if (fDate || tDate) {
        filteredTransactions = (data.transactions || []).filter((tx: any) => {
          if (!tx.date) return true; // Keep if no date to be safe, though unlikely
          const txDate = new Date(tx.date);
          txDate.setHours(0, 0, 0, 0); // Normalize time for comparison
          
          if (fDate) {
            const from = new Date(fDate);
            from.setHours(0, 0, 0, 0);
            if (txDate < from) return false;
          }
          
          if (tDate) {
            const to = new Date(tDate);
            to.setHours(0, 0, 0, 0);
            if (txDate > to) return false;
          }
          
          return true;
        });
      }
      
      setTransactions(filteredTransactions);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch transactions');
    } finally {
      setFetchingData(false);
    }
  }, [tokens, selectedOrganization]);

  useEffect(() => {
    const storedTokens = localStorage.getItem('zoho_tokens');
    if (storedTokens) {
      setTokens(JSON.parse(storedTokens));
    }

    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const newTokens = event.data.tokens;
        setTokens(newTokens);
        localStorage.setItem('zoho_tokens', JSON.stringify(newTokens));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Fetch organizations when tokens are available
  useEffect(() => {
    if (tokens) {
      fetchOrganizations();
    }
  }, [tokens, fetchOrganizations]);

  // Fetch accounts when selected organization changes
  useEffect(() => {
    if (tokens && selectedOrganization) {
      fetchAccounts();
    }
  }, [tokens, selectedOrganization, fetchAccounts]);

  const handleAccountSelect = (account: ZohoAccount) => {
    setSelectedAccount(account);
    setShowAccountList(false);
    setAccountSearch('');
    fetchTransactions(account.account_id, fromDate, toDate);
  };

  const handleApplyFilter = () => {
    if (selectedAccount) {
      fetchTransactions(selectedAccount.account_id, fromDate, toDate);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/url?region=${region}`);
      if (!response.ok) {
        throw new Error('Failed to get auth URL');
      }
      const { url } = await safeJson(response);

      const authWindow = window.open(
        url,
        'zoho_oauth_popup',
        'width=600,height=700'
      );

      if (!authWindow) {
        alert('Please allow popups for this site to connect your Zoho Books account.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setLoading(false);
    }
  };

  const getRedirectUri = () => {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/api/auth/callback`;
    }
    return '';
  };

  const handleLogout = () => {
    setTokens(null);
    localStorage.removeItem('zoho_tokens');
  };

  return (
    <main className="min-h-screen bg-[#f5f5f0] text-[#5A5A40] font-serif">
      <div className="max-w-7xl mx-auto px-6 py-20">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16"
        >
          <h1 className="text-6xl font-light mb-6 tracking-tight">
            Zoho Books <span className="italic">Reconciliation</span>
          </h1>
          <p className="text-xl opacity-80 max-w-2xl mx-auto font-sans">
            A professional tool for transaction-level reconciliation. 
            {tokens ? ' Your account is connected.' : ' Connect your Zoho Books account to get started.'}
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {!tokens ? (
            <motion.div
              key="connect-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
                {[
                  {
                    title: "Chart of Accounts",
                    desc: "Fetch and manage your accounts with precision.",
                    icon: BookOpen,
                    id: "feature-coa"
                  },
                  {
                    title: "Transaction Sync",
                    desc: "Real-time transaction level data processing.",
                    icon: RefreshCw,
                    id: "feature-sync"
                  },
                  {
                    title: "Reconciliation",
                    desc: "Automated matching and discrepancy detection.",
                    icon: ArrowRightLeft,
                    id: "feature-recon"
                  }
                ].map((feature, i) => (
                  <motion.div
                    key={feature.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="bg-white p-8 rounded-3xl shadow-sm border border-black/5"
                    id={feature.id}
                  >
                    <div className="w-12 h-12 bg-[#5A5A40]/10 rounded-2xl flex items-center justify-center mb-6">
                      <feature.icon className="w-6 h-6 text-[#5A5A40]" />
                    </div>
                    <h3 className="text-2xl font-medium mb-3">{feature.title}</h3>
                    <p className="font-sans text-sm opacity-70 leading-relaxed">
                      {feature.desc}
                    </p>
                  </motion.div>
                ))}
              </div>

              <div className="flex flex-col items-center gap-6">
                <div className="flex flex-col items-center gap-3">
                  <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">Select your Zoho Region</span>
                  <div className="flex gap-2 bg-white p-1.5 rounded-2xl border border-black/5 shadow-sm">
                    {[
                      { id: 'com', label: 'US (.com)' },
                      { id: 'in', label: 'India (.in)' },
                      { id: 'eu', label: 'Europe (.eu)' },
                      { id: 'au', label: 'Australia (.au)' },
                      { id: 'jp', label: 'Japan (.jp)' }
                    ].map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setRegion(r.id)}
                        className={`px-4 py-2 rounded-xl text-xs font-sans transition-all ${
                          region === r.id 
                            ? 'bg-[#5A5A40] text-white shadow-md' 
                            : 'hover:bg-[#f5f5f0] opacity-60'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={handleConnect}
                  disabled={loading}
                  className="bg-[#5A5A40] text-white px-10 py-4 rounded-full text-lg font-sans hover:bg-[#4A4A30] transition-all shadow-lg flex items-center gap-3 disabled:opacity-50"
                  id="connect-button"
                >
                  {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : null}
                  Connect to Zoho Books
                </button>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-8 p-6 bg-red-50 border border-red-100 rounded-2xl flex flex-col gap-4 w-full max-w-xl"
                  >
                    <div className="flex items-start gap-4">
                      <AlertCircle className="text-red-500 w-6 h-6 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-red-800 font-medium mb-1">Connection Error</p>
                        <p className="text-red-600 text-sm">{error}</p>
                      </div>
                    </div>
                    <div className="bg-white/50 p-4 rounded-xl border border-red-200">
                      <p className="text-[10px] uppercase font-bold tracking-widest text-red-400 mb-2">Required Redirect URI</p>
                      <code className="text-xs break-all text-red-900 bg-red-100/50 p-2 rounded block">
                        {getRedirectUri()}
                      </code>
                      <p className="text-[10px] mt-2 text-red-400 italic">Copy this exact URL into your Zoho API Console</p>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="dashboard-view"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white p-12 rounded-[40px] shadow-xl border border-black/5"
            >
              <div className="flex justify-between items-start mb-12">
                <div>
                  <div className="flex items-center gap-3 text-emerald-600 mb-2">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-sans text-sm font-semibold uppercase tracking-wider">Connected</span>
                  </div>
                  <h2 className="text-4xl font-light">Reconciliation Dashboard</h2>
                </div>
                <div className="flex items-center gap-4">
                  {error && (
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2 text-red-500 bg-red-50 px-4 py-2 rounded-full text-xs font-sans border border-red-100">
                        <AlertCircle className="w-4 h-4" />
                        <span>{error}</span>
                        <button onClick={() => setError(null)} className="hover:text-red-700 ml-1">×</button>
                      </div>
                      {tokens?.api_domain && (
                        <span className="text-[9px] opacity-30 font-mono">DC: {getBaseUrl(tokens.api_domain)}</span>
                      )}
                    </div>
                  )}
                  <button 
                    onClick={handleLogout}
                    className="p-3 text-[#5A5A40]/50 hover:text-red-500 transition-colors"
                    title="Logout"
                  >
                    <LogOut className="w-6 h-6" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                <div className="lg:col-span-1 space-y-8">
                  <div className="space-y-6">
                    <h3 className="text-xl italic flex items-center gap-2">
                      <ArrowRightLeft className="w-5 h-5 opacity-50" />
                      Organization
                    </h3>
                    <div className="relative">
                      <select
                        value={selectedOrganization?.organization_id || ''}
                        onChange={(e) => {
                          const org = organizations.find(o => o.organization_id === e.target.value);
                          if (org) setSelectedOrganization(org);
                        }}
                        className="w-full bg-[#f5f5f0] border border-black/10 p-5 rounded-2xl font-sans text-sm appearance-none focus:outline-none focus:border-[#5A5A40] transition-all cursor-pointer"
                      >
                        {organizations.length === 0 ? (
                          <option value="">Loading organizations...</option>
                        ) : (
                          organizations.map((org) => (
                            <option key={org.organization_id} value={org.organization_id}>
                              {org.name} ({org.organization_id})
                            </option>
                          ))
                        )}
                      </select>
                      <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 opacity-40 pointer-events-none" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">Or Enter Manual Org ID</span>
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          placeholder="Organization ID"
                          className="flex-1 bg-[#f5f5f0] border border-black/10 px-4 py-2 rounded-xl text-xs font-sans focus:outline-none focus:border-[#5A5A40]"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = (e.target as HTMLInputElement).value;
                              if (val) setSelectedOrganization({ organization_id: val, name: 'Manual Organization' });
                            }
                          }}
                        />
                        <button 
                          onClick={(e) => {
                            const input = (e.currentTarget.previousSibling as HTMLInputElement);
                            if (input.value) setSelectedOrganization({ organization_id: input.value, name: 'Manual Organization' });
                          }}
                          className="bg-[#5A5A40] text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-[#4A4A30] transition-colors"
                        >
                          Set
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h3 className="text-xl italic flex items-center gap-2">
                      <BookOpen className="w-5 h-5 opacity-50" />
                      Account Selection
                    </h3>
                  <div className="relative">
                    <button 
                      onClick={() => setShowAccountList(!showAccountList)}
                      className="w-full bg-[#f5f5f0] border border-black/10 p-5 rounded-2xl font-sans text-left flex justify-between items-center hover:border-[#5A5A40] transition-all group"
                    >
                      <div className="flex flex-col">
                        <span className="text-xs uppercase opacity-40 font-bold tracking-widest mb-1">Active Account</span>
                        <span className="font-medium">{selectedAccount ? selectedAccount.account_name : 'Select an account...'}</span>
                      </div>
                      <ChevronDown className={`w-5 h-5 opacity-40 transition-transform ${showAccountList ? 'rotate-180' : ''}`} />
                    </button>

                    <AnimatePresence>
                      {showAccountList && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          className="absolute top-full left-0 right-0 mt-2 bg-white border border-black/10 rounded-2xl shadow-2xl z-50 max-h-[400px] overflow-hidden flex flex-col"
                        >
                          <div className="p-3 border-b border-black/5 bg-[#f5f5f0]/50 sticky top-0 z-10">
                            <div className="flex justify-between items-center mb-2 px-1">
                              <div className="flex flex-col">
                                <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">
                                  {accounts.length} Accounts Available
                                </span>
                                {accounts.length > 0 && accounts[0].organization_name && (
                                  <span className="text-[9px] opacity-30 font-sans truncate max-w-[150px]">
                                    Org: {accounts[0].organization_name}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                <button 
                                  onClick={(e) => { e.stopPropagation(); fetchOpeningBalances(); }}
                                  className="text-[10px] uppercase font-bold tracking-widest text-blue-600 hover:underline"
                                >
                                  Opening Balances
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); fetchAccounts(); }}
                                  className="text-[10px] uppercase font-bold tracking-widest text-[#5A5A40] hover:underline flex items-center gap-1"
                                >
                                  <RefreshCw className={`w-2 h-2 ${fetchingData ? 'animate-spin' : ''}`} />
                                  Refresh
                                </button>
                              </div>
                            </div>
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-30" />
                              <input 
                                type="text"
                                placeholder="Search accounts..."
                                value={accountSearch}
                                onChange={(e) => setAccountSearch(e.target.value)}
                                className="w-full pl-10 pr-10 py-2 bg-white border border-black/10 rounded-xl text-sm font-sans focus:outline-none focus:border-[#5A5A40] transition-colors"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                              {accountSearch && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setAccountSearch(''); }}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-black/5 rounded-full transition-colors"
                                >
                                  <X className="w-3 h-3 opacity-40" />
                                </button>
                              )}
                            </div>
                          </div>
                          
                          <div className="overflow-y-auto p-2 min-h-[100px]">
                            {fetchingData && accounts.length === 0 ? (
                              <div className="p-8 text-center opacity-40 italic font-sans flex flex-col items-center gap-3">
                                <RefreshCw className="w-5 h-5 animate-spin" />
                                Loading accounts...
                              </div>
                            ) : accounts.length === 0 ? (
                              <div className="p-8 text-center opacity-40 italic font-sans">
                                No accounts found in your Zoho Books organization.
                              </div>
                            ) : (
                              accounts
                                .filter(acc => 
                                  (acc.account_name || '').toLowerCase().includes((accountSearch || '').toLowerCase()) ||
                                  (acc.account_code || '').toLowerCase().includes((accountSearch || '').toLowerCase())
                                )
                                .map((acc) => {
                                  const balanceObj = balances[acc.account_id] as ClosingBalance | undefined;
                                  const balance = balanceObj?.balance;
                                  const drCr = balanceObj?.dr_cr;
                                  return (
                                    <button
                                      key={acc.account_id}
                                      onClick={() => handleAccountSelect(acc)}
                                      className="w-full text-left p-4 rounded-xl hover:bg-[#f5f5f0] transition-colors group"
                                    >
                                      <div className="flex justify-between items-start">
                                        <div className="font-sans font-medium group-hover:text-[#5A5A40]">{acc.account_name}</div>
                                        {balance !== undefined && (
                                          <div className={`text-xs font-bold ${drCr === 'Dr' ? 'text-green-600' : drCr === 'Cr' ? 'text-red-600' : 'text-gray-400'}`}>
                                            {formatCurrency(balance)}
                                            <span className="ml-1 opacity-60 uppercase text-[8px]">
                                              ({drCr})
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                      <div className="text-xs opacity-40 uppercase tracking-tighter mt-1">{acc.account_type} • {acc.account_code}</div>
                                    </button>
                                  );
                                })
                            )}
                            {accounts.length > 0 && accounts.filter(acc => 
                              (acc.account_name || '').toLowerCase().includes((accountSearch || '').toLowerCase()) ||
                              (acc.account_code || '').toLowerCase().includes((accountSearch || '').toLowerCase())
                            ).length === 0 && (
                              <div className="p-8 text-center opacity-40 italic font-sans">No accounts match your search.</div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {selectedAccount && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-6 bg-[#5A5A40]/5 rounded-2xl border border-[#5A5A40]/10"
                    >
                      <h4 className="text-sm font-bold uppercase tracking-widest opacity-40 mb-4 font-sans">Account Details</h4>
                      <div className="space-y-3 font-sans text-sm">
                        <div className="flex justify-between">
                          <span className="opacity-60">Code</span>
                          <span className="font-medium">{selectedAccount.account_code}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="opacity-60">Type</span>
                          <span className="font-medium">{selectedAccount.account_type}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="opacity-60">ID</span>
                          <span className="font-mono text-[10px]">{selectedAccount.account_id}</span>
                        </div>
                        <div className="pt-3 border-t border-[#5A5A40]/10 flex justify-between items-center">
                          <span className="text-xs font-bold uppercase tracking-widest opacity-40">Current Balance</span>
                          <span className={`text-lg font-bold ${balances[selectedAccount.account_id]?.dr_cr === 'Dr' ? 'text-green-600' : balances[selectedAccount.account_id]?.dr_cr === 'Cr' ? 'text-red-600' : 'text-gray-400'}`}>
                            {formatCurrency(balances[selectedAccount.account_id]?.balance || 0)}
                            <span className="ml-1 opacity-60 uppercase text-[10px]">
                              ({balances[selectedAccount.account_id]?.dr_cr || 'Nil'})
                            </span>
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>

              <div className="lg:col-span-2 space-y-8">
                {/* Balances Overview Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold uppercase tracking-widest opacity-40 font-sans">Closing Balance</h4>
                        <p className="text-xs opacity-60 italic">Current actual balance from Zoho</p>
                      </div>
                    </div>
                      <div className="flex flex-col">
                        <div className={`flex items-baseline gap-2 ${selectedAccount && balances[selectedAccount.account_id]?.dr_cr === 'Cr' ? 'text-red-600' : 'text-black'}`}>
                          <span className="text-4xl font-light tracking-tight">
                            {selectedAccount ? formatCurrency(balances[selectedAccount.account_id]?.balance || 0) : '--'}
                          </span>
                          {selectedAccount && (
                            <span className="text-xl font-medium opacity-40">
                              ({balances[selectedAccount.account_id]?.dr_cr || 'Nil'})
                            </span>
                          )}
                        </div>
                        {selectedAccount && (
                        <span className="text-[10px] mt-2 opacity-40 uppercase font-bold tracking-widest">
                          As of {new Date().toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </motion.div>

                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white p-8 rounded-[32px] border border-black/5 shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-3 bg-blue-50 rounded-2xl text-blue-600">
                        <Info className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold uppercase tracking-widest opacity-40 font-sans">Opening Balance</h4>
                        <p className="text-xs opacity-60 italic">
                          {selectedAccount ? `For ${selectedAccount.account_name}` : 'Organization setup balance'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-light tracking-tight">
                          {(() => {
                            if (!openingBalances) return '--';
                            if (selectedAccount && Array.isArray(openingBalances.accounts)) {
                              const acc = openingBalances.accounts.find((a: any) => a.account_id === selectedAccount.account_id);
                              return acc ? formatCurrency(acc.balance) : formatCurrency(0);
                            }
                            return formatCurrency(openingBalances.total || 0);
                          })()}
                        </span>
                        {openingBalances && (
                          <span className="text-xl font-medium opacity-40">
                            {(() => {
                              if (selectedAccount && Array.isArray(openingBalances.accounts)) {
                                const acc = openingBalances.accounts.find((a: any) => a.account_id === selectedAccount.account_id);
                                return `(${acc?.dr_cr || 'Nil'})`;
                              }
                              return `(${openingBalances.total >= 0 ? 'Dr' : 'Cr'})`;
                            })()}
                          </span>
                        )}
                      </div>
                      {openingBalances && (
                        <span className="text-[10px] mt-2 opacity-40 uppercase font-bold tracking-widest">
                          As of: {openingBalances.date}
                        </span>
                      )}
                      {!openingBalances && (
                        <button 
                          onClick={fetchOpeningBalances}
                          className="mt-2 text-[10px] uppercase font-bold tracking-widest text-blue-600 hover:underline text-left"
                        >
                          Load Opening Balances
                        </button>
                      )}
                    </div>
                  </motion.div>
                </div>

                {/* Opening Balances Table (Different Table) */}
                <AnimatePresence>
                  {openingBalances && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="bg-[#f5f5f0]/30 rounded-[32px] border border-black/5 p-8">
                        <div className="flex justify-between items-center mb-6">
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">Organization Setup</span>
                            <h3 className="text-xl italic">Opening Balances Table</h3>
                          </div>
                          <button 
                            onClick={() => setOpeningBalances(null)}
                            className="p-2 hover:bg-black/5 rounded-full transition-colors opacity-40"
                          >
                            <X size={18} />
                          </button>
                        </div>
                        <div className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm">
                          <table className="w-full font-sans text-sm text-left border-collapse">
                            <thead>
                              <tr className="bg-[#f5f5f0] text-[10px] uppercase tracking-widest opacity-50">
                                <th className="px-6 py-4 font-bold">Account Name</th>
                                <th className="px-6 py-4 font-bold">Type</th>
                                <th className="px-6 py-4 font-bold text-right">Debit</th>
                                <th className="px-6 py-4 font-bold text-right">Credit</th>
                                <th className="px-6 py-4 font-bold text-right">Balance</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-black/5">
                              {(openingBalances.accounts || []).map((acc: any, idx: number) => (
                                <tr 
                                  key={`${acc.account_id}-${idx}`} 
                                  className={`hover:bg-[#f5f5f0]/30 transition-colors cursor-pointer ${selectedAccount?.account_id === acc.account_id ? 'bg-[#5A5A40]/5' : ''}`}
                                  onClick={() => {
                                    const fullAcc = accounts.find(a => a.account_id === acc.account_id);
                                    if (fullAcc) setSelectedAccount(fullAcc);
                                  }}
                                >
                                  <td className="px-6 py-4 font-medium">
                                    <div className="flex items-center gap-2">
                                      {acc.account_name}
                                      {selectedAccount?.account_id === acc.account_id && (
                                        <CheckCircle2 size={12} className="text-[#5A5A40]" />
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 opacity-60 text-[10px] uppercase tracking-wider">{acc.account_type || acc.debit_or_credit}</td>
                                  <td className="px-6 py-4 text-right font-mono">
                                    {acc.dr_cr === 'Dr' ? formatCurrency(acc.balance) : '-'}
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono">
                                    {acc.dr_cr === 'Cr' ? formatCurrency(acc.balance) : '-'}
                                  </td>
                                  <td className={`px-6 py-4 text-right font-mono font-bold ${acc.dr_cr === 'Dr' ? 'text-green-600' : 'text-red-600'}`}>
                                    {formatCurrency(acc.balance)}
                                    <span className="ml-1 opacity-60 uppercase text-[8px]">
                                      ({acc.dr_cr})
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-[#f5f5f0]/50 font-bold">
                                <td colSpan={4} className="px-6 py-4 text-right uppercase tracking-widest text-[10px] opacity-40">Total Opening Balance</td>
                                <td className="px-6 py-4 text-right font-mono text-lg">
                                  <div className="flex items-center justify-end gap-2">
                                    <span>{formatCurrency(openingBalances.total || 0)}</span>
                                    <span className="text-xs font-medium opacity-40">
                                      ({openingBalances.total >= 0 ? 'Dr' : 'Cr'})
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-6">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center gap-4">
                      <h3 className="text-xl italic flex items-center gap-2">
                        <ArrowRightLeft className="w-5 h-5 opacity-50" />
                        Transactions
                      </h3>
                      <button 
                        onClick={() => setIsFullScreen(!isFullScreen)}
                        className="p-2 hover:bg-black/5 rounded-lg transition-colors opacity-40 hover:opacity-100"
                        title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
                      >
                        {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-3 bg-[#f5f5f0] p-2 rounded-2xl border border-black/5">
                      <div className="flex items-center gap-2 px-3">
                        <span className="text-[10px] uppercase font-bold opacity-40">From</span>
                        <input 
                          type="date" 
                          value={fromDate}
                          onChange={(e) => setFromDate(e.target.value)}
                          className="bg-transparent border-none text-xs font-sans focus:ring-0 p-0 cursor-pointer"
                        />
                      </div>
                      <div className="w-px h-4 bg-black/10" />
                      <div className="flex items-center gap-2 px-3">
                        <span className="text-[10px] uppercase font-bold opacity-40">To</span>
                        <input 
                          type="date" 
                          value={toDate}
                          onChange={(e) => setToDate(e.target.value)}
                          className="bg-transparent border-none text-xs font-sans focus:ring-0 p-0 cursor-pointer"
                        />
                      </div>
                      <div className="flex items-center gap-2 pr-2">
                        {(fromDate || toDate) && (
                          <button 
                            onClick={() => { setFromDate(''); setToDate(''); }}
                            className="p-1.5 hover:bg-black/5 rounded-lg transition-colors opacity-40 hover:opacity-100"
                            title="Clear dates"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                        )}
                        <button 
                          onClick={handleApplyFilter}
                          disabled={fetchingData || !selectedAccount}
                          className="bg-[#5A5A40] text-white px-4 py-1.5 rounded-xl text-xs font-sans hover:bg-[#4A4A30] transition-colors disabled:opacity-30 flex items-center gap-2"
                        >
                          {fetchingData ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Apply'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Summary Table (Moved Above) */}
                  <AnimatePresence>
                    {summary && (
                      <motion.div 
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-4"
                      >
                        <h3 className="text-xl italic flex items-center gap-2">
                          <BookOpen className="w-5 h-5 opacity-50" />
                          Account Summary (Selected Period)
                        </h3>
                        <div className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm relative group/summary">
                          {/* Navigation Controls Overlay for Summary */}
                          <div className="absolute bottom-4 right-4 flex flex-col items-center gap-1.5 z-50 opacity-0 group-hover/summary:opacity-100 transition-opacity">
                            <button 
                              onClick={() => scrollElement(summaryRef, 'up')}
                              className="w-8 h-8 bg-white/90 backdrop-blur shadow-md border border-black/5 rounded-full flex items-center justify-center hover:bg-[#5A5A40] hover:text-white transition-all group"
                            >
                              <ChevronUp className="w-4 h-4 opacity-60 group-hover:opacity-100" />
                            </button>
                            <div className="flex gap-1.5">
                              <button 
                                onClick={() => scrollElement(summaryRef, 'left')}
                                className="w-8 h-8 bg-white/90 backdrop-blur shadow-md border border-black/5 rounded-full flex items-center justify-center hover:bg-[#5A5A40] hover:text-white transition-all group"
                              >
                                <ChevronLeft className="w-4 h-4 opacity-60 group-hover:opacity-100" />
                              </button>
                              <button 
                                onClick={() => scrollElement(summaryRef, 'right')}
                                className="w-8 h-8 bg-white/90 backdrop-blur shadow-md border border-black/5 rounded-full flex items-center justify-center hover:bg-[#5A5A40] hover:text-white transition-all group"
                              >
                                <ChevronRight className="w-4 h-4 opacity-60 group-hover:opacity-100" />
                              </button>
                            </div>
                            <button 
                              onClick={() => scrollElement(summaryRef, 'down')}
                              className="w-8 h-8 bg-white/90 backdrop-blur shadow-md border border-black/5 rounded-full flex items-center justify-center hover:bg-[#5A5A40] hover:text-white transition-all group"
                            >
                              <ChevronDown className="w-4 h-4 opacity-60 group-hover:opacity-100" />
                            </button>
                          </div>

                          <div ref={summaryRef} className="overflow-auto">
                            <table className="w-full font-sans text-sm text-left border-collapse">
                              <thead>
                                <tr className="bg-[#f5f5f0] text-[10px] uppercase tracking-widest opacity-50">
                                  <th className="px-6 py-4 font-bold whitespace-nowrap">Description</th>
                                  <th className="px-6 py-4 font-bold whitespace-nowrap">Date</th>
                                  <th className="px-6 py-4 font-bold text-right whitespace-nowrap">Debit</th>
                                  <th className="px-6 py-4 font-bold text-right whitespace-nowrap">Credit</th>
                                  <th className="px-6 py-4 font-bold text-right whitespace-nowrap">Balance</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-black/5">
                                <tr className="hover:bg-[#f5f5f0]/30 transition-colors">
                                  <td className="px-6 py-4 font-medium whitespace-nowrap">Opening Balance</td>
                                  <td className="px-6 py-4 opacity-60 whitespace-nowrap">As On {summary.opening_date || '-'}</td>
                                  <td className="px-6 py-4 text-right font-mono whitespace-nowrap">
                                    {summary.opening_balance > 0 ? formatCurrency(summary.opening_balance) : '-'}
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono whitespace-nowrap">
                                    {summary.opening_balance < 0 ? formatCurrency(summary.opening_balance) : '-'}
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono text-[#5A5A40] whitespace-nowrap">
                                    <div className="flex items-center justify-end gap-1">
                                      <span>{formatCurrency(summary.opening_balance)}</span>
                                      <span className="text-[10px] uppercase opacity-60 font-bold">
                                        ({summary.opening_balance >= 0 ? 'Dr' : 'Cr'})
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                                <tr className="hover:bg-[#f5f5f0]/30 transition-colors">
                                  <td className="px-6 py-4 font-medium whitespace-nowrap">Total Debits and Credits</td>
                                  <td className="px-6 py-4 opacity-60 whitespace-nowrap">
                                    {fromDate && toDate ? `${fromDate} to ${toDate}` : '-'}
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono text-emerald-600 whitespace-nowrap">
                                    {summary.total_debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono text-red-600 whitespace-nowrap">
                                    {summary.total_credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono opacity-20 whitespace-nowrap">-</td>
                                </tr>
                                <tr className="bg-[#5A5A40]/5 font-bold">
                                  <td className="px-6 py-4 whitespace-nowrap">Closing Balance</td>
                                  <td className="px-6 py-4 opacity-60 whitespace-nowrap">As On {summary.closing_date || '-'}</td>
                                  <td className="px-6 py-4 text-right font-mono whitespace-nowrap">
                                    {summary.closing_balance > 0 ? formatCurrency(summary.closing_balance) : '-'}
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono whitespace-nowrap">
                                    {summary.closing_balance < 0 ? formatCurrency(summary.closing_balance) : '-'}
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono text-[#5A5A40] whitespace-nowrap">
                                    <div className="flex items-center justify-end gap-1">
                                      <span>{formatCurrency(summary.closing_balance)}</span>
                                      <span className="text-[10px] uppercase opacity-60 font-bold">
                                        ({summary.closing_balance >= 0 ? 'Dr' : 'Cr'})
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  
                  <div className={`bg-white rounded-2xl border border-black/5 overflow-hidden relative ${isFullScreen ? 'fixed inset-4 z-[100] shadow-2xl flex flex-col' : ''}`}>
                    {/* Navigation Controls Overlay */}
                    <div className="absolute bottom-6 right-6 flex flex-col items-center gap-2 z-50">
                      <button 
                        onClick={() => scrollElement(tableRef, 'up')}
                        className="w-10 h-10 bg-white/90 backdrop-blur shadow-lg border border-black/5 rounded-full flex items-center justify-center hover:bg-[#5A5A40] hover:text-white transition-all group"
                        title="Scroll Up"
                      >
                        <ChevronUp className="w-5 h-5 opacity-60 group-hover:opacity-100" />
                      </button>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => scrollElement(tableRef, 'left')}
                          className="w-10 h-10 bg-white/90 backdrop-blur shadow-lg border border-black/5 rounded-full flex items-center justify-center hover:bg-[#5A5A40] hover:text-white transition-all group"
                          title="Scroll Left"
                        >
                          <ChevronLeft className="w-5 h-5 opacity-60 group-hover:opacity-100" />
                        </button>
                        <button 
                          onClick={() => scrollElement(tableRef, 'right')}
                          className="w-10 h-10 bg-white/90 backdrop-blur shadow-lg border border-black/5 rounded-full flex items-center justify-center hover:bg-[#5A5A40] hover:text-white transition-all group"
                          title="Scroll Right"
                        >
                          <ChevronRight className="w-5 h-5 opacity-60 group-hover:opacity-100" />
                        </button>
                      </div>
                      <button 
                        onClick={() => scrollElement(tableRef, 'down')}
                        className="w-10 h-10 bg-white/90 backdrop-blur shadow-lg border border-black/5 rounded-full flex items-center justify-center hover:bg-[#5A5A40] hover:text-white transition-all group"
                        title="Scroll Down"
                      >
                        <ChevronDown className="w-5 h-5 opacity-60 group-hover:opacity-100" />
                      </button>
                    </div>

                    <div ref={tableRef} className={`overflow-auto ${isFullScreen ? 'flex-1' : 'max-h-[600px]'}`}>
                      <table className="w-full font-sans text-sm text-left border-collapse">
                        <thead className="sticky top-0 z-20">
                          <tr className="bg-[#f5f5f0] text-[10px] uppercase tracking-widest opacity-50">
                            <th className="px-6 py-4 font-bold bg-[#f5f5f0]">Date</th>
                            <th className="px-6 py-4 font-bold bg-[#f5f5f0]">Account</th>
                            <th className="px-6 py-4 font-bold bg-[#f5f5f0]">Transaction Details</th>
                            <th className="px-6 py-4 font-bold bg-[#f5f5f0]">Type</th>
                            <th className="px-6 py-4 font-bold bg-[#f5f5f0]">Transaction#</th>
                            <th className="px-6 py-4 font-bold bg-[#f5f5f0]">Reference#</th>
                            <th className="px-6 py-4 font-bold text-right bg-[#f5f5f0]">Debit</th>
                            <th className="px-6 py-4 font-bold text-right bg-[#f5f5f0]">Credit</th>
                            <th className="px-6 py-4 font-bold text-right bg-[#f5f5f0]">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5">
                          {fetchingData ? (
                            <tr>
                              <td colSpan={9} className="px-6 py-20 text-center">
                                <div className="flex flex-col items-center gap-3 opacity-40">
                                  <RefreshCw className="w-6 h-6 animate-spin" />
                                  <span className="text-sm italic font-sans">Fetching transactions...</span>
                                </div>
                              </td>
                            </tr>
                          ) : transactions.length > 0 ? (
                            transactions.map((tx, idx) => (
                              <tr key={`${tx.transaction_id || 'tx'}-${idx}`} className="hover:bg-[#f5f5f0]/50 transition-colors group">
                                <td className="px-6 py-4 opacity-60 whitespace-nowrap align-top">{tx.date || '-'}</td>
                                <td className="px-6 py-4 align-top">
                                  <div className="text-[11px] text-black/60 font-medium">
                                    {tx.account_name || '-'}
                                  </div>
                                </td>
                                <td className="px-6 py-4 align-top">
                                  <div className="font-medium text-black/80 leading-relaxed max-w-[250px]">
                                    {tx.description || '-'}
                                  </div>
                                </td>
                                <td className="px-6 py-4 align-top">
                                  <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border w-fit ${getTransactionBadgeColor(tx.transaction_type)}`}>
                                    {getTransactionIcon(tx.transaction_type)}
                                    {tx.transaction_type}
                                  </div>
                                </td>
                                <td className="px-6 py-4 align-top">
                                  <div className="flex items-center gap-1 text-[11px] text-black/40">
                                    <Hash className="w-3 h-3" />
                                    <span>{tx.transaction_number || '-'}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 align-top">
                                  <div className="flex items-center gap-1 text-[11px] text-black/40">
                                    <Tag className="w-3 h-3" />
                                    <span>{tx.reference_number || '-'}</span>
                                  </div>
                                </td>
                                <td className={`px-6 py-4 text-right align-top font-mono ${tx.debit_amount > 0 ? 'text-emerald-600' : 'opacity-20'}`}>
                                  {tx.debit_amount > 0 ? (tx.debit_amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                                </td>
                                <td className={`px-6 py-4 text-right align-top font-mono ${tx.credit_amount > 0 ? 'text-red-600' : 'opacity-20'}`}>
                                  {tx.credit_amount > 0 ? (tx.credit_amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-'}
                                </td>
                                <td className={`px-6 py-4 text-right align-top font-bold font-mono ${tx.debit_amount > 0 ? 'text-emerald-600' : tx.credit_amount > 0 ? 'text-red-600' : ''}`}>
                                  {Math.abs(tx.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  <span className="ml-1 text-[10px] uppercase opacity-60">
                                    {tx.debit_amount > 0 ? 'dr' : tx.credit_amount > 0 ? 'cr' : ''}
                                  </span>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={9} className="px-6 py-20 text-center opacity-40 italic">
                                {selectedAccount ? 'No transactions found for this account.' : 'Select an account to view transactions.'}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* Opening Balances Modal */}
      {showOpeningBalances && openingBalances && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col rounded-[32px] shadow-2xl border border-black/5"
          >
            <div className="p-6 border-b border-black/5 flex justify-between items-center bg-[#f5f5f0]/50">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">Settings</span>
                <h3 className="text-xl italic">Opening Balances</h3>
              </div>
              <button onClick={() => setShowOpeningBalances(false)} className="p-2 hover:bg-black/5 rounded-full transition-colors opacity-40 hover:opacity-100">
                <X size={20} />
              </button>
            </div>
            <div className="p-8 overflow-y-auto">
              <div className="mb-8 flex items-center gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                <Info className="w-5 h-5 text-blue-500" />
                <div className="text-sm text-blue-800">
                  Opening Balance Date: <span className="font-bold">{openingBalances.date}</span>
                </div>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 text-[10px] uppercase font-bold tracking-widest opacity-40 px-4">
                  <span>Account</span>
                  <span className="text-right">Amount</span>
                </div>
                <div className="space-y-1">
                  {(openingBalances.accounts || []).map((acc: any, idx: number) => (
                    <div key={`${acc.account_id}-${idx}`} className="flex justify-between items-center p-4 rounded-xl hover:bg-[#f5f5f0] transition-colors border border-transparent hover:border-black/5">
                      <div className="flex flex-col">
                        <span className="font-sans font-medium">{acc.account_name}</span>
                        <span className="text-[10px] opacity-40 uppercase">{acc.debit_or_credit}</span>
                      </div>
                      <div className={`font-sans font-bold ${acc.debit_or_credit === 'debit' ? 'text-green-600' : 'text-red-600'}`}>
                        {acc.debit_or_credit === 'credit' ? '-' : ''}{formatCurrency(acc.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-black/5 bg-[#f5f5f0]/50 flex justify-between items-center">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">Total Opening Balance</span>
                <span className="text-2xl font-light">{formatCurrency(openingBalances.total)}</span>
              </div>
              <button 
                onClick={() => setShowOpeningBalances(false)}
                className="bg-[#5A5A40] text-white px-8 py-3 rounded-full text-sm font-sans hover:bg-[#4A4A30] transition-all shadow-lg"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </main>
  );
}
