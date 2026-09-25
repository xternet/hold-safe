import { copyValue } from "../../../../../_kernel/mod";
import { randomUUID } from "node:crypto";
import { canonicalPolicy, type ExitQuote, type Policy } from "../../../../../_kernel/mod";
import { quoteJson, type NativeQuote } from "../_shared/mod";

export class QuoteBook {
  private readonly entries = new Map<string, { policy: string; quote: ExitQuote; native: NativeQuote }>();
  constructor(private readonly now: () => number, private readonly capacity = 1024) {}
  issue(policy: Policy, digest: string, native: NativeQuote): ExitQuote {
    const now = this.now();
    const expiresAtMs = Math.min(native.observedAtMs + 2000, native.sourceAtMs + policy.rule.maxAgeMs);
    if (native.observedAtMs > now || native.sourceAtMs > now || now >= expiresAtMs) throw new Error("Native quote state stale");
    for (const [id, entry] of this.entries) if (entry.quote.expiresAtMs <= now) this.entries.delete(id);
    if (this.entries.size >= this.capacity) throw new Error("Quote book capacity reached; retry after expiry");
    const quote: ExitQuote = { id: randomUUID(), policyDigest: digest, chain: policy.chain, routeId: policy.routeId,
      input: { asset: policy.input, raw: policy.amountRaw }, output: { asset: policy.output, raw: native.outputRaw },
      minimumOutputRaw: native.minimumOutputRaw, sourceAtMs: native.sourceAtMs, quotedAtMs: native.observedAtMs, expiresAtMs,
      priceImpactBps: native.priceImpactBps,
      context: { adapter: "raydium-clmm-v1", version: 1, serialized: quoteJson(native) } };
    this.entries.set(quote.id, { policy: canonicalPolicy(policy), quote: copyValue(quote), native: copyValue(native) });
    return copyValue(quote);
  }
  validate(policy: Policy, digest: string, quote: ExitQuote): NativeQuote {
    const entry = this.entries.get(quote.id);
    if (entry === undefined) throw new Error("Quote was not issued by this venue instance");
    if (this.now() >= entry.quote.expiresAtMs) throw new Error("Quote expired");
    if (digest !== entry.quote.policyDigest || canonicalPolicy(policy) !== entry.policy || quoteJson(quote) !== quoteJson(entry.quote)) {
      throw new Error("Quote amount/domain/route/context binding mismatch");
    }
    return copyValue(entry.native);
  }
}
