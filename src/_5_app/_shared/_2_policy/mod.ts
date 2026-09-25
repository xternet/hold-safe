import { useEffect, useRef, useState } from "react";
import { canonicalPolicy, policyDigest, type Catalog, type Policy, type PolicyView, type UnsignedTransaction } from "../../../_kernel/mod";
import { request } from "../_0_service/mod";
import type { Login } from "../_1_identity/mod";

export function usePolicy(session: Login, policy: Policy, digest: string, catalog: Catalog) {
  const [view, setView] = useState<PolicyView | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false);
  const [signature, setSignature] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => { controller.abort(); };
  }, [session, digest]);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function update() {
      try {
        const result = await request<PolicyView>("policies/status", { digest }, session.token, controller.signal);
        if (result.record.digest !== digest || result.record.document.owner !== session.wallet.owner ||
            canonicalPolicy(result.record.document) !== canonicalPolicy(policy) || await policyDigest(policy) !== digest) throw new Error("Policy status identity mismatch");
        if (!controller.signal.aborted) setView(result);
      } catch (cause) { if (!controller.signal.aborted) { setView(null); setError(cause instanceof Error ? cause.message : "Native status unavailable"); } }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => { void update(); }, 5000); }
    }
    void update(); return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [session, digest, revision]);
  async function send(purpose: "arm" | "revoke", maximumNetworkFeeRaw: string, replaceExistingApproval = false) {
    const controller = lifetime.current;
    if (busy || controller === null || controller.signal.aborted) return;
    setBusy(true); setError(null); if (purpose === "arm") setAttempted(true);
    try {
      const envelope = await request<UnsignedTransaction>(`policies/${purpose}`, { digest,
        ...(purpose === "arm" ? { replaceExistingApproval } : {}) }, session.token, controller.signal);
      controller.signal.throwIfAborted();
      const nativeId = await session.wallet.send(envelope, { owner: session.wallet.owner, policy, catalog,
        purpose, replaceExistingApproval, maximumNetworkFeeRaw, nowMs: Date.now() });
      if (!controller.signal.aborted) setSignature(nativeId);
    } catch (cause) {
      if (!controller.signal.aborted) setError(`${cause instanceof Error ? cause.message : "Wallet request failed"}. Inspect onchain status before retrying.`);
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setView(null); setRevision(value => value + 1); }
    }
  }
  return { view, error, busy, attempted, signature, send,
    native: view?.authorization.ok === true ? view.authorization.value.state : "unavailable",
    refresh: () => { setError(null); setView(null); setRevision(value => value + 1); } };
}
