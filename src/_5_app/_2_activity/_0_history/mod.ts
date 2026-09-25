import { useEffect, useState } from "react";
import type { PolicyRecord } from "../../../_kernel/mod";
import { request } from "../../_shared/_0_service/mod";
import type { Login } from "../../_shared/_1_identity/mod";
export function useHistory(session: Login) {
  const [rows, setRows] = useState<PolicyRecord[]>([]), [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [more, setMore] = useState(false), [revision, setRevision] = useState(0);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1]!;
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    setRows([]); setLoading(true); setError(null); setMore(false);
    async function refresh() {
      try {
        const result = await request<PolicyRecord[]>("policies/list", { after: cursor, limit: 21 }, session.token, controller.signal);
        if (!Array.isArray(result) || result.length > 21 || result.some(row => row.document.owner !== session.wallet.owner)) throw new Error("Invalid policy history");
        if (!controller.signal.aborted) { setRows(result.slice(0, 20)); setMore(result.length > 20); setError(null); }
      } catch (cause) {
        if (!controller.signal.aborted) { setRows([]); setMore(false); setError(cause instanceof Error ? cause.message : "Policy history unavailable"); }
      } finally {
        if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(() => { void refresh(); }, 5000); }
      }
    }
    void refresh(); return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [session, cursor, revision]);
  return { rows, error, loading, more, page: cursors.length,
    next: () => { if (more && !loading && rows.length === 20) setCursors(value => [...value, rows[19]!.digest]); },
    previous: () => { if (!loading && cursors.length > 1) setCursors(value => value.slice(0, -1)); },
    refresh: () => setRevision(value => value + 1) };
}
