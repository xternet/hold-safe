import { chainKey, policyDigest, type ChainRef } from "../../../_kernel/mod";
import { identity, JournalError, policyRecord, type Db, type PolicyRow } from "../_shared/mod";

export async function scanOwner(sql: Db, chain: ChainRef, owner: string, after: string | null, limit: number) {
  chainKey(chain);
  if (typeof owner !== "string" || owner.length === 0 || owner.length > 128) throw new JournalError("Invalid owner");
  if (after !== null) identity(after);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new JournalError("Owner page must be 1–50 records");
  const rows = await sql<PolicyRow[]>`select id,document,state from solstock_guard.policies
    where chain_namespace=${chain.namespace} and network=${chain.reference} and owner_address=${owner}
      and (${after}::text is null or id>${after}) order by id limit ${limit}`;
  for (const row of rows) if (await policyDigest(row.document) !== row.id) throw new JournalError("Stored policy digest mismatch");
  return rows.map(policyRecord);
}
