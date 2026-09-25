import type { AssetRef, ChainRef, Health, Outcome, Policy, RawAmount, ReferenceMapping } from "../../_0_types/mod";
import type { Rational } from "../../_4_units/mod";

export type NativeContext = { adapter: string; version: number; serialized: string };
export type PriceObservation = {
  id: string; provider: string; instrument: string; coverage: ReferenceMapping["coverage"];
  bidUsd: Rational; askUsd: Rational; bidSize: Rational; askSize: Rational;
  sizeUnit: "round_lots" | "base_asset";
  sourceAtMs: number; receivedAtMs: number;
  session: "regular" | "extended" | "closed" | "continuous" | "unknown";
};
export type HoldingObservation = {
  id: string; asset: AssetRef; account: string; owner: string; balanceRaw: string;
  delegate: string | null; allowanceRaw: string; frozen: boolean; paused: boolean;
  multiplier: Rational; sourceAtMs: number; receivedAtMs: number; context: NativeContext;
};
export type ExitQuote = {
  id: string; policyDigest: string; chain: ChainRef; routeId: string;
  input: RawAmount; output: RawAmount; minimumOutputRaw: string;
  sourceAtMs: number; quotedAtMs: number; expiresAtMs: number; priceImpactBps: Rational; context: NativeContext;
};
export type Subscription = { stop(): Promise<void> };
export type Observer<T> = (event: Outcome<T>) => void;
export interface ReferenceFeed {
  readonly id: string;
  subscribe(instrument: string, observer: Observer<PriceObservation>): Promise<Outcome<Subscription>>;
  health(): Health;
}
export interface ChainReader {
  readonly chain: ChainRef;
  verifyNetwork(): Promise<Outcome<void>>;
  readHolding(policy: Policy): Promise<Outcome<HoldingObservation>>;
  subscribeHolding(policy: Policy, observer: Observer<HoldingObservation>): Promise<Outcome<Subscription>>;
  health(): Health;
}
export interface VenuePort {
  readonly id: string;
  quote(policy: Policy, digest: string): Promise<Outcome<ExitQuote>>;
  validateRoute(policy: Policy, quote: ExitQuote): Promise<Outcome<void>>;
}
export interface AggregatorPort {
  readonly id: string;
  discover(policy: Policy, digest: string): Promise<Outcome<ExitQuote[]>>;
  validateLegs(policy: Policy, quote: ExitQuote): Promise<Outcome<void>>;
}
