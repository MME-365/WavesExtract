/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Download, 
  Play, 
  Square, 
  Database, 
  FileJson, 
  Activity, 
  ShieldCheck,
  ChevronRight,
  Loader2,
  AlertCircle,
  AlertTriangle,
  LogIn,
  LogOut,
  Wallet,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  User,
  Crown,
  Share2,
  TrendingUp,
  Megaphone,
  Box,
  Users,
  Layers,
  ArrowRight,
  Clipboard,
  QrCode,
  ChevronLeft,
  Menu,
  X,
  ChevronDown,
  Sparkles,
  ExternalLink,
  Search,
  Eye,
  Filter,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  signInAnonymously,
  User as FirebaseUser
} from 'firebase/auth';
import { Signer } from '@waves/signer';
import { ProviderKeeper } from '@waves/provider-keeper';
import { QRCodeSVG } from 'qrcode.react';
import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot, 
  collection, 
  addDoc, 
  updateDoc, 
  query, 
  where,
  orderBy,
  limit,
  increment,
  getDocs
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';

const NODE_URL = 'https://nodes.wavesnodes.com';
const TARGET_ADDRESS_COUNT = 100000;
const BATCH_SIZE = 100;
const PRICE_PER_ADDRESS = 0.0175;
const COMMUNITY_GOAL = 200000;

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface Stats {
  addressesFound: number;
  blocksProcessed: number;
  currentHeight: number;
  isExtracting: boolean;
  error: string | null;
}

interface UserProfile {
  email: string;
  balance: number;
  isAdmin: boolean;
  isSuspended: boolean;
  profileCompleted: boolean;
  name?: string;
  phone?: string;
  age?: number;
  gender?: string;
  country?: string;
  purpose?: string;
  walletAddress?: string;
  createdAt: string;
}

