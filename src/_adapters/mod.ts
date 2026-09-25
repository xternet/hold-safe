import { validateCatalog, type ReferenceFeed } from "../_kernel/mod";
import { createSolana, type SolanaOptions } from "./_0_solana/mod";
import { AlpacaFeed, LiveCalendar, type AlpacaCredentials } from "./_2_alpaca/mod";
import { KrakenFeed } from "./_3_kraken/mod";
export {createDemoReference} from "./_2_alpaca/_5_demo_create/mod";

export async function createAdapters(options: SolanaOptions & { alpaca: AlpacaCredentials; calendarOrigin?: string }) {
  const catalog = validateCatalog(options.catalog);
  const stock = catalog.feeds.find(feed => feed.id === "alpaca-sip");
  const output = catalog.feeds.find(feed => feed.id === "kraken-usd");
  if (catalog.feeds.length !== 2 || stock === undefined || output === undefined || stock.coverage !== "consolidated" || output.coverage !== "venue") {
    throw new Error("Unsupported feed registry");
  }
  const native = await createSolana({ ...options, catalog });
  const calendar = new LiveCalendar(options.alpaca, options.log, options.now, options.calendarOrigin);
  const alpaca = new AlpacaFeed(options.alpaca, stock.instruments, calendar, options.log, options.now);
  const kraken = new KrakenFeed(output.instruments, options.log, options.now);
  const feeds: ReadonlyMap<string, ReferenceFeed> = new Map<string, ReferenceFeed>([[alpaca.id, alpaca], [kraken.id, kraken]]);
  return { ...native, feeds, session: (time: number) => calendar.session(time),
    start: () => calendar.start(), stop: () => calendar.stop() };
}
