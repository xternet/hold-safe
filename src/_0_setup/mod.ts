import { readFile } from "node:fs/promises";
import { validateCatalog, type Catalog, type Fault } from "../_kernel/mod";
import { readConfig } from "./_0_config/mod";
import { openStorage } from "./_1_storage/mod";
export { withResources } from "./_2_lifecycle/mod";
export { foreground } from "./_3_process/mod";

export async function setup(env: Readonly<Record<string, string | undefined>>, log: (fault: Fault) => void) {
  let config;
  try { config = readConfig(env); }
  catch (error) {
    log({ code: "UNAVAILABLE", message: error instanceof Error ? error.message : "Configuration rejected", retryable: false,
      context: { component: "configuration" } });
    throw new Error("Configuration rejected");
  }
  const catalog = validateCatalog(JSON.parse(await readFile(new URL("../../config/coverage.json", import.meta.url), "utf8")) as Catalog);
  const storage = await openStorage(config.database, log);
  return { config, catalog, storage };
}