interface Deposit {
  id: string;
  userId: string;
  userEmail: string;
  amount: number;
  currency: string;
  proof: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface SharedFile {
  id: string;
  label: string;
  addressCount: number;
  fileUrl: string;
  createdAt: string;
  addresses?: string[];
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'landing' | 'main' | 'deposits' | 'admin' | 'assets'>('landing');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [calcWallets, setCalcWallets] = useState(1000);
  
  const [stats, setStats] = useState<Stats>({
    addressesFound: 0,
    blocksProcessed: 0,
    currentHeight: 0,
    isExtracting: false,
    error: null,
  });
  const [lastScannedHeight, setLastScannedHeight] = useState<number | null>(null);

  const [addresses, setAddresses] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState(0);
  const extractionRef = useRef<boolean>(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isSuspendedModalOpen, setIsSuspendedModalOpen] = useState(false);
  const [isWavesModalOpen, setIsWavesModalOpen] = useState(false);
  const [manualWalletAddress, setManualWalletAddress] = useState('');
  const [wavesLoading, setWavesLoading] = useState(false);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [adminDeposits, setAdminDeposits] = useState<Deposit[]>([]);
  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([]);
  const [selectedAdminFile, setSelectedAdminFile] = useState<SharedFile | null>(null);
  const [adminSearchQuery, setAdminSearchQuery] = useState('');
  const [adminPage, setAdminPage] = useState(1);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [globalStats, setGlobalStats] = useState({ totalUniqueWallets: 0 });
  const [depositStep, setDepositStep] = useState(1);
  const [depositData, setDepositData] = useState({ amount: '', currency: 'WAVES' });
  const [livePrices, setLivePrices] = useState<Record<string, number>>({
    WAVES: 1.5,
    BIOTECH: 1.5,
    BTC: 65000,
    ETH: 3500,
    SOL: 150,
    USDT: 1.0
  });

  // Profile Form State
  const [profileForm, setProfileForm] = useState({
    name: '',
    phone: '',
    age: '',
    gender: 'male',
    country: '',
    purpose: 'Investor',
    walletAddress: ''
  });

  // Fetch Live Prices
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=waves,bitcoin,ethereum,solana,tether&vs_currencies=usd');
        if (!res.ok) return;
        const data = await res.json();
        if (data && typeof data === 'object') {
          setLivePrices(prev => ({
            ...prev,
            WAVES: data.waves?.usd ?? prev.WAVES ?? 1.5,
            BIOTECH: data.waves?.usd ?? prev.BIOTECH ?? 1.5,
            BTC: data.bitcoin?.usd ?? prev.BTC ?? 65000,
            ETH: data.ethereum?.usd ?? prev.ETH ?? 3500,
            SOL: data.solana?.usd ?? prev.SOL ?? 150,
            USDT: data.tether?.usd ?? prev.USDT ?? 1.0
          }));
        }
      } catch (e) {
        console.warn('Live price fetch warning (using default/cached prices):', e);
      }
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setDeposits([]);
        setAdminDeposits([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Profile Listener
  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as UserProfile;
        
        // Migration: Ensure all required fields for security rules are present
        const requiredFields: (keyof UserProfile)[] = ['email', 'balance', 'isAdmin', 'isSuspended', 'profileCompleted', 'createdAt'];
        const missingFields = requiredFields.filter(f => data[f] === undefined);
        
        if (missingFields.length > 0) {
          console.log('Migrating user profile, adding missing fields:', missingFields);
          const migrationData: any = {};
          if (data.email === undefined) migrationData.email = user.email || '';
          if (data.balance === undefined) migrationData.balance = 0;
          if (data.isAdmin === undefined) migrationData.isAdmin = user.email === 'customerservice.mme365@gmail.com';
          if (data.isSuspended === undefined) migrationData.isSuspended = false;
          if (data.profileCompleted === undefined) migrationData.profileCompleted = false;
          if (data.createdAt === undefined) migrationData.createdAt = new Date().toISOString();
          
          updateDoc(userRef, migrationData).catch(e => console.error('Migration failed:', e));
        }

        setProfile(data);
        setProfileForm({
          name: data.name || '',
          phone: data.phone || '',
          age: data.age?.toString() || '',
          gender: data.gender || 'male',
          country: data.country || '',
          purpose: data.purpose || 'Investor',
          walletAddress: data.walletAddress || ''
        });
        if (data.isSuspended) {
          setIsSuspendedModalOpen(true);
          stopExtraction();
        }
      } else {
        const newProfile: UserProfile = {
          email: user.email || '',
          balance: 0,
          isAdmin: user.email === 'customerservice.mme365@gmail.com',
          isSuspended: false,
          profileCompleted: false,
          createdAt: new Date().toISOString(),
        };
        setDoc(userRef, newProfile).catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${user.uid}`));
        setProfile(newProfile);
      }
    }, (e) => handleFirestoreError(e, OperationType.GET, `users/${user.uid}`));

    return () => unsubscribe();
  }, [user]);

  // User Deposits Listener
  useEffect(() => {
    if (!user) return;

    const depositsQuery = query(
      collection(db, 'deposits'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(depositsQuery, (snapshot) => {
      setDeposits(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Deposit)));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'deposits'));

    return () => unsubscribe();
  }, [user]);

  // Shared Files Listener
  useEffect(() => {
    if (!user) return;

    const sharedQuery = query(collection(db, 'shared_files'), orderBy('createdAt', 'desc'), limit(100));
    const unsubscribe = onSnapshot(sharedQuery, (snapshot) => {
      setSharedFiles(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SharedFile)));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'shared_files'));

    return () => unsubscribe();
  }, [user]);

  // Admin Listener
  useEffect(() => {
    if (user && profile?.isAdmin) {
      // Listen to deposits
      const qDep = query(collection(db, 'deposits'), orderBy('createdAt', 'desc'), limit(50));
      const unsubDep = onSnapshot(qDep, (snapshot) => {
        setAdminDeposits(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Deposit)));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'deposits/admin'));

      // Listen to users
      const qUser = query(collection(db, 'users'), limit(100));
      const unsubUser = onSnapshot(qUser, (snapshot) => {
        setAllUsers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'users/admin'));

      // Listen to global stats
      const unsubGlobal = onSnapshot(doc(db, 'global_stats', 'wallets'), (snapshot) => {
        if (snapshot.exists()) {
          setGlobalStats(snapshot.data() as any);
        } else {
          setDoc(doc(db, 'global_stats', 'wallets'), { totalUniqueWallets: 0, updatedAt: new Date().toISOString() });
        }
      });

      return () => {
        unsubDep();
        unsubUser();
        unsubGlobal();
      };
    }
  }, [user, profile?.isAdmin]);

  // Helper for fetching from Waves Node with retries
  const fetchWithRetry = async (url: string, retries = 3, backoff = 1000): Promise<any> => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 429) throw new Error('Rate limit exceeded');
        throw new Error(`Node error: ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, backoff));
        return fetchWithRetry(url, retries - 1, backoff * 2);
      }
      throw err;
    }
  };

  // Load current height
  useEffect(() => {
    const fetchHeight = async () => {
      try {
        const data = await fetchWithRetry(`${NODE_URL}/blocks/height`);
        setStats(prev => ({ ...prev, currentHeight: data.height, error: null }));
      } catch (err) {
        setStats(prev => ({ ...prev, error: 'Network issues: Unable to reach Waves node. Please refresh.' }));
      }
    };
    fetchHeight();
    const interval = setInterval(fetchHeight, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  // Close navigation menu on outside click or escape
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  const login = async () => {
    setStats(prev => ({ ...prev, error: null }));
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        console.log('Login attempt cancelled by user (popup closed).');
      } else if (error.code === 'auth/unauthorized-domain') {
        const domain = window.location.hostname;
        const msg = `Domain "${domain}" is not authorized in Firebase. Please add "${domain}" to "Authorized Domains" in your Firebase Authentication settings under "Authentication" -> "Settings".`;
        setStats(prev => ({ ...prev, error: msg }));
        alert(msg);
      } else {
        console.error('Login error:', error);
        setStats(prev => ({ ...prev, error: 'Login failed: ' + (error.message || 'Unknown error') }));
      }
    }
  };

  const connectWalletWithAddress = async (addr: string) => {
    const trimmed = addr.trim();
    if (!trimmed) {
      setStats(prev => ({ ...prev, error: 'Please enter a valid Waves wallet address.' }));
      return;
    }
    // Basic Waves address validation: starts with 3P, 3M, 3N or ~35 chars
    if (trimmed.length < 25) {
      setStats(prev => ({ ...prev, error: 'Invalid Waves address length.' }));
      return;
    }

    setWavesLoading(true);
    setStats(prev => ({ ...prev, error: null }));
    try {
      if (user) {
        await updateDoc(doc(db, 'users', user.uid), { walletAddress: trimmed });
        setProfileForm(prev => ({ ...prev, walletAddress: trimmed }));
        setIsWavesModalOpen(false);
      } else {
        try {
          const anon = await signInAnonymously(auth);
          const userRef = doc(db, 'users', anon.user.uid);
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            await setDoc(userRef, {
              email: 'anonymous@waves.' + trimmed.slice(-8),
              balance: 0,
              isAdmin: false,
              isSuspended: false,
              profileCompleted: false,
              walletAddress: trimmed,
              createdAt: new Date().toISOString()
            });
          } else {
            await updateDoc(userRef, { walletAddress: trimmed });
          }
          setIsWavesModalOpen(false);
        } catch (anonErr: any) {
          if (anonErr.code === 'auth/admin-restricted-operation') {
            throw new Error('Anonymous authentication is disabled in Firebase. Please sign in with Google or enable Anonymous in Firebase.');
          }
          throw anonErr;
        }
      }
    } catch (err: any) {
      console.error('Wallet link error:', err);
      setStats(prev => ({ ...prev, error: err.message || 'Failed to link Waves wallet' }));
    } finally {
      setWavesLoading(false);
    }
  };

  const loginWithWaves = async () => {
    // Check if WavesKeeper extension is installed in the browser window
    const isKeeperAvailable = typeof window !== 'undefined' && Boolean((window as any).WavesKeeper);

    if (!isKeeperAvailable) {
      // Rather than throwing unhandled Signer internal error 1004, open friendly Waves modal
      setIsWavesModalOpen(true);
      return;
    }

    setWavesLoading(true);
    setStats(prev => ({ ...prev, error: null }));
    try {
      const signer = new Signer({ NODE_URL });
      signer.setProvider(new ProviderKeeper() as any);
      const wavesUser = await signer.login();
      const address = wavesUser.address;

      if (user) {
        await updateDoc(doc(db, 'users', user.uid), { walletAddress: address });
        setProfileForm(prev => ({ ...prev, walletAddress: address }));
      } else {
        try {
          const anon = await signInAnonymously(auth);
          const userRef = doc(db, 'users', anon.user.uid);
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            await setDoc(userRef, {
              email: 'anonymous@waves.' + address.slice(-8),
              balance: 0,
              isAdmin: false,
              isSuspended: false,
              profileCompleted: false,
              walletAddress: address,
              createdAt: new Date().toISOString()
            });
          } else {
            await updateDoc(userRef, { walletAddress: address });
          }
        } catch (anonErr: any) {
          if (anonErr.code === 'auth/admin-restricted-operation') {
            throw new Error('Anonymous authentication is disabled in Firebase Console. Please sign in with Google first.');
          }
          throw anonErr;
        }
      }
    } catch (e: any) {
      console.warn('Waves login notice:', e);
      // If Keeper was missing or failed during login attempt, show helper modal
      setIsWavesModalOpen(true);
    } finally {
      setWavesLoading(false);
    }
  };

  const logout = () => signOut(auth);

  const startExtraction = async () => {
    if (stats.isExtracting) return;

    if (profile?.isSuspended) {
      setIsSuspendedModalOpen(true);
      return;
    }
    
    // Check initial balance vs preview limit
    const PREVIEW_LIMIT = 100;
    if (!profile || (profile.balance <= 0 && addresses.size >= PREVIEW_LIMIT)) {
      setStats(prev => ({ ...prev, error: addresses.size >= PREVIEW_LIMIT ? 'Preview limit reached. Please deposit to continue.' : 'Insufficient balance.' }));
      setIsDepositModalOpen(true);
      return;
    }

    extractionRef.current = true;
    setStats(prev => ({ ...prev, isExtracting: true, error: null }));
    
    let height = lastScannedHeight || stats.currentHeight;
    // If we're starting fresh but have a current height, start from top
    if (height === 0 && stats.currentHeight > 0) height = stats.currentHeight;
    
    let foundAddresses: Set<string> = new Set(addresses);
    let processed = 0;
    let lastWriteCount = foundAddresses.size;
    let lastAutoDownloadCount = foundAddresses.size;
    let lastAutoPoolCount = foundAddresses.size;

    try {
      while (extractionRef.current && foundAddresses.size < TARGET_ADDRESS_COUNT && height > 1) {
        // Preview/Balance enforcement
        if (profile && profile.balance <= 0 && foundAddresses.size >= PREVIEW_LIMIT) {
          setStats(prev => ({ ...prev, error: 'Preview limit reached. Upgrade to continue extraction.' }));
          break;
        }

        const from = Math.max(1, height - BATCH_SIZE + 1);
        const to = height;
        
        let blocks = null;
        try {
          blocks = await fetchWithRetry(`${NODE_URL}/blocks/seq/${from}/${to}`, 5, 2000);
          setStats(prev => ({ ...prev, error: null })); 
        } catch (err) {
          if (!extractionRef.current) break;
          throw err;
        }

        if (!blocks || !extractionRef.current) continue;
        
        for (const block of blocks.reverse()) {
          if (!extractionRef.current) break;
          if (block.transactions) {
            for (const tx of block.transactions) {
              if (tx.sender) foundAddresses.add(tx.sender);
              if (tx.recipient) {
                const recipient = typeof tx.recipient === 'string' ? tx.recipient : tx.recipient.address || tx.recipient.alias;
                if (recipient && typeof recipient === 'string' && !recipient.startsWith('alias:')) {
                   foundAddresses.add(recipient);
                }
              }
              if (tx.transfers) {
                tx.transfers.forEach((t: any) => {
                  if (t.recipient) {
                    const r = typeof t.recipient === 'string' ? t.recipient : t.recipient.address || t.recipient.alias;
                    if (r && typeof r === 'string' && !r.startsWith('alias:')) foundAddresses.add(r);
                  }
                });
              }
              if (tx.caller) foundAddresses.add(tx.caller);
              if (tx.leaseId && tx.recipient) {
                 const r = typeof tx.recipient === 'string' ? tx.recipient : tx.recipient.address || tx.recipient.alias;
                 if (r && typeof r === 'string' && !r.startsWith('alias:')) foundAddresses.add(r);
              }
            }
          }
          processed++;
          height--; 

          if (profile && profile.balance > 0 && foundAddresses.size - lastWriteCount >= 100) {
            const batchSize = foundAddresses.size - lastWriteCount;
            const cost = batchSize * PRICE_PER_ADDRESS;
            if (profile.balance < cost) {
              setStats(prev => ({ ...prev, error: 'Insufficient balance to continue extraction.' }));
              break;
            }
            try {
              await updateDoc(doc(db, 'users', user!.uid), {
                balance: increment(-cost),
                updatedAt: new Date().toISOString()
              });
              lastWriteCount = foundAddresses.size;
            } catch (err) {
              handleFirestoreError(err, OperationType.UPDATE, `users/${user!.uid}`);
            }
          }

          if (foundAddresses.size >= TARGET_ADDRESS_COUNT) break;
          if (profile && profile.balance <= 0 && foundAddresses.size >= PREVIEW_LIMIT) break;
          if (profile?.isSuspended) break;
        }
        
        setLastScannedHeight(height);
        setAddresses(new Set(foundAddresses));
        setStats(prev => ({ ...prev, addressesFound: foundAddresses.size, blocksProcessed: processed }));
        setProgress(Math.min(100, (foundAddresses.size / TARGET_ADDRESS_COUNT) * 100));

        // Auto-download every 5000 addresses
        if (Math.floor(foundAddresses.size / 5000) > Math.floor(lastAutoDownloadCount / 5000)) {
          const batchIndex = Math.floor(foundAddresses.size / 5000);
          const allArr = Array.from(foundAddresses);
          const batch = allArr.slice(lastAutoDownloadCount, foundAddresses.size);
          
          if (batch.length > 0) {
            const csvContent = "Address\n" + batch.join("\n");
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `waves_batch_${batchIndex}_${batch.length}.csv`;
            link.click();
            lastAutoDownloadCount = foundAddresses.size;
          }
        }

        // Auto-contribute incremental batches until goal
        if (foundAddresses.size - lastAutoPoolCount >= 500 && globalStats.totalUniqueWallets < COMMUNITY_GOAL) {
          const allArr = Array.from(foundAddresses);
          const batch = new Set(allArr.slice(lastAutoPoolCount, foundAddresses.size));
          if (batch.size > 0) {
            addToPool(batch);
            lastAutoPoolCount = foundAddresses.size;
          }
        }

        await new Promise(resolve => setTimeout(resolve, 50)); 
      }
    } catch (err: any) {
      console.error('Extraction error:', err);
      // If it's our wrapped firestore error, it already contains the message
      const errorMsg = err.message.startsWith('{') ? 'Database Error: Check connection or permissions.' : 'Connection lost: Please resume when stable.';
      setStats(prev => ({ ...prev, error: errorMsg }));
    } finally {
      // Final balance sync for remaining addresses ONLY if user has balance
      if (profile && profile.balance > 0 && foundAddresses.size > lastWriteCount) {
        const remainingBatch = foundAddresses.size - lastWriteCount;
        const remainingCost = remainingBatch * PRICE_PER_ADDRESS;
        
        if (profile.balance >= remainingCost) {
          await updateDoc(doc(db, 'users', user!.uid), {
            balance: increment(-remainingCost),
            updatedAt: new Date().toISOString()
          }).catch((err) => {
             console.warn('Final balance sync failed:', err);
          });
        }
      }
      
      extractionRef.current = false;
      setStats(prev => ({ ...prev, isExtracting: false }));

      // Final auto-contribution for remaining addresses
      if (foundAddresses.size > lastAutoPoolCount && globalStats.totalUniqueWallets < COMMUNITY_GOAL) {
        const allArr = Array.from(foundAddresses);
        const batch = new Set(allArr.slice(lastAutoPoolCount, foundAddresses.size));
        if (batch.size > 0) {
          addToPool(batch);
          lastAutoPoolCount = foundAddresses.size;
        }
      }
    }
  };

  const stopExtraction = () => { extractionRef.current = false; };

  const downloadCSV = async () => {
    const csvContent = "Address\n" + Array.from(addresses).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `waves_addresses_${addresses.size}.csv`;
    link.click();
  };

  const handleDepositRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (depositStep < 4) {
      setDepositStep(prev => prev + 1);
      return;
    }

    const formData = new FormData(e.currentTarget);
    const amount = Number(depositData.amount);
    const currency = depositData.currency;
    const proof = formData.get('proof') as string;

    if (!user) return;

    try {
      await addDoc(collection(db, 'deposits'), {
        userId: user.uid,
        userEmail: user.email,
        amount,
        currency,
        proof,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      setIsDepositModalOpen(false);
      setDepositStep(1);
      setDepositData({ amount: '', currency: 'WAVES' });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'deposits');
    }
  };

  const WALLET_ADDRESSES: Record<string, string> = {
    WAVES: '3P8RSKe6ryJqZFkzX82NZSMUdhhjrm9ZhXT',
    BIOTECH: '3P8RSKe6ryJqZFkzX82NZSMUdhhjrm9ZhXT',
    BTC: '174oU95LyW2bXF6XRyLshqGvqR6fQTMca8',
    ETH: '0x8dA48345F7f638DD50a4E36624C62958087f37E8',
    SOL: 'Aqx5vPzPD9aswkw3k4Q9fVPtzsNSoAHoKf2kDcCPeA9A',
    USDT: '0x8dA48345F7f638DD50a4E36624C62958087f37E8'
  };

  const addToPool = async (customAddresses?: Set<string> | unknown) => {
    const list = (customAddresses instanceof Set) ? customAddresses : addresses;
    if (!user || !list || !(list instanceof Set) || list.size === 0) return;
    try {
      const addrCount = list.size;
      
      const addrArr = Array.from(list);
      await addDoc(collection(db, 'shared_files'), {
        label: `Auto-Contribution - Extraction ${new Date().toLocaleTimeString()} ${new Date().toLocaleDateString()}`,
        addressCount: addrCount,
        addresses: addrArr,
        fileUrl: '#',
        createdAt: new Date().toISOString()
      });

      // Update global counter
      await setDoc(doc(db, 'global_stats', 'wallets'), {
        totalUniqueWallets: increment(addrCount),
        updatedAt: new Date().toISOString()
      }, { merge: true });

      if (!(customAddresses instanceof Set)) {
        alert('Contributed to Community Pool!');
      }
    } catch (e) {
      console.error('Pool contribution failed:', e);
    }
  };

  const approveDeposit = async (dep: Deposit) => {
    try {
      await updateDoc(doc(db, 'deposits', dep.id), { status: 'approved' });
      await updateDoc(doc(db, 'users', dep.userId), {
        balance: increment(dep.amount)
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `deposits/users`);
    }
  };

  const rejectDeposit = async (depId: string) => {
    try {
      await updateDoc(doc(db, 'deposits', depId), { status: 'rejected' });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `deposits/${depId}`);
    }
  };

  const downloadSharedFileCSV = (file: SharedFile) => {
    const list = file.addresses && file.addresses.length > 0 ? file.addresses : [];
    if (list.length === 0) {
      alert('This batch has no stored address rows.');
      return;
    }
    const csvContent = "Address\n" + list.join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file.label.replace(/[^a-zA-Z0-9_-]/g, '_')}_${list.length}.csv`;
    link.click();
  };

  const exportCombinedPoolCSV = () => {
    const combinedSet = new Set<string>();
    sharedFiles.forEach(f => {
      if (f.addresses && Array.isArray(f.addresses)) {
        f.addresses.forEach(a => combinedSet.add(a));
      }
    });
    // Also include currently extracted addresses if in memory
    addresses.forEach(a => combinedSet.add(a));

    if (combinedSet.size === 0) {
      alert('No addresses currently registered in the community pool batches.');
      return;
    }

    const csvContent = "Address\n" + Array.from(combinedSet).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `waves_community_master_pool_${combinedSet.size}_wallets.csv`;
    link.click();
  };

  const completeProfile = async () => {
    if (!user || !profile) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      const updateData: any = {
        ...profileForm,
        age: profileForm.age ? parseInt(profileForm.age) : null,
      };

      if (!profile.profileCompleted) {
        updateData.profileCompleted = true;
        updateData.balance = profile.balance + 2.5;
      }

      await updateDoc(userRef, updateData);
      alert('Profile updated! ' + (!profile.profileCompleted ? '$2.50 credit reward applied.' : ''));
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const toggleUserSuspension = async (uId: string, current: boolean) => {
    try {
      await updateDoc(doc(db, 'users', uId), { isSuspended: !current });
    } catch (e) {
      alert('Action failed');
    }
  };

  const exportAllUsersCSV = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const users = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const headers = ['UID', 'Email', 'Name', 'Phone', 'Age', 'Gender', 'Country', 'Purpose', 'Balance', 'IsSuspended', 'CreatedAt'];
      const rows = users.map(u => [
        u.id,
        u.email,
        u.name || '',
        u.phone || '',
        u.age || '',
        u.gender || '',
        u.country || '',
        u.purpose || '',
        u.balance,
        u.isSuspended,
        u.createdAt
      ]);
      const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `users_export_${new Date().toISOString()}.csv`;
      a.click();
    } catch (e) {
      alert('Export failed');
    }
  };

  if (!user && activeTab !== 'landing') {
    setActiveTab('landing');
  }

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="w-8 h-8 text-cyan-500 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-mono p-4 md:p-8 flex flex-col items-center selection:bg-cyan-500/30">
      <div className="max-w-4xl w-full space-y-8">
        
        {/* Navigation Bar */}
        <div ref={menuRef} className="relative z-50">
          <div className="flex items-center justify-between bg-neutral-900/70 p-2.5 rounded-2xl border border-neutral-800/80 backdrop-blur-xl sticky top-4 shadow-2xl">
            {/* Branding & Custom Brand Emblem */}
            <div 
              className="flex items-center space-x-2.5 px-2 cursor-pointer group" 
              onClick={() => { setActiveTab('landing'); setIsMenuOpen(false); }}
            >
              <BrandLogo className="w-8 h-8 group-hover:scale-105 transition-transform" />
              <div className="flex flex-col">
                <span className="font-bold text-sm tracking-tight leading-none">
                  WAVES<span className="text-cyan-400">EXTRACT</span>
                </span>
                <span className="text-[9px] text-neutral-400 font-bold uppercase tracking-widest mt-0.5">
                  {activeTab === 'landing' ? 'Home' : activeTab === 'main' ? 'Scanner' : activeTab === 'profile' ? 'Profile' : activeTab === 'deposits' ? 'Wallet' : activeTab === 'assets' ? 'Media' : 'Admin'}
                </span>
              </div>
            </div>

            {/* Top Navigation Menu Trigger Button */}
            <button 
              onClick={() => setIsMenuOpen(prev => !prev)}
              className={`flex items-center space-x-2 px-3 py-2 rounded-xl text-xs font-black transition-all border ${
                isMenuOpen 
                  ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.35)]' 
                  : 'bg-neutral-800/90 text-white border-neutral-700/80 hover:bg-neutral-700 hover:border-neutral-600'
              }`}
              title="Open Navigation Menu"
              aria-label="Navigation Menu"
              aria-expanded={isMenuOpen}
            >
              {isMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4 text-cyan-400" />}
              <span className="tracking-wider uppercase text-[11px]">Menu</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isMenuOpen ? 'rotate-180 text-black' : 'text-neutral-400'}`} />
            </button>
          </div>

          {/* Top Navigation Menu Dropdown / Panel */}
          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.98 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="absolute top-full left-0 right-0 mt-2 bg-neutral-900/95 border border-neutral-800/90 rounded-3xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.8)] backdrop-blur-2xl z-50 overflow-hidden"
              >
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-800/80 px-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Navigation Hub</span>
                    <span className="text-[9px] bg-cyan-500/10 text-cyan-400 font-bold px-2 py-0.5 rounded-full border border-cyan-500/20">
                      Waves v2.4
                    </span>
                  </div>
                  <button 
                    onClick={() => setIsMenuOpen(false)}
                    className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Account / Google Login Block inside Menu */}
                <div className="mb-4 bg-neutral-950/80 border border-neutral-800/80 p-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-3">
                  {user ? (
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center font-black text-cyan-400 text-xs">
                          {user.email ? user.email.slice(0, 2).toUpperCase() : 'W'}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-black uppercase tracking-tight text-white truncate max-w-[200px]">
                            {user.email || 'Authenticated User'}
                          </div>
                          <div className="flex items-center space-x-2 text-[10px] text-neutral-400 mt-0.5">
                            <span>Balance: <strong className="text-cyan-400">${profile?.balance?.toFixed(2) || '0.00'}</strong></span>
                            {profile?.walletAddress && (
                              <>
                                <span>•</span>
                                <span className="truncate max-w-[120px] font-mono text-[9px] text-emerald-400" title={profile.walletAddress}>
                                  {profile.walletAddress}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          logout();
                          setIsMenuOpen(false);
                        }} 
                        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/20 text-[10px] font-black uppercase transition-all"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between w-full">
                      <div>
                        <div className="text-xs font-black uppercase tracking-tight text-white">Guest Access</div>
                        <div className="text-[10px] text-neutral-400">Sign in to unlock full scanner and saved extractions</div>
                      </div>
                      <button 
                        onClick={() => {
                          login();
                          setIsMenuOpen(false);
                        }}
                        className="flex items-center space-x-2 bg-white hover:bg-cyan-400 text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md active:scale-95"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        <span>Google Sign In</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {/* Home Tab */}
                  <button
                    onClick={() => { setActiveTab('landing'); setIsMenuOpen(false); }}
                    className={`flex items-start space-x-3 p-3.5 rounded-2xl text-left transition-all border ${
                      activeTab === 'landing'
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-white shadow-lg shadow-cyan-500/5'
                        : 'bg-neutral-950/60 border-neutral-800/80 hover:bg-neutral-800 hover:border-neutral-700 text-neutral-300'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl ${activeTab === 'landing' ? 'bg-cyan-500 text-black' : 'bg-neutral-800 text-cyan-400'}`}>
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wider">Home & Overview</span>
                        {activeTab === 'landing' && <span className="text-[9px] font-black text-cyan-400 uppercase">Active</span>}
                      </div>
                      <p className="text-[10px] text-neutral-500 font-medium line-clamp-1 mt-0.5">Platform metrics, ROI calculator & methodology</p>
                    </div>
                  </button>

                  {/* Scanner Tab */}
                  <button
                    onClick={() => {
                      if (!user) { login(); return; }
                      setActiveTab('main');
                      setIsMenuOpen(false);
                    }}
                    className={`flex items-start space-x-3 p-3.5 rounded-2xl text-left transition-all border ${
                      activeTab === 'main'
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-white shadow-lg shadow-cyan-500/5'
                        : 'bg-neutral-950/60 border-neutral-800/80 hover:bg-neutral-800 hover:border-neutral-700 text-neutral-300'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl ${activeTab === 'main' ? 'bg-cyan-500 text-black' : 'bg-neutral-800 text-emerald-400'}`}>
                      <Activity className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wider">Scanner Engine</span>
                        {activeTab === 'main' && <span className="text-[9px] font-black text-cyan-400 uppercase">Active</span>}
                      </div>
                      <p className="text-[10px] text-neutral-500 font-medium line-clamp-1 mt-0.5">Live block sequence wallet extraction</p>
                    </div>
                  </button>

                  {/* Profile Tab */}
                  <button
                    onClick={() => {
                      if (!user) { login(); return; }
                      setActiveTab('profile');
                      setIsMenuOpen(false);
                    }}
                    className={`flex items-start space-x-3 p-3.5 rounded-2xl text-left transition-all border ${
                      activeTab === 'profile'
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-white shadow-lg shadow-cyan-500/5'
                        : 'bg-neutral-950/60 border-neutral-800/80 hover:bg-neutral-800 hover:border-neutral-700 text-neutral-300'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl ${activeTab === 'profile' ? 'bg-cyan-500 text-black' : 'bg-neutral-800 text-purple-400'}`}>
                      <User className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wider">Strategic Profile</span>
                        {!profile?.profileCompleted && <span className="text-[9px] font-black text-emerald-400 uppercase">+$2.50</span>}
                      </div>
                      <p className="text-[10px] text-neutral-500 font-medium line-clamp-1 mt-0.5">Identity, Waves wallet sync & reward</p>
                    </div>
                  </button>

                  {/* Deposits / Wallet Tab */}
                  <button
                    onClick={() => {
                      if (!user) { login(); return; }
                      setActiveTab('deposits');
                      setIsMenuOpen(false);
                    }}
                    className={`flex items-start space-x-3 p-3.5 rounded-2xl text-left transition-all border ${
                      activeTab === 'deposits'
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-white shadow-lg shadow-cyan-500/5'
                        : 'bg-neutral-950/60 border-neutral-800/80 hover:bg-neutral-800 hover:border-neutral-700 text-neutral-300'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl ${activeTab === 'deposits' ? 'bg-cyan-500 text-black' : 'bg-neutral-800 text-amber-400'}`}>
                      <Wallet className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wider">Wallet & Deposits</span>
                        {activeTab === 'deposits' && <span className="text-[9px] font-black text-cyan-400 uppercase">Active</span>}
                      </div>
                      <p className="text-[10px] text-neutral-500 font-medium line-clamp-1 mt-0.5">Manage balances, proofs and credits</p>
                    </div>
                  </button>

                  {/* Media / Assets Tab */}
                  <button
                    onClick={() => {
                      if (!user) { login(); return; }
                      setActiveTab('assets');
                      setIsMenuOpen(false);
                    }}
                    className={`flex items-start space-x-3 p-3.5 rounded-2xl text-left transition-all border ${
                      activeTab === 'assets'
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-white shadow-lg shadow-cyan-500/5'
                        : 'bg-neutral-950/60 border-neutral-800/80 hover:bg-neutral-800 hover:border-neutral-700 text-neutral-300'
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl ${activeTab === 'assets' ? 'bg-cyan-500 text-black' : 'bg-neutral-800 text-pink-400'}`}>
                      <Megaphone className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wider">Promotional Media</span>
                        {activeTab === 'assets' && <span className="text-[9px] font-black text-cyan-400 uppercase">Active</span>}
                      </div>
                      <p className="text-[10px] text-neutral-500 font-medium line-clamp-1 mt-0.5">Custom promo banners & airdrop assets</p>
                    </div>
                  </button>

                  {/* Admin Tab (if admin) */}
                  {profile?.isAdmin && (
                    <button
                      onClick={() => {
                        setActiveTab('admin');
                        setIsMenuOpen(false);
                      }}
                      className={`flex items-start space-x-3 p-3.5 rounded-2xl text-left transition-all border ${
                        activeTab === 'admin'
                          ? 'bg-cyan-500/15 border-cyan-500/50 text-white shadow-lg shadow-cyan-500/5'
                          : 'bg-neutral-950/60 border-neutral-800/80 hover:bg-neutral-800 hover:border-neutral-700 text-neutral-300'
                      }`}
                    >
                      <div className={`p-2.5 rounded-xl ${activeTab === 'admin' ? 'bg-cyan-500 text-black' : 'bg-neutral-800 text-yellow-400'}`}>
                        <Crown className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black uppercase tracking-wider">Admin Console</span>
                          <span className="text-[9px] font-black text-yellow-400 uppercase">Master</span>
                        </div>
                        <p className="text-[10px] text-neutral-500 font-medium line-clamp-1 mt-0.5">Manage node suspensions & user records</p>
                      </div>
                    </button>
                  )}
                </div>

                {/* Footer bar inside menu */}
                <div className="mt-4 pt-3 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-3 px-2">
                  <div className="flex items-center space-x-3 text-[10px] text-neutral-400">
                    <span>Block Height: <strong className="text-cyan-400">{stats.currentHeight ? stats.currentHeight.toLocaleString() : 'Connecting...'}</strong></span>
                    <span>•</span>
                    <span>Fee: <strong className="text-white">${PRICE_PER_ADDRESS}</strong> / addr</span>
                  </div>
                  {user && (
                    <button
                      onClick={() => {
                        setIsDepositModalOpen(true);
                        setIsMenuOpen(false);
                      }}
                      className="flex items-center space-x-1.5 bg-cyan-500 text-black px-3 py-1.5 rounded-xl text-[10px] font-black uppercase hover:bg-cyan-400 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Deposit Funds</span>
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {activeTab === 'landing' && (
          <motion.div 
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: { 
                opacity: 1,
                transition: { staggerChildren: 0.15 }
              }
            }}
            className="space-y-24 py-12"
          >
            {/* Hero Section */}
            <motion.section 
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0 }
              }}
              className="text-center space-y-8"
            >
              <div className="inline-block px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 rounded-full">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-500">Waves Protocol v2.4 Analytical Suite</span>
              </div>
              <h1 className="text-5xl md:text-8xl font-black text-white leading-tight tracking-tighter">
                Ecosystem Growth <br/> 
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400 animate-pulse">Data Controlled.</span>
              </h1>
              <p className="text-neutral-400 max-w-2xl mx-auto text-sm md:text-lg leading-relaxed font-medium">
                The most advanced active wallet extraction protocol for the Waves network. identify real contributors, optimize community health, and launch hyper-targeted campaigns.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                <button onClick={user ? () => setActiveTab('main') : login} className="w-full sm:w-auto bg-white text-black px-10 py-5 rounded-2xl font-black uppercase tracking-widest hover:bg-cyan-400 transition-all flex items-center justify-center space-x-3 shadow-[0_0_50px_rgba(255,255,255,0.05)] hover:shadow-cyan-500/20 group active:scale-95">
                  <span>{user ? 'Enter Dashboard' : 'Get Started Free'}</span>
                  <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-2" />
                </button>
                <a href="#calculator" className="w-full sm:w-auto px-10 py-5 rounded-2xl border border-neutral-800 font-black uppercase tracking-widest hover:bg-neutral-900 transition-all text-xs">
                  ROI CALCULATOR
                </a>
              </div>
            </motion.section>

            {/* Liquidity Calculator Section */}
            <motion.section 
              id="calculator"
              variants={{
                hidden: { opacity: 0, scale: 0.95 },
                visible: { opacity: 1, scale: 1 }
              }}
              className="bg-neutral-900 border border-neutral-800 rounded-[3rem] p-8 md:p-16 relative overflow-hidden shadow-2xl"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.1),transparent)]" />
              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h2 className="text-4xl font-black uppercase tracking-tighter text-white">Liquidity Potential</h2>
                    <p className="text-neutral-500 uppercase font-black tracking-widest text-[10px]">Financial Impact Projection v1.0</p>
                  </div>
                  <p className="text-sm text-neutral-400 leading-relaxed font-medium">
                    Our data indicates that a single active contributor identified by the WAVESEXTRACT engine contributes an average of <span className="text-white font-bold">$25.00 USD</span> in initial liquidity or trading volume to new ecosystem projects.
                  </p>
                  <div className="bg-cyan-500/5 border border-cyan-500/10 p-4 rounded-2xl space-y-2">
                    <h4 className="text-[10px] font-black uppercase text-cyan-500 tracking-widest flex items-center space-x-2">
                      <AlertCircle className="w-3 h-3" />
                      <span>Benchmark Methodology</span>
                    </h4>
                    <p className="text-[9px] text-neutral-500 leading-tight uppercase font-bold">
                      Calculated as the <span className="text-neutral-400">Retail Engagement Value (REV)</span> baseline—derived from historical on-chain analysis of verified unique retail participants in Waves-based community launches over the last 18 months.
                    </p>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-black uppercase text-neutral-500 tracking-widest">
                      <span>Target Extractions</span>
                      <span className="text-white">{calcWallets.toLocaleString()} Wallets</span>
                    </div>
                    <input 
                      type="range" 
                      min="100" 
                      max="30000" 
                      step="100"
                      value={calcWallets}
                      onChange={(e) => setCalcWallets(Number(e.target.value))}
                      className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                  </div>
                </div>

                <div className="bg-black/50 border border-neutral-800 p-8 md:p-12 rounded-[2rem] text-center space-y-4 shadow-inner">
                  <div className="space-y-1">
                    <p className="text-[10px] text-cyan-500 font-bold uppercase tracking-[0.3em]">Estimated Ecosystem Value</p>
                    <div className="text-4xl md:text-6xl font-black text-white tracking-tighter tabular-nums">
                      ${(calcWallets * 25).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center justify-center space-x-2 text-[10px] font-black uppercase tracking-widest text-emerald-500">
                    <TrendingUp className="w-4 h-4" />
                    <span>Potential USD Liquidity Growth</span>
                  </div>
                  <div className="pt-6 border-t border-neutral-800">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-left">
                        <p className="text-[9px] text-neutral-500 font-bold uppercase">Efficiency Rate</p>
                        <p className="text-sm font-black text-white">94.2%</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] text-neutral-500 font-bold uppercase">ROI Multiplier</p>
                        <p className="text-sm font-black text-white">12.5x</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.section>

            {/* Strategic Pillars */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  icon: <ShieldCheck className="w-8 h-8 text-cyan-500" />,
                  title: "Community Resilience",
                  desc: "Filter out the noise. Our scanner identifies high-activity nodes, allowing you to build trust with real stakeholders who stabilize the network."
                },
                {
                  icon: <TrendingUp className="w-8 h-8 text-emerald-500" />,
                  title: "Airdrop Efficiency",
                  desc: "Why spray and pray? Export pinpoint-accurate lists to ensure your marketing budget reaches users who will actually hold and provide TVL."
                },
                {
                  icon: <Layers className="w-8 h-8 text-amber-500" />,
                  title: "Protocol Health",
                  desc: "Deep-packet scanning helps visualize decentralization metrics and prevents whale domination through address transparency."
                }
              ].map((card, idx) => (
                <motion.div 
                  key={idx}
                  variants={{
                    hidden: { opacity: 0, y: 30 },
                    visible: { opacity: 1, y: 0 }
                  }}
                  whileHover={{ y: -10 }}
                >
                  <LandingCard 
                    icon={card.icon}
                    title={card.title}
                    desc={card.desc}
                  />
                </motion.div>
              ))}
            </section>

            {/* Deep Dive Section */}
            <motion.section 
              variants={{
                hidden: { opacity: 0, x: -20 },
                visible: { opacity: 1, x: 0 }
              }}
              className="bg-neutral-900/50 border border-neutral-800 rounded-[2.5rem] p-8 md:p-12 overflow-hidden relative group"
            >
              <div className="absolute top-0 right-0 p-12 opacity-[0.05] pointer-events-none group-hover:scale-110 transition-transform duration-700">
                <Database className="w-64 h-64 text-cyan-500" />
              </div>
              <div className="max-w-xl space-y-6 relative z-10">
                <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Why precision matters?</h2>
                <div className="space-y-4 text-sm text-neutral-400 leading-relaxed">
                  <p>In a saturated market, every transaction counts. Traditional airdrops lose up to <span className="text-white font-bold">85% of their impact</span> due to inactive wallets and sybil bots.</p>
                  <p>Our Waves extraction engine bypasses "zombie nodes" by analyzing real-time block sequencing. When you use <span className="text-cyan-500 font-bold">WAVESEXTRACT</span>, you aren't just getting list of addresses; you're getting a snapshot of momentum.</p>
                </div>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {['Real-time Node Interaction', 'Institutional Security', 'Community Data Pool', 'Zero-Latency Extraction'].map(item => (
                    <li key={item} className="flex items-center space-x-3 text-[10px] font-black uppercase tracking-widest text-emerald-500">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.section>

            {/* CTA Section */}
            {!user && (
              <motion.section 
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0 }
                }}
                className="text-center py-12 space-y-6"
              >
                <h3 className="text-3xl font-black uppercase tracking-tighter">Ready to scale your ecosystem?</h3>
                <p className="text-neutral-500 text-sm font-bold uppercase tracking-widest">Join 50+ token creators already optimizing their growth.</p>
                <button onClick={login} className="bg-cyan-500 text-black px-12 py-5 rounded-2xl font-black uppercase tracking-[0.2em] hover:bg-cyan-400 transition-all shadow-[0_0_60px_rgba(6,182,212,0.15)] active:scale-95">
                  Launch analytical engine now
                </button>
              </motion.section>
            )}
          </motion.div>
        )}

        {activeTab === 'profile' && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Strategic Profile</h2>
                  <p className="text-xs text-neutral-500 font-bold uppercase tracking-widest mt-1">Complete your identity to unlock rewards</p>
                </div>
                {!profile?.profileCompleted && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-xl flex items-center space-x-2">
                    <TrendingUp className="w-4 h-4 text-emerald-500 shadow-sm" />
                    <span className="text-[10px] font-black text-emerald-500 uppercase">+$2.50 Credit Reward Available</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest px-2">Full Name</label>
                    <input type="text" value={profileForm.name} onChange={(e) => setProfileForm(v => ({ ...v, name: e.target.value }))} placeholder="Crypto Pioneer" className="w-full bg-black border border-neutral-800 rounded-2xl px-5 py-4 focus:border-cyan-500 outline-none transition-all font-bold text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest px-2">Phone Number</label>
                    <input type="tel" value={profileForm.phone} onChange={(e) => setProfileForm(v => ({ ...v, phone: e.target.value }))} placeholder="+1 (555) 000-0000" className="w-full bg-black border border-neutral-800 rounded-2xl px-5 py-4 focus:border-cyan-500 outline-none transition-all font-bold text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest px-2">Age</label>
                      <input type="number" value={profileForm.age} onChange={(e) => setProfileForm(v => ({ ...v, age: e.target.value }))} placeholder="24" className="w-full bg-black border border-neutral-800 rounded-2xl px-5 py-4 focus:border-cyan-500 outline-none transition-all font-bold text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest px-2">Gender</label>
                      <select value={profileForm.gender} onChange={(e) => setProfileForm(v => ({ ...v, gender: e.target.value }))} className="w-full bg-black border border-neutral-800 rounded-2xl px-5 py-4 focus:border-cyan-500 outline-none transition-all font-bold text-sm">
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                        <option value="prefer_not_to_say">Prefer not to say</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest px-2">Country</label>
                    <input type="text" value={profileForm.country} onChange={(e) => setProfileForm(v => ({ ...v, country: e.target.value }))} placeholder="United States" className="w-full bg-black border border-neutral-800 rounded-2xl px-5 py-4 focus:border-cyan-500 outline-none transition-all font-bold text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest px-2">Why do u use this service?</label>
                    <select value={profileForm.purpose} onChange={(e) => setProfileForm(v => ({ ...v, purpose: e.target.value }))} className="w-full bg-black border border-neutral-800 rounded-2xl px-5 py-4 focus:border-cyan-500 outline-none transition-all font-bold text-sm">
                      <option value="Community Health">To measure community health</option>
                      <option value="Token Owner">I'm a token owner</option>
                      <option value="Airdrop Campaigns">To perform airdrop campaigns</option>
                      <option value="Data Company">Data Company</option>
                      <option value="Government Agency">Government Agency</option>
                      <option value="Investor">Investor</option>
                    </select>
                  </div>
                  <div className="space-y-1 pt-1">
                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-widest px-2">WX.Network Wallet (Signer)</label>
                    <div className="relative group">
                      <input 
                        type="text" 
                        readOnly
                        value={profileForm.walletAddress} 
                        placeholder="Not connected" 
                        className="w-full bg-black border border-neutral-800 rounded-2xl px-5 py-4 focus:border-cyan-500 outline-none transition-all font-mono text-xs text-neutral-400" 
                      />
                      <button 
                        onClick={loginWithWaves}
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-neutral-800 hover:bg-cyan-500 hover:text-black text-neutral-400 px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-all"
                      >
                        {profileForm.walletAddress ? 'Sync Wallet' : 'Connect Wallet'}
                      </button>
                    </div>
                  </div>
                  <div className="pt-2">
                    <button onClick={completeProfile} className="w-full bg-cyan-500 text-black py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-cyan-400 transition-all shadow-[0_0_30px_rgba(6,182,212,0.1)]">
                      {profile?.profileCompleted ? 'Update Profile' : 'Complete & Claim $2.50 Reward'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'admin' && profile?.isAdmin && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <button onClick={exportAllUsersCSV} className="flex items-center justify-center space-x-3 bg-emerald-500 text-black px-6 py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-emerald-400 transition-all">
                <Download className="w-5 h-5" />
                <span>Export All Users (CSV)</span>
              </button>
              <div className="bg-neutral-900 border border-neutral-800 px-6 py-4 rounded-2xl flex items-center justify-between">
                <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">Total Registered Nodes</span>
                <span className="text-xl font-black text-white">{allUsers.length}</span>
              </div>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-black/50 text-[10px] uppercase font-black tracking-widest text-neutral-500 border-b border-neutral-800">
                    <tr>
                      <th className="px-6 py-4">Identity</th>
                      <th className="px-6 py-4">Strategic Data</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {allUsers.map(u => (
                      <tr key={u.email} className={`text-sm ${u.isSuspended ? 'bg-red-500/5 opacity-80' : ''}`}>
                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs ${u.isAdmin ? 'bg-cyan-500 text-black' : 'bg-neutral-800 text-neutral-500'}`}>
                              {u.email[0].toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-white">{u.email}</div>
                              <div className="text-[10px] text-neutral-500 font-mono uppercase">{u.name || 'Anonymous User'}</div>
                              {u.walletAddress && (
                                <div className="text-[9px] text-cyan-500 font-mono bg-cyan-500/5 px-1 rounded flex items-center space-x-1 mt-0.5 max-w-[120px]">
                                  <Box className="w-3 h-3 shrink-0" />
                                  <span className="truncate">{u.walletAddress}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-[10px] text-neutral-400 font-bold uppercase tracking-tight">
                            {u.country || 'N/A'} • {u.purpose || 'Retail'} • ${u.balance.toFixed(2)}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button 
                            onClick={() => toggleUserSuspension((u as any).id, u.isSuspended)} 
                            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${
                              u.isSuspended ? 'bg-emerald-500 text-black hover:bg-emerald-400' : 'bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white border border-red-500/20'
                            }`}
                          >
                            {u.isSuspended ? 'Unsuspend' : 'Suspend Node'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'main' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            
            {profile && profile.balance <= 0 && addresses.size < 100 && (
              <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                  <div>
                    <h3 className="text-xs font-black uppercase text-amber-500 tracking-widest">Free Preview Mode Active</h3>
                    <p className="text-[9px] text-amber-400/60 uppercase font-bold tracking-tight">Try the scanner up to 100 wallets before deposit.</p>
                  </div>
                </div>
                <button onClick={() => setIsDepositModalOpen(true)} className="text-[10px] font-black uppercase bg-amber-500 text-black px-3 py-1.5 rounded-lg hover:bg-amber-400 transition-colors">Deposit Now</button>
              </div>
            )}

            {/* Dashboard Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard label="Found" value={stats.addressesFound.toLocaleString()} sub={`/ ${TARGET_ADDRESS_COUNT.toLocaleString()}`} icon={<Database />} progress={progress} />
              <StatCard label="Network Height" value={stats.currentHeight.toLocaleString()} sub={`v2.4`} icon={<Activity />} pulse />
              <StatCard label="Account Balance" value={`$${profile?.balance?.toFixed(2) || '0.00'}`} sub={`Fee: $${PRICE_PER_ADDRESS} / addr`} icon={<Wallet />} action={() => setIsDepositModalOpen(true)} />
            </div>

            {/* Controls */}
            <div className="flex flex-col md:flex-row gap-4">
              {!stats.isExtracting ? (
                <button 
                  onClick={startExtraction} 
                  disabled={progress >= 100} 
                  className="flex-1 bg-white text-black font-black uppercase tracking-widest px-8 py-4 rounded-xl flex flex-col items-center justify-center hover:bg-cyan-400 transition-colors h-20 group relative overflow-hidden"
                >
                  <div className="flex items-center space-x-3">
                    <Play className="w-5 h-5 fill-current" />
                    <span>{progress >= 100 ? "Completed" : progress > 0 ? "Resume Extraction" : "Initiate Extraction"}</span>
                  </div>
                  <div className="text-[9px] opacity-70 font-black mt-1 uppercase tracking-tighter">Target: 10,000 Holder Milestone (99% Success Path)</div>
                </button>
              ) : (
                <button onClick={stopExtraction} className="flex-1 bg-red-500 text-white font-black uppercase tracking-widest px-8 py-4 rounded-xl flex items-center justify-center space-x-3 hover:bg-red-600 transition-all h-20">
                  <Square className="w-5 h-5 fill-current" />
                  <span>Terminate Process</span>
                </button>
              )}

              <button 
                onClick={downloadCSV} 
                disabled={addresses.size === 0} 
                className="md:w-auto bg-neutral-900 border border-neutral-800 text-white font-black uppercase tracking-widest px-8 py-4 rounded-xl flex flex-col items-center justify-center hover:bg-neutral-800 transition-all h-20 disabled:opacity-30 disabled:cursor-not-allowed group"
              >
                <div className="flex items-center space-x-3">
                  <Download className="w-5 h-5" />
                  <span>{profile && profile.balance <= 0 && addresses.size <= 100 ? 'Download Trial List' : 'Download Found Wallets'}</span>
                </div>
                <div className="text-[9px] text-neutral-500 font-black mt-1 leading-none uppercase tracking-tighter">
                  {profile && profile.balance <= 0 && addresses.size <= 100 ? 'Zero Fee (Welcome Pack)' : `Usage Fee Paid Live: $${(addresses.size * PRICE_PER_ADDRESS).toFixed(2)}`}
                </div>
              </button>
            </div>

            <AnimatePresence>
              {stats.error && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center space-x-3">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  <p className="text-red-400 text-xs font-bold uppercase">{stats.error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="bg-neutral-800/50 px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileJson className="w-4 h-4 text-cyan-500" />
                  <span className="text-[10px] uppercase tracking-tighter font-bold text-neutral-400">Stream Analytics</span>
                </div>
                {stats.isExtracting && <div className="flex items-center space-x-2"><Loader2 className="w-3 h-3 animate-spin text-cyan-500" /></div>}
              </div>
              <div className="p-4 h-48 overflow-y-auto scrollbar-thin space-y-2 text-[11px]">
                {Array.from(addresses).slice(-50).reverse().map((addr, i) => (
                  <div key={addr} className="flex items-center space-x-3 text-neutral-500">
                    <span className="text-cyan-500/30">#{addresses.size - i}</span>
                    <span className="truncate flex-1">{addr}</span>
                    <div className="w-1 h-3 bg-emerald-500/20 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'deposits' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Transaction History</h2>
              <div className="flex items-center space-x-4">
                <div className="text-[10px] text-neutral-500 uppercase font-black tracking-widest text-right">
                  System Policy:<br/><span className="text-red-500">Non-Refundable</span>
                </div>
                <button onClick={() => setIsDepositModalOpen(true)} className="flex items-center space-x-2 bg-cyan-500 text-black px-4 py-2 rounded-lg font-bold text-sm">
                  <Plus className="w-4 h-4" />
                  <span>Add Funds</span>
                </button>
              </div>
            </div>
            
            <div className="grid gap-3">
              {deposits.length === 0 ? (
                <div className="p-12 text-center text-neutral-600 border border-dashed border-neutral-800 rounded-2xl">No deposits found.</div>
              ) : (
                deposits.map(d => (
                  <div key={d.id} className="bg-neutral-900 p-4 rounded-xl border border-neutral-800 flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        d.status === 'approved' ? 'bg-emerald-500/10 text-emerald-500' : 
                        d.status === 'rejected' ? 'bg-red-500/10 text-red-500' : 
                        'bg-yellow-500/10 text-yellow-500'
                      }`}>
                        {d.status === 'approved' ? <CheckCircle2 className="w-5 h-5" /> : d.status === 'rejected' ? <XCircle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                      </div>
                      <div>
                        <div className="font-bold text-sm">${d.amount.toFixed(2)} {d.currency}</div>
                        <div className="text-[10px] text-neutral-500 truncate max-w-[150px]">{d.proof}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold uppercase">{d.status}</div>
                      <div className="text-[10px] text-neutral-600">{new Date(d.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'assets' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 pb-20">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="space-y-2">
                <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Ad Creative Suite</h2>
                <p className="text-neutral-500 text-xs uppercase font-bold tracking-widest">Optimized for high-conversion crypto networks</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <BannerItem width={336} height={280} label="Large Rectangle" />
              <BannerItem width={300} height={250} label="Medium Rectangle" />
              <BannerItem width={320} height={100} label="Mobile Leaderboard" />
            </div>
          </motion.div>
        )}

        {activeTab === 'admin' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12 pb-20">
            <div className="space-y-4">
              <h2 className="text-3xl font-black uppercase text-white tracking-tighter">System Administration</h2>
              <div className="flex items-center space-x-2">
                <span className="text-neutral-500 text-xs uppercase font-bold tracking-widest">Global Community Goal:</span>
                <span className="text-cyan-500 text-xs font-black">{globalStats.totalUniqueWallets.toLocaleString()} / {COMMUNITY_GOAL.toLocaleString()} Unique Wallets</span>
              </div>
              <div className="w-full h-2 bg-neutral-900 rounded-full overflow-hidden border border-neutral-800">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (globalStats.totalUniqueWallets / COMMUNITY_GOAL) * 100)}%` }}
                  className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500"
                />
              </div>
            </div>

            {/* Section 1: Pending Deposits */}
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Wallet className="w-5 h-5 text-cyan-500" />
                <h3 className="font-black uppercase text-sm tracking-widest">Deposit Verification</h3>
              </div>
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-800/50 text-neutral-400">
                    <tr>
                      <th className="p-4 uppercase tracking-tighter">Account</th>
                      <th className="p-4 uppercase tracking-tighter">Amount</th>
                      <th className="p-4 uppercase tracking-tighter">Asset</th>
                      <th className="p-4 uppercase tracking-tighter">Proof / Hash</th>
                      <th className="p-4 uppercase tracking-tighter text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {adminDeposits.filter(d => d.status === 'pending').map(d => (
                      <tr key={d.id} className="hover:bg-neutral-800/30 transition-colors">
                        <td className="p-4 truncate max-w-[120px]">{d.userEmail}</td>
                        <td className="p-4 font-black text-white">${d.amount.toFixed(2)}</td>
                        <td className="p-4 text-cyan-500 font-bold">{d.currency}</td>
                        <td className="p-4 font-mono text-[10px] max-w-[150px] truncate">
                          <a href={d.proof.startsWith('http') ? d.proof : '#'} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-500 underline">
                            {d.proof}
                          </a>
                        </td>
                        <td className="p-4">
                          <div className="flex justify-end space-x-2">
                            <button onClick={() => approveDeposit(d)} className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg"><CheckCircle2 className="w-5 h-5" /></button>
                            <button onClick={() => rejectDeposit(d.id)} className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg"><XCircle className="w-5 h-5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {adminDeposits.filter(d => d.status === 'pending').length === 0 && (
                  <div className="p-12 text-center text-neutral-600 uppercase font-black tracking-widest text-[10px]">No Pending Verifications</div>
                )}
              </div>
            </div>

            {/* Section 2: Community Pool Management & 200k Master Pool */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center space-x-2">
                  <Database className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-black uppercase text-sm tracking-widest text-white">Community 200,000 Wallet Pool Library</h3>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={exportCombinedPoolCSV}
                    className="flex items-center space-x-2 bg-cyan-500 hover:bg-cyan-400 text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-cyan-500/10 active:scale-95"
                    title="Export all unique wallets collected across all pool batches into a single master CSV"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export Master Pool (CSV)</span>
                  </button>
                </div>
              </div>
              
              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-neutral-950/70 border border-neutral-800/80 p-4 rounded-xl">
                    <span className="text-[10px] uppercase font-black text-neutral-400 tracking-widest block">Total Batches Stored</span>
                    <span className="text-xl font-black text-white">{sharedFiles.length} Batches</span>
                  </div>
                  <div className="bg-neutral-950/70 border border-neutral-800/80 p-4 rounded-xl">
                    <span className="text-[10px] uppercase font-black text-neutral-400 tracking-widest block">Target Goal Capacity</span>
                    <span className="text-xl font-black text-emerald-400">{COMMUNITY_GOAL.toLocaleString()} Wallets</span>
                  </div>
                  <div className="bg-neutral-950/70 border border-neutral-800/80 p-4 rounded-xl">
                    <span className="text-[10px] uppercase font-black text-neutral-400 tracking-widest block">Accumulated Master Pool</span>
                    <span className="text-xl font-black text-cyan-400">{globalStats.totalUniqueWallets.toLocaleString()} Wallets</span>
                  </div>
                </div>

                <p className="text-xs text-neutral-400 leading-relaxed font-medium">
                  This curated library stores decentralized wallet extractions. Administrators can inspect individual batches, search through addresses, or download the consolidated master CSV for airdrops and ecosystem distributions.
                </p>
                
                {/* Batch Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sharedFiles.map(file => (
                    <div key={file.id} className="bg-neutral-800/50 border border-neutral-700/80 p-4 rounded-xl flex items-center justify-between group hover:border-cyan-500/40 transition-all">
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                          <FileJson className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-black uppercase text-white truncate max-w-[180px] sm:max-w-[220px]" title={file.label}>
                            {file.label}
                          </div>
                          <div className="text-[10px] text-neutral-400 font-bold flex items-center space-x-2 mt-0.5">
                            <span className="text-cyan-400">{(file.addressCount || 0).toLocaleString()} Wallets</span>
                            <span>•</span>
                            <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                        <button 
                          onClick={() => {
                            setSelectedAdminFile(file);
                            setAdminSearchQuery('');
                            setAdminPage(1);
                          }}
                          className="px-2.5 py-1.5 bg-neutral-700/60 hover:bg-cyan-500 hover:text-black rounded-lg text-[10px] font-black uppercase text-neutral-300 transition-colors flex items-center space-x-1"
                          title="View address list"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Inspect</span>
                        </button>
                        <button 
                          onClick={() => downloadSharedFileCSV(file)}
                          className="p-2 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white transition-colors"
                          title="Download batch CSV"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {sharedFiles.length === 0 && (
                    <div className="md:col-span-2 text-center p-8 text-neutral-500 text-xs font-bold uppercase tracking-widest border border-dashed border-neutral-800 rounded-xl">
                      Pool Empty — Run extraction or contribute batches below.
                    </div>
                  )}
                </div>

                <div className="pt-2 flex flex-col sm:flex-row gap-3">
                  <button 
                    onClick={() => addToPool()} 
                    disabled={addresses.size === 0} 
                    className="flex-1 bg-emerald-500 text-black font-black uppercase tracking-widest py-3.5 px-4 rounded-xl flex items-center justify-center space-x-2 hover:bg-emerald-400 transition-colors disabled:opacity-30"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Contribute Active Scanner ({addresses.size.toLocaleString()}) To Pool</span>
                  </button>
                  <button 
                    onClick={exportCombinedPoolCSV} 
                    className="bg-neutral-800 hover:bg-neutral-700 text-white font-black uppercase tracking-widest py-3.5 px-6 rounded-xl flex items-center justify-center space-x-2 transition-colors border border-neutral-700"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download All 200k Master Records</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Modal: Deposit */}
        <AnimatePresence>
          {isDepositModalOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsDepositModalOpen(false)} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]" />
              <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-neutral-900 border border-neutral-800 p-8 rounded-3xl z-[101] shadow-2xl">
                <form onSubmit={handleDepositRequest} className="space-y-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      {depositStep > 1 && (
                        <button 
                          type="button" 
                          onClick={() => setDepositStep(prev => prev - 1)}
                          className="p-2 -ml-2 bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors"
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>
                      )}
                      <div className="space-y-1">
                        <h3 className="text-xl font-black uppercase text-white tracking-tighter">Add Funds</h3>
                        <div className="flex items-center space-x-1">
                          {[1, 2, 3, 4].map(s => (
                            <div key={s} className={`h-1 rounded-full transition-all ${s <= depositStep ? 'w-6 bg-cyan-500' : 'w-2 bg-neutral-800'}`} />
                          ))}
                        </div>
                      </div>
                    </div>
                    <button type="button" onClick={() => setIsDepositModalOpen(false)} className="p-2 text-neutral-500 hover:text-white"><XCircle className="w-6 h-6" /></button>
                  </div>

                  {depositStep === 1 && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                      <p className="text-[10px] uppercase font-black text-neutral-500 tracking-widest">Step 1: Select Protocol</p>
                      <div className="grid grid-cols-2 gap-3">
                        {['WAVES', 'BIOTECH', 'BTC', 'ETH', 'SOL', 'USDT'].map(cur => (
                          <button 
                            key={cur}
                            type="button" 
                            onClick={() => setDepositData(prev => ({ ...prev, currency: cur }))}
                            className={`p-4 rounded-xl border text-[10px] font-black transition-all ${depositData.currency === cur ? 'bg-cyan-500 border-cyan-500 text-black shadow-[0_0_20px_rgba(6,182,212,0.3)]' : 'bg-neutral-800 border-neutral-700 text-neutral-400'}`}
                          >
                            <div className="flex flex-col items-center">
                              <span>{cur === 'BIOTECH' ? 'BIOTECH (WAVES)' : cur}</span>
                              {livePrices[cur] && (
                                <span className={`text-[8px] mt-1 ${depositData.currency === cur ? 'text-black/60' : 'text-neutral-500'}`}>
                                  ${livePrices[cur].toLocaleString()}
                                </span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {depositStep === 2 && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                      <p className="text-[10px] uppercase font-black text-neutral-500 tracking-widest">Step 2: Enter Amount (USD)</p>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 font-bold">$</span>
                        <input 
                          required 
                          autoFocus
                          type="number" 
                          placeholder="0.00"
                          value={depositData.amount}
                          onChange={e => setDepositData(prev => ({ ...prev, amount: e.target.value }))}
                          className="w-full bg-neutral-800 border border-neutral-700 rounded-xl pl-8 pr-4 py-4 focus:border-cyan-500 outline-none text-xl font-bold" 
                        />
                      </div>
                      <div className="bg-cyan-500/5 border border-cyan-500/10 p-3 rounded-xl">
                        <p className="text-[9px] text-cyan-500 font-bold uppercase tracking-wider text-center">
                          Equivalent: {livePrices[depositData.currency] && depositData.amount ? (Number(depositData.amount) / livePrices[depositData.currency]).toFixed(6) : '0.000000'} {depositData.currency}
                        </p>
                      </div>
                    </motion.div>
                  )}

                  {depositStep === 3 && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6 text-center">
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase font-black text-neutral-500 tracking-widest">Step 3: Transfer Required Funds</p>
                        <div className="bg-white p-4 rounded-2xl inline-block shadow-2xl overflow-hidden">
                          <QRCodeSVG 
                            value={WALLET_ADDRESSES[depositData.currency]} 
                            size={160}
                            level="H"
                            includeMargin={false}
                          />
                        </div>
                        <div className="mt-2">
                          <p className="text-xl font-black text-white">
                            {livePrices[depositData.currency] && depositData.amount ? (Number(depositData.amount) / livePrices[depositData.currency]).toFixed(6) : '0.000000'} {depositData.currency}
                          </p>
                          <p className="text-[9px] text-neutral-500 uppercase font-black tracking-widest mt-1">Live Rate: 1 {depositData.currency} = ${livePrices[depositData.currency]?.toLocaleString()} USD</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-[9px] text-neutral-500 uppercase font-black">Destination Wallet</p>
                        <div className="bg-neutral-800 p-4 rounded-xl border border-neutral-700 font-mono text-xs break-all relative group cursor-pointer" onClick={() => {
                          navigator.clipboard.writeText(WALLET_ADDRESSES[depositData.currency]);
                        }}>
                          {WALLET_ADDRESSES[depositData.currency]}
                          <div className="absolute inset-0 bg-cyan-500 opacity-0 group-hover:opacity-10 flex items-center justify-center transition-opacity rounded-lg">
                            <Clipboard className="w-5 h-5 text-white" />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {depositStep === 4 && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                      <p className="text-[10px] uppercase font-black text-neutral-500 tracking-widest">Step 4: Verification Hash</p>
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase font-black text-neutral-500">Transaction Hash / Explorer Link</label>
                        <textarea 
                          required 
                          name="proof" 
                          placeholder="Paste txid or blockchain explorer url..."
                          className="w-full h-32 bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 focus:border-cyan-500 outline-none text-xs font-mono resize-none transition-colors"
                        />
                      </div>
                    </motion.div>
                  )}

                  <div className="flex gap-3">
                    <button type="submit" className={`w-full bg-cyan-500 text-black py-4 rounded-xl font-black uppercase tracking-widest hover:bg-cyan-400 transition-colors flex items-center justify-center space-x-2 ${depositStep === 4 ? 'shadow-[0_0_20px_rgba(6,182,212,0.4)]' : ''}`}>
                      <span>{depositStep === 4 ? 'Confirm Deposit' : 'Continue'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              </motion.div>
            </>
          )}

          {isSuspendedModalOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110]"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }} 
                animate={{ opacity: 1, scale: 1, y: 0 }} 
                exit={{ opacity: 0, scale: 0.9, y: 20 }} 
                className="fixed inset-0 m-auto w-full max-w-md h-fit bg-neutral-900 border border-red-500/20 p-8 rounded-[2.5rem] shadow-[0_0_50px_rgba(239,68,68,0.1)] z-[120] text-center space-y-6"
              >
                <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
                  <AlertTriangle className="w-10 h-10 text-red-500" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-black uppercase tracking-tighter text-white">Access Restricted</h2>
                  <p className="text-neutral-400 text-sm font-medium leading-relaxed">Your node has been suspended for violating system protocols or suspected abuse. Please contact support to appeal this decision.</p>
                </div>
                <button onClick={() => setIsSuspendedModalOpen(false)} className="w-full bg-neutral-800 text-white py-4 rounded-xl font-black uppercase tracking-widest hover:bg-neutral-700 transition-colors">
                  Close Notice
                </button>
              </motion.div>
            </>
          )}
          {isWavesModalOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                onClick={() => setIsWavesModalOpen(false)}
                className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110]"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }} 
                animate={{ opacity: 1, scale: 1, y: 0 }} 
                exit={{ opacity: 0, scale: 0.9, y: 20 }} 
                className="fixed inset-0 m-auto w-full max-w-md h-fit max-h-[90vh] overflow-y-auto bg-neutral-900 border border-neutral-800 p-6 md:p-8 rounded-[2rem] shadow-2xl z-[120] space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                      <Box className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black uppercase text-white tracking-tight">Connect Waves Wallet</h3>
                      <p className="text-[10px] text-neutral-400 uppercase font-bold tracking-wider">WX.Network & Keeper Integration</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsWavesModalOpen(false)} 
                    className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="bg-neutral-950/80 border border-neutral-800/80 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center space-x-2 text-[11px] font-black uppercase text-cyan-400">
                    <Box className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>Waves Wallet Address</span>
                  </div>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    Enter your Waves mainnet address below to associate your account with your wallet.
                  </p>
                </div>

                {/* Direct address entry only */}
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block">
                    Waves Wallet Address
                  </label>
                  <div className="space-y-3">
                    <input 
                      type="text"
                      value={manualWalletAddress}
                      onChange={(e) => setManualWalletAddress(e.target.value)}
                      placeholder="e.g. 3P... (Waves mainnet address)"
                      className="w-full bg-black border border-neutral-800 rounded-xl px-4 py-3 text-xs font-mono text-white placeholder-neutral-600 focus:border-cyan-500 outline-none transition-all"
                    />
                    <button
                      onClick={() => connectWalletWithAddress(manualWalletAddress)}
                      disabled={wavesLoading || !manualWalletAddress.trim()}
                      className="w-full bg-cyan-500 hover:bg-cyan-400 text-black py-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-40 flex items-center justify-center space-x-2 shadow-lg shadow-cyan-500/10"
                    >
                      {wavesLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      <span>Save & Link Wallet Address</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            </>
          )}
          {selectedAdminFile && (
            <>
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                onClick={() => setSelectedAdminFile(null)}
                className="fixed inset-0 bg-black/85 backdrop-blur-md z-[130]"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }} 
                animate={{ opacity: 1, scale: 1, y: 0 }} 
                exit={{ opacity: 0, scale: 0.95, y: 20 }} 
                className="fixed inset-0 m-auto w-full max-w-2xl h-[85vh] bg-neutral-900 border border-neutral-800 p-6 rounded-[2rem] shadow-2xl z-[140] flex flex-col space-y-4"
              >
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-xl">
                      <FileJson className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-black uppercase text-white tracking-tight">{selectedAdminFile.label}</h3>
                      <p className="text-[10px] text-neutral-400 uppercase font-bold tracking-wider mt-0.5">
                        {(selectedAdminFile.addresses?.length || selectedAdminFile.addressCount || 0).toLocaleString()} Registered Wallets • Created {new Date(selectedAdminFile.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => downloadSharedFileCSV(selectedAdminFile)}
                      className="flex items-center space-x-1.5 bg-cyan-500 hover:bg-cyan-400 text-black px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all shadow-md"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download CSV</span>
                    </button>
                    <button 
                      onClick={() => setSelectedAdminFile(null)}
                      className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Search in Batch */}
                <div className="relative">
                  <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input 
                    type="text"
                    value={adminSearchQuery}
                    onChange={(e) => {
                      setAdminSearchQuery(e.target.value);
                      setAdminPage(1);
                    }}
                    placeholder="Search address or prefix..."
                    className="w-full bg-black border border-neutral-800 rounded-xl pl-10 pr-4 py-2.5 text-xs font-mono text-white placeholder-neutral-600 focus:border-cyan-500 outline-none transition-all"
                  />
                </div>

                {/* Address List View */}
                <div className="flex-1 bg-black/60 border border-neutral-800 rounded-xl p-3 overflow-y-auto font-mono text-xs divide-y divide-neutral-900 scrollbar-thin">
                  {(() => {
                    const addrs = (selectedAdminFile.addresses && selectedAdminFile.addresses.length > 0)
                      ? selectedAdminFile.addresses
                      : [];
                    const filtered = adminSearchQuery.trim()
                      ? addrs.filter(a => a.toLowerCase().includes(adminSearchQuery.toLowerCase().trim()))
                      : addrs;

                    const pageSize = 50;
                    const totalPages = Math.ceil(filtered.length / pageSize) || 1;
                    const currentPage = Math.min(adminPage, totalPages);
                    const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

                    if (addrs.length === 0) {
                      return (
                        <div className="py-12 text-center text-neutral-500 font-sans text-xs">
                          This older contribution batch recorded {selectedAdminFile.addressCount.toLocaleString()} count in stats. Newly contributed batches preserve full row-by-row address indexes.
                        </div>
                      );
                    }

                    if (filtered.length === 0) {
                      return (
                        <div className="py-12 text-center text-neutral-500 font-sans text-xs">
                          No addresses match "{adminSearchQuery}"
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-neutral-500 pb-2 px-2 uppercase font-black tracking-widest font-sans">
                          <span>Showing {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} Wallets</span>
                          <div className="flex items-center space-x-1">
                            <button
                              disabled={currentPage <= 1}
                              onClick={() => setAdminPage(p => Math.max(1, p - 1))}
                              className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 rounded text-white"
                            >
                              Prev
                            </button>
                            <span className="px-1 text-cyan-400">{currentPage}/{totalPages}</span>
                            <button
                              disabled={currentPage >= totalPages}
                              onClick={() => setAdminPage(p => Math.min(totalPages, p + 1))}
                              className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 rounded text-white"
                            >
                              Next
                            </button>
                          </div>
                        </div>

                        {paged.map((addr, idx) => (
                          <div key={addr + idx} className="py-1.5 px-2 flex items-center justify-between hover:bg-neutral-900 rounded group">
                            <div className="flex items-center space-x-3 text-neutral-300">
                              <span className="text-[10px] text-neutral-600 w-8">#{(currentPage - 1) * pageSize + idx + 1}</span>
                              <span className="truncate">{addr}</span>
                            </div>
                            <button 
                              onClick={() => navigator.clipboard.writeText(addr)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-cyan-400 text-neutral-500 text-[10px] uppercase font-bold transition-opacity"
                              title="Copy to clipboard"
                            >
                              <Clipboard className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

      </div>
      
      <style>{`
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: #262626; border-radius: 10px; }
      `}</style>
    </div>
  );
}

function BannerItem({ width, height, label }: { width: number, height: number, label: string }) {
  const isWide = width / height > 2.5;

  return (
    <div className={`space-y-3 ${isWide ? 'md:col-span-2' : ''}`}>
      <div className="flex items-center justify-between px-2">
        <span className="text-[10px] font-black text-white uppercase tracking-widest">{label}</span>
        <span className="text-[9px] font-mono text-neutral-600">{width}x{height}</span>
      </div>
      <div 
        className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden flex items-center justify-center p-4 md:p-6 min-h-[120px] shadow-inner"
      >
        <motion.div 
          initial={{ borderColor: 'rgba(6,182,212,0.1)' }}
          animate={{ borderColor: ['rgba(6,182,212,0.1)', 'rgba(6,182,212,0.4)', 'rgba(6,182,212,0.1)'] }}
          transition={{ duration: 3, repeat: Infinity }}
          style={{ 
            width: '100%', 
            maxWidth: width, 
            height: 'auto', 
            aspectRatio: `${width}/${height}` 
          }}
          className="bg-black border rounded-lg shadow-2xl relative overflow-hidden flex items-center justify-center text-center p-3 group cursor-pointer"
        >
          {/* Background Grid */}
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #06b6d4 1px, transparent 0)', backgroundSize: '16px 16px' }} />
          
          {/* Animated Scanning Line */}
          <motion.div 
            animate={{ top: ['-10%', '110%'] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
            className="absolute left-0 right-0 h-[2px] bg-cyan-500/40 blur-[2px] z-20 pointer-events-none"
          />

          <div className="relative z-10 flex flex-col items-center justify-center h-full w-full">
            <div className={`${isWide ? 'flex items-center justify-center gap-4' : 'space-y-1'}`}>
              <div className="space-y-1">
                <motion.h4 
                  animate={{ opacity: [1, 0.8, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="text-white font-black uppercase tracking-tighter leading-tight" 
                  style={{ fontSize: isWide ? Math.max(10, width / 20) : Math.max(12, width / 12) }}
                >
                  WAVES SCANNER
                </motion.h4>
                <div className="h-[2px] w-8 bg-cyan-500 mx-auto" />
              </div>
              
              <div className={`${isWide ? 'text-left' : 'space-y-1 mt-1'}`}>
                <p className="text-cyan-400 font-bold uppercase tracking-widest" style={{ fontSize: isWide ? Math.max(6, width / 45) : Math.max(7, width / 28) }}>
                  Extract Active Wallets<br/>For Crypto Promo
                </p>
                <motion.div 
                  whileHover={{ scale: 1.05 }}
                  className="bg-cyan-500 text-black font-black uppercase px-2 py-0.5 rounded inline-block mt-1"
                  style={{ fontSize: isWide ? Math.max(5, width / 55) : Math.max(6, width / 35) }}
                >
                  Start Airdrop Campaign
                </motion.div>
              </div>
            </div>
          </div>

          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 via-cyan-500/5 to-cyan-500/0 opacity-50 pointer-events-none" />
        </motion.div>
      </div>
    </div>
  );
}

function LandingCard({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-3xl space-y-4 hover:border-cyan-500/30 transition-all group shadow-xl">
      <div className="bg-neutral-800 w-16 h-16 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h3 className="text-lg font-black uppercase tracking-tighter text-white">{title}</h3>
      <p className="text-neutral-500 text-xs leading-relaxed font-medium uppercase tracking-tight">{desc}</p>
    </div>
  );
}

function NavBtn({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button onClick={onClick} className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
      active ? 'bg-white text-black shadow-lg' : 'text-neutral-500 hover:text-white hover:bg-neutral-800'
    }`}>
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function StatCard({ label, value, sub, icon, progress, pulse, action }: { label: string, value: string, sub: string, icon: React.ReactNode, progress?: number, pulse?: boolean, action?: () => void }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden group">
      <div className="absolute -top-2 -right-2 p-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-neutral-500 text-[10px] uppercase tracking-widest font-black leading-none">{label}</p>
        <div className="flex items-center space-x-2">
          <span className="text-2xl font-bold tabular-nums line-clamp-1">{value}</span>
          {pulse && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />}
        </div>
        <p className="text-neutral-600 text-[10px] font-bold">{sub}</p>
      </div>
      {typeof progress === 'number' && (
        <div className="mt-4 w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
          <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} className="h-full bg-cyan-500" />
        </div>
      )}
      {action && (
        <button onClick={action} className="mt-4 w-full flex items-center justify-center space-x-2 bg-neutral-800 hover:bg-cyan-500 hover:text-black py-2 rounded-lg transition-all text-[10px] font-bold uppercase tracking-widest text-neutral-400">
          <Plus className="w-3 h-3" />
          <span>Add Funds</span>
        </button>
      )}
    </div>
  );
}

function BrandLogo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 via-cyan-500 to-emerald-400 p-[1.5px] shadow-[0_0_20px_rgba(6,182,212,0.45)] ${className}`}>
      <div className="w-full h-full bg-neutral-950 rounded-[10px] flex items-center justify-center overflow-hidden relative">
        {/* Ambient subtle glow background */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(6,182,212,0.25),transparent_70%)]" />
        
        {/* Custom Precision Vector Emblem: Intersecting cryptographic wave facets */}
        <svg 
          viewBox="0 0 36 36" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
          className="w-[82%] h-[82%] relative z-10"
        >
          <defs>
            <linearGradient id="brandGradPrimary" x1="4" y1="6" x2="32" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#22d3ee" />
              <stop offset="0.5" stopColor="#06b6d4" />
              <stop offset="1" stopColor="#10b981" />
            </linearGradient>
            <linearGradient id="brandGradSecondary" x1="18" y1="4" x2="18" y2="32" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="1" stopColor="#06b6d4" stopOpacity="0.4" />
            </linearGradient>
          </defs>

          {/* Outer faceted geometric circuit diamond */}
          <path 
            d="M18 4L31 18L18 32L5 18L18 4Z" 
            stroke="url(#brandGradPrimary)" 
            strokeWidth="1.8" 
            strokeLinejoin="round"
            className="opacity-70"
          />

          {/* Dynamic cryptographic Waves soundwave/extraction frequency bars */}
          <path 
            d="M11 20L14 13L18 23L22 13L25 20" 
            stroke="url(#brandGradSecondary)" 
            strokeWidth="2.4" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
          />

          {/* Core quantum node pulse */}
          <circle cx="18" cy="18" r="2.2" fill="#22d3ee" className="animate-pulse" />

          {/* Corner anchor nodes */}
          <circle cx="18" cy="4" r="1.5" fill="#22d3ee" />
          <circle cx="31" cy="18" r="1.5" fill="#10b981" />
          <circle cx="18" cy="32" r="1.5" fill="#10b981" />
          <circle cx="5" cy="18" r="1.5" fill="#22d3ee" />
        </svg>
      </div>
    </div>
  );
}

