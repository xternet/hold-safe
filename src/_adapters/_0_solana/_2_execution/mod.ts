import type { Keypair } from "@solana/web3.js";
import type { AuthorizationPort, ChainReader, ExecutionPort } from "../../../_kernel/mod";
import type { NativeRouteAccess } from "../_shared/_8_routes/mod";
import { ExitPreparation } from "./_0_prepare/mod";
import { NativeDelivery } from "./_1_delivery/mod";
import type { DeliveryOptions } from "./_1_delivery/_shared/mod";

export function createExecution(options: DeliveryOptions, signing: {
  keeper: Keypair; authorization: Pick<AuthorizationPort, "read">; holdings: Pick<ChainReader, "readHolding">; route: NativeRouteAccess;
}): ExecutionPort {
  if (signing.keeper.publicKey.toBase58() !== options.keeper) throw new Error("Execution keeper identity differs");
  const prepare = new ExitPreparation(options.primary.connection, signing.authorization, signing.holdings,
    signing.route, options.fees, signing.keeper, options.log, options.now);
  const delivery = new NativeDelivery(options);
  return {
    build: (policy, quote) => prepare.build(policy, quote),
    simulate: transaction => prepare.simulate(transaction),
    signKeeper: (digest, transaction) => prepare.signKeeper(digest, transaction),
    broadcast: attempt => delivery.broadcast(attempt),
    reconcile: attempt => delivery.reconcile(attempt),
  };
}
