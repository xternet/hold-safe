import { address } from "@solana/kit";
import { FailedTransactionMetadata } from "litesvm";
import { loadSnapshot } from "./_0_load/mod";
import { makeAccounts, readToken, send } from "./_1_accounts/mod";
import { makeSwap } from "./_2_instruction/mod";
import type { RouteCase } from "../_shared/mod";

export function runRouteCase(testCase: RouteCase) {
  const { svm, snapshot } = loadSnapshot();
  const accounts = makeAccounts(svm, testCase);
  if (testCase.mode === "pda") {
    svm.addProgramFromFile(address(accounts.probe.toBase58()), ".tools/m01-probe/solstock_m01_probe.so");
  }
  const sourceBefore = readToken(svm, accounts.source).amount;
  const instruction = makeSwap(snapshot, accounts, testCase);
  const signer = testCase.mode === "owner" ? accounts.owner
    : testCase.mode === "delegate" ? accounts.delegate : accounts.keeper;
  const result = send(svm, [instruction], signer);
  const metadata = result instanceof FailedTransactionMetadata ? result.meta() : result;
  return { failed: result instanceof FailedTransactionMetadata, logs: metadata.logs(),
    computeUnits: metadata.computeUnitsConsumed(), amount: accounts.amount, sourceBefore,
    sourceAfter: readToken(svm, accounts.source).amount,
    allowanceAfter: readToken(svm, accounts.source).allowance,
    outputAfter: readToken(svm, accounts.output).amount,
    stagingAfter: readToken(svm, accounts.staging).amount };
}
