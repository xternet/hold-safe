import { canonicalPolicy, copyValue, policyDigest, validatePolicy, type Catalog, type Claim,
  type NativeContext, type Policy, type PolicyState } from "../../../_kernel/mod";
import { context, event, guard, identity, json, JournalError, policyRecord, unresolved, type Db, type PolicyRow } from "../_shared/mod";

export async function readPolicy(sql: Db, digest: string) {
  identity(digest);
  const rows = await sql<PolicyRow[]>`select id,document,state from solstock_guard.policies where id=${digest}`;
  if (rows[0] === undefined) return null;
  if (await policyDigest(rows[0].document) !== digest) throw new JournalError("Stored policy digest mismatch");
  return policyRecord(rows[0]);
}
export async function putPolicy(sql: Db, catalog: Catalog, input: Policy) {
  const policy = copyValue(input); validatePolicy(policy, catalog, 0);
  const digest = await policyDigest(policy);
  return sql.begin(async tx => {
    await tx`insert into solstock_guard.policies(id,chain_namespace,network,order_id,owner_address,source_account,state,document)
      values(${digest},${policy.chain.namespace},${policy.chain.reference},${policy.orderId},${policy.owner},${policy.source},'DRAFT',${json(policy)}::jsonb)
      on conflict(id) do nothing`;
    const [row] = await tx<PolicyRow[]>`select id,document,state from solstock_guard.policies where id=${digest}`;
    if (row === undefined || canonicalPolicy(row.document) !== canonicalPolicy(policy)) throw new JournalError("Policy document conflict");
    return policyRecord(row);
  });
}
const transitions: Record<PolicyState, readonly PolicyState[]> = {
  DRAFT: ["ARMING"], ARMING: ["ARMED", "UNAVAILABLE", "REVOKED", "EXPIRED"],
  ARMED: ["UNAVAILABLE", "REVOKED", "EXPIRED"], UNAVAILABLE: ["ARMING", "ARMED", "REVOKED", "EXPIRED"],
  FAILED: ["ARMED", "UNAVAILABLE", "REVOKED", "EXPIRED"], TRIGGERED: [], SUBMITTED: [],
  CONFIRMED: [], REVOKED: [], EXPIRED: [],
};
export async function transition(sql: Db, input: Claim, expected: PolicyState, next: PolicyState, inputEvidence: NativeContext): Promise<void> {
  const claim = copyValue(input), evidence = copyValue(inputEvidence); context(evidence);
  if (!transitions[expected].includes(next)) throw new JournalError("Policy transition not permitted");
  await sql.begin(async tx => {
    if (expected === "DRAFT" && next === "ARMING") {
      // Serialize admission across processes; the worker/monitor cap is 128.
      await tx`select pg_advisory_xact_lock(73040702)`;
      const [capacity] = await tx`select count(*)::int as active from solstock_guard.policies
        where state not in ('DRAFT','CONFIRMED','REVOKED','EXPIRED')`;
      if (capacity === undefined || capacity.active >= 128) throw new JournalError("Monitoring capacity reached");
    }
    const current = await guard(tx, claim);
    if (current.state !== expected || await unresolved(tx, claim.policyDigest)) throw new JournalError("Policy state changed or attempt unresolved");
    await tx`update solstock_guard.policies set state=${next},updated_at=clock_timestamp() where id=${claim.policyDigest}`;
    await event(tx, claim.policyDigest, "POLICY_STATE", { expected, next, evidence, fence: claim.fence });
  });
}

export async function scanActive(sql: Db, after: string | null, limit: number) {
  if (after !== null) identity(after);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new JournalError("Active policy page must be 1–128 records");
  const rows = await sql<PolicyRow[]>`select id,document,state from solstock_guard.policies
    where state not in ('DRAFT','CONFIRMED','REVOKED','EXPIRED') and (${after}::text is null or id>${after})
    order by id limit ${limit}`;
  for (const row of rows) if (await policyDigest(row.document) !== row.id) throw new JournalError("Stored policy digest mismatch");
  return rows.map(policyRecord);
}
