import type { ExitQuote, Policy, VenuePort } from "../../../../_kernel/mod";
import type { GuardSwap } from "../_2_codec/mod";

export type NativeRouteAccess = { venue: VenuePort; resolve(policy: Policy, quote: ExitQuote): Promise<GuardSwap> };
