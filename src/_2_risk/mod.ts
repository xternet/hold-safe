import { copyValue } from "../_kernel/mod";
import { assetKey, policyDigest, validateCatalog, validatePolicy, type Catalog, type Policy, type RiskRule } from "../_kernel/mod";
import { validateEvidence } from "./_0_evidence/mod";
import { decide } from "./_1_rules/mod";

export async function createRiskRule(document: Policy, coverage: Catalog, nowMs: number): Promise<RiskRule> {
  if (document.rule.id !== "divergence") throw new Error("Unsupported production risk rule");
  const policy = copyValue(document), catalog = validateCatalog(copyValue(coverage));
  validatePolicy(policy, catalog, Math.floor(nowMs / 1000));
  const input = catalog.assets.find(asset => assetKey(asset.ref) === assetKey(policy.input));
  const output = catalog.assets.find(asset => assetKey(asset.ref) === assetKey(policy.output));
  if (input === undefined || output === undefined) throw new Error("Missing risk accounting coverage");
  const digest = await policyDigest(policy), bound = { policy, digest, inputDecimals: input.decimals, outputDecimals: output.decimals };
  return { id: "divergence", version: 1, policyDigest: digest,
    requiredInputs: ["reference", "output", "holding", "quote", "authorization", "session"],
    evaluate: (snapshot, previous) => decide(bound, snapshot, previous, validateEvidence(bound, snapshot)) };
}
