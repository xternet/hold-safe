import { useEffect, useRef, useState } from "react";
import { connectWallet, watchWallets, type BrowserWallet } from "../../../_adapters/_0_solana/_4_wallet/mod";
import type { WalletPort } from "../../../_kernel/mod";
import { request } from "../_0_service/mod";
export type Login = { wallet: WalletPort; token: string };
export function useIdentity() {
  const [wallets, setWallets] = useState<readonly BrowserWallet[]>([]), [session, setSession] = useState<Login | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const epoch = useRef(0), stop = useRef<(() => void) | null>(null);
  useEffect(() => { const unwatch = watchWallets(setWallets); return () => { epoch.current++; unwatch(); stop.current?.(); }; }, []);
  async function login(provider: BrowserWallet) {
    if (busy) return; setBusy(true); setError(null); const generation = ++epoch.current;
    try {
      const wallet = await connectWallet(provider);
      if (generation !== epoch.current) return;
      let token: string | null = null;
      stop.current?.();
      stop.current = wallet.onChange(() => {
        epoch.current++; setSession(null); setBusy(false); setError("Wallet account changed. Sign in again.");
        if (token !== null) void request("auth/logout", {}, token).catch(cause => {
          setError(`Wallet changed; session revocation failed: ${cause instanceof Error ? cause.message : "Service unavailable"}`);
        });
      });
      const challenge = await request<{ id: string; message: string }>("auth/challenge", { owner: wallet.owner });
      const signatureBase64 = await wallet.signMessage(challenge.message);
      const granted = await request<{ token: string }>("auth/verify", { id: challenge.id, signatureBase64 });
      if (generation !== epoch.current) { await request("auth/logout", {}, granted.token); return; }
      token = granted.token;
      setSession({ wallet, token: granted.token });
    } catch (cause) { if (generation === epoch.current) setError(cause instanceof Error ? cause.message : "Wallet sign-in failed"); }
    finally { if (generation === epoch.current) setBusy(false); }
  }
  async function logout() {
    const prior = session; epoch.current++; stop.current?.(); stop.current = null; setSession(null); setBusy(false);
    if (prior === null) return;
    try { await request("auth/logout", {}, prior.token); await prior.wallet.disconnect(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-out failed"); }
  }
  return { wallets, session, error, busy, login, logout };
}
