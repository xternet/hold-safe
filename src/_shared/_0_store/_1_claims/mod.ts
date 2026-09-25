import { copyValue, type Claim } from "../../../_kernel/mod";
import { guard, JournalError, lockPolicy, type Db } from "../_shared/mod";

type Row = { policy_id: string; worker_id: string; fence: string; lease_until: Date };
function mapped(row: Row): Claim {
  return { policyDigest: row.policy_id, workerId: row.worker_id, fence: String(row.fence), leaseUntilMs: row.lease_until.getTime() };
}
function duration(leaseMs: number): void {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 100 || leaseMs > 60_000) throw new JournalError("Claim lease must be 100–60000 milliseconds");
}
export async function claim(sql: Db, digest: string, workerId: string, leaseMs: number): Promise<Claim | null> {
  duration(leaseMs);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(workerId)) throw new JournalError("Invalid worker ID");
  return sql.begin(async tx => {
    await lockPolicy(tx, digest);
    const rows = await tx<Row[]>`insert into solstock_guard.policy_claims(policy_id,worker_id,fence,lease_until)
      values(${digest},${workerId},1,clock_timestamp()+${leaseMs}*interval '1 millisecond')
      on conflict(policy_id) do update set worker_id=excluded.worker_id,fence=solstock_guard.policy_claims.fence+1,
        lease_until=clock_timestamp()+${leaseMs}*interval '1 millisecond'
      where solstock_guard.policy_claims.lease_until<=clock_timestamp() returning *`;
    return rows[0] === undefined ? null : mapped(rows[0]);
  });
}
export async function renew(sql: Db, input: Claim, leaseMs: number): Promise<Claim> {
  const claim = copyValue(input); duration(leaseMs);
  return sql.begin(async tx => {
    await guard(tx, claim);
    const rows = await tx<Row[]>`update solstock_guard.policy_claims set lease_until=clock_timestamp()+${leaseMs}*interval '1 millisecond'
      where policy_id=${claim.policyDigest} returning *`;
    if (rows[0] === undefined) throw new JournalError("Claim disappeared during renewal");
    return mapped(rows[0]);
  });
}
export async function release(sql: Db, input: Claim): Promise<void> {
  const claim = copyValue(input);
  await sql.begin(async tx => {
    await guard(tx, claim);
    await tx`update solstock_guard.policy_claims set lease_until=clock_timestamp() where policy_id=${claim.policyDigest}`;
  });
}
