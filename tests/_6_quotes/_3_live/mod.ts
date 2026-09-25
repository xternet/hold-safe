import { writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { quoteFixture } from "../_shared/mod";
import { readConnection } from "../../_2_swap/_0_capture/_0_rpc/mod";
import { createRaydiumVenue } from "../../../src/_adapters/_0_solana/_venues/_0_raydium/mod";
import { policyDigest } from "../../../src/_kernel/mod";

// Manual read-only observation. No native transaction is built, signed or sent.
const [keyFile, outputFile] = process.argv.slice(2);
if (keyFile === undefined || outputFile === undefined || !isAbsolute(outputFile) ||
    !resolve(outputFile).startsWith("/srv/cold/solstock-guard/")) throw new Error("Usage: bun <this file> <credential-file> <new cold evidence.json>");
const { policy, catalog } = quoteFixture();
policy.expiresAt = Math.floor(Date.now() / 1000) + 3600;
const { venue } = createRaydiumVenue(readConnection(keyFile), catalog, (fault) => console.error(JSON.stringify(fault)));
const result = await venue.quote(policy, await policyDigest(policy));
if (!result.ok) throw new Error("Live quote unavailable; see redacted provider error");
const evidence = { label: "read-only live mainnet quote; hypothetical input; no trade", recordedAt: new Date().toISOString(),
  quote: result.value };
writeFileSync(outputFile, JSON.stringify(evidence, (_, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ outputFile, inputRaw: result.value.input.raw, outputRaw: result.value.output.raw }));
