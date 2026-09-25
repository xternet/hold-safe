import type { Connection } from "@solana/web3.js";
import { policyDigest, validateCatalog, validatePolicy, type Catalog, type ExitQuote, type Fault, type Outcome, type Policy, type VenuePort } from "../../../../_kernel/mod";
import { quoteNativeState } from "./_0_math/mod";
import { LiveStateReader } from "./_1_state/mod";
import { QuoteBook } from "./_2_book/mod";

export function createRaydiumVenue(connection: Connection, inputCatalog: Catalog, log: (fault: Fault) => void, now = Date.now) {
  const catalog = validateCatalog(inputCatalog), reader = new LiveStateReader(connection, now), book = new QuoteBook(now);
  async function attempt<T>(action: string, policy: Policy, work: () => Promise<T>): Promise<Outcome<T>> {
    try { return { ok: true, value: await work() }; }
    catch (error) {
      const message = (error instanceof Error ? error.message : "Unknown native venue failure")
        .replaceAll(connection.rpcEndpoint, "[redacted RPC]").replace(/https?:\/\/\S+/g, "[redacted URL]");
      const fault: Fault = { code: "UNAVAILABLE", message, retryable: true, context: { adapter: "raydium-clmm-v1", action, route: policy.routeId } };
      log(fault); return { ok: false, error: fault };
    }
  }
  const venue: VenuePort = { id: "raydium-clmm-v1",
    quote: (policy, digest) => attempt("quote", policy, async () => {
      validatePolicy(policy, catalog, Math.floor(now() / 1000));
      if (await policyDigest(policy) !== digest) throw new Error("Policy digest mismatch");
      const native = quoteNativeState(policy, catalog, await reader.read(policy));
      return book.issue(policy, digest, native);
    }),
    validateRoute: (policy, quote) => attempt("validate", policy, async () => {
      book.validate(policy, await policyDigest(policy), quote);
    }),
  };
  return { venue, resolve: async (policy: Policy, quote: ExitQuote) =>
    book.validate(policy, await policyDigest(policy), quote) };
}
