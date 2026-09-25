export type DemoReferenceView = {
  provider:"alpaca-iex"; instrument:"AAPL"; coverage:"venue";
  status:"live"|"stale"|"closed"|"unavailable";
  bidUsd:string|null; askUsd:string|null; sourceAtMs:number|null; checkedAtMs:number; reason:string;
};
export interface DemoReferencePort {
  start():Promise<void>;
  read():DemoReferenceView;
  stop():Promise<void>;
}
