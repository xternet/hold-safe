import type { SQL } from "bun";
import { copyValue, validateCatalog, type Catalog, type Fault, type JournalPort } from "../../_kernel/mod";
import { putPolicy, readPolicy, scanActive, transition } from "./_0_policies/mod";
import { scanOwner } from "./_3_owner/mod";
import { claim, release, renew } from "./_1_claims/mod";
import { prepare, receipt, recordDecision, submitted } from "./_2_attempts/mod";
import { JournalError, latest } from "./_shared/mod";

export function createJournal(sql: SQL, coverage: Catalog, log: (fault: Fault) => void): JournalPort {
  const catalog = validateCatalog(copyValue(coverage));
  async function run<T>(action: string, policy: string, work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      const message = error instanceof JournalError ? error.message : "Journal operation failed; database details redacted";
      const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "UNCLASSIFIED";
      log({ code: "UNAVAILABLE", message, retryable: true, context: { component: "journal", action, policy, code, sqlstate: error !== null && typeof error === "object" && "errno" in error && typeof error.errno === "string" ? error.errno : "UNAVAILABLE" } });
      throw new JournalError(message);
    }
  }
  return {
    putPolicy: policy => run("put-policy", policy.orderId, () => putPolicy(sql, catalog, policy)),
    readPolicy: digest => run("read-policy", digest, () => readPolicy(sql, digest)),
    scanOwner: (chain, owner, after, limit) => run("scan-owner", "page", () => scanOwner(sql, chain, owner, after, limit)),
    scanActive: (after, limit) => run("scan-active", "page", () => scanActive(sql, after, limit)),
    claim: (digest, worker, duration) => run("claim", digest, () => claim(sql, digest, worker, duration)),
    renew: (owner, duration) => run("renew", owner.policyDigest, () => renew(sql, owner, duration)),
    release: owner => run("release", owner.policyDigest, () => release(sql, owner)),
    transition: (owner, expected, next, evidence) => run("transition", owner.policyDigest, () => transition(sql, owner, expected, next, evidence)),
    recordDecision: (owner, id, decision) => run("decision", owner.policyDigest, () => recordDecision(sql, owner, id, decision)),
    prepare: (owner, plan) => run("prepare", owner.policyDigest, () => prepare(sql, owner, plan)),
    latest: digest => run("latest", digest, () => latest(sql, digest)),
    submitted: (owner, id) => run("submitted", owner.policyDigest, () => submitted(sql, owner, id)),
    receipt: (owner, id, result) => run("receipt", owner.policyDigest, () => receipt(sql, owner, id, result)),
  };
}
