import type { Outcome, Policy } from "../../_0_types/mod";
import type { Subscription } from "../_0_market/mod";
import type { AuthorizationState } from "../_1_execution/mod";
import type { RiskInput, RiskRule } from "../_2_risk/mod";

export interface MonitorPort {
  watch(policy: Policy): Promise<Outcome<Subscription>>;
  refresh(policy: Policy, previous: RiskInput): Promise<RiskInput>;
  snapshot(policy: Policy, authorization: Outcome<AuthorizationState>): Promise<RiskInput>;
}
export type RiskFactory = (policy: Policy) => Promise<RiskRule>;
