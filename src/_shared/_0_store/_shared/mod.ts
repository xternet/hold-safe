import type { SQL, TransactionSQL } from "bun";
import { type AttemptRecord, type AttemptState, type Claim, type NativeContext, type Policy,
  type PolicyRecord, type PolicyState, type Receipt } from "../../../_kernel/mod";

export type Db = SQL;
export type Tx = TransactionSQL;
export class JournalError extends Error {}
export type PolicyRow = { id: string; document: Policy; state: PolicyState };
export type AttemptRow = { id: string; policy_id: string; chain_namespace: string; network: string; native_id: string;
  transaction_bytes: Buffer; validity: NativeContext; state: AttemptState; previous_attempt: string | null;
  decision_id: string; receipt: Receipt | null };
export function policyRecord(row: PolicyRow): PolicyRecord { return { digest: row.id, document: row.document, state: row.state }; }
export function attemptRecord(row: AttemptRow): AttemptRecord {
  return { id: row.id, policyDigest: row.policy_id, state: row.state, previousId: row.previous_attempt,
    decisionId: row.decision_id, receipt: row.receipt, signed: { policyDigest: row.policy_id,
      chain: { namespace: row.chain_namespace, reference: row.network }, nativeId: row.native_id,
      bytesBase64: row.transaction_bytes.toString("base64"), validity: row.validity } };
}
export function json(value: unknown): unknown {
  const encoded = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (item === undefined || typeof item === "function" || typeof item === "symbol" ||
      (typeof item === "number" && !Number.isFinite(item))) throw new JournalError("Invalid journal evidence value");
    return item;
  });
  if (encoded === undefined) throw new JournalError("Missing journal evidence");
  return JSON.parse(encoded);
}
export function context(value: NativeContext): void {
  if (!value.adapter || !Number.isSafeInteger(value.version) || value.version < 1 || typeof value.serialized !== "string" ||
    value.serialized.length > 65536) throw new JournalError("Invalid native evidence context");
  const parsed: unknown = JSON.parse(value.serialized);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new JournalError("Native evidence must be an object");
}
export function uuid(value: string): void {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new JournalError("Invalid journal record ID");
}
export function identity(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new JournalError("Invalid policy digest");
}
export async function lockPolicy(sql: Tx, digest: string): Promise<PolicyRow> {
  identity(digest);
  const rows = await sql<PolicyRow[]>`select id,document,state from solstock_guard.policies where id=${digest} for update`;
  if (rows[0] === undefined) throw new JournalError("Policy not found");
  return rows[0];
}
export async function guard(sql: Tx, claim: Claim): Promise<PolicyRow> {
  if (!/^[1-9][0-9]*$/.test(claim.fence)) throw new JournalError("Invalid claim fence");
  const policy = await lockPolicy(sql, claim.policyDigest);
  const rows = await sql`select policy_id from solstock_guard.policy_claims
    where policy_id=${claim.policyDigest} and worker_id=${claim.workerId} and fence=${claim.fence}
      and lease_until>clock_timestamp() for update`;
  if (rows.length !== 1) throw new JournalError("Worker claim expired or superseded");
  return policy;
}
export async function event(sql: Tx, digest: string, kind: string, detail: unknown): Promise<void> {
  await sql`insert into solstock_guard.events(policy_id,kind,detail) values(${digest},${kind},${json(detail)}::jsonb)`;
}
export async function unresolved(sql: Tx, digest: string): Promise<boolean> {
  const rows = await sql`select id from solstock_guard.attempts where policy_id=${digest} and state in ('PREPARED','SUBMITTED','UNKNOWN')`;
  return rows.length !== 0;
}
export async function latest(sql: Db | Tx, digest: string): Promise<AttemptRecord | null> {
  identity(digest);
  // Retry lineage, rather than wall-clock timestamps, identifies the tail.
  const rows = await sql<AttemptRow[]>`select a.* from solstock_guard.attempts a where a.policy_id=${digest}
    and not exists(select 1 from solstock_guard.attempts b where b.previous_attempt=a.id)`;
  if (rows.length > 1) throw new JournalError("Ambiguous attempt lineage");
  return rows[0] === undefined ? null : attemptRecord(rows[0]);
}
