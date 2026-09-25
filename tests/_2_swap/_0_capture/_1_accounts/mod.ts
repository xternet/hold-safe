import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Raydium, getPdaExBitmapAccount } from "@raydium-io/raydium-sdk-v2";
import { DEX, INPUT_MINT, OUTPUT_MINT, POOL, MAINNET_GENESIS, type Snapshot } from "../../_shared/mod";

const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

export async function captureAccounts(connection: Connection, output: string): Promise<Snapshot> {
  const genesis = await connection.getGenesisHash();
  if (genesis !== MAINNET_GENESIS) throw new Error("RPC is not Solana mainnet");
  const sdk = await Raydium.load({ connection, disableFeatureCheck: true, disableLoadToken: true });
  const route = await sdk.clmm.getSwapPoolInfo(POOL, true);
  const pool = route.rpcData;
  if (pool.programId.toBase58() !== DEX || pool.mintA.toBase58() !== INPUT_MINT ||
      pool.mintB.toBase58() !== OUTPUT_MINT) throw new Error("Unexpected native pool identity");
  if (route.tickArrays.length === 0) throw new Error("No initialized tick arrays");
  const bitmap = getPdaExBitmapAccount(new PublicKey(DEX), new PublicKey(POOL)).publicKey;
  const keys = [new PublicKey(POOL), pool.configId, pool.mintA, pool.mintB,
    pool.vaultA, pool.vaultB, pool.observationId, bitmap, SYSVAR_CLOCK_PUBKEY,
    ...route.tickArrays.map((tick) => tick.address)];
  const captured = await connection.getMultipleAccountsInfoAndContext(keys);
  const accounts = captured.value.map((account, index) => {
    const key = keys[index];
    if (key === undefined || account === null) throw new Error(`Missing capture account at index ${index}`);
    return { address: key.toBase58(), owner: account.owner.toBase58(),
      lamports: account.lamports, executable: account.executable,
      data: account.data.toString("base64"), sha256: digest(account.data) };
  });
  const programs: Snapshot["programs"] = [];
  const memo = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  for (const address of [new PublicKey(DEX), TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, memo]) {
    const result = await connection.getAccountInfoAndContext(address);
    const account = result.value;
    if (account === null || !account.executable) throw new Error(`Missing executable ${address}`);
    let binary: Buffer;
    let slot = result.context.slot;
    if (account.owner.toBase58() === "BPFLoaderUpgradeab1e11111111111111111111111") {
      if (account.data.readUInt32LE(0) !== 2) throw new Error(`Invalid loader Program state: ${address}`);
      const programData = new PublicKey(account.data.subarray(4, 36));
      const dataResult = await connection.getAccountInfoAndContext(programData);
      if (dataResult.value === null || dataResult.value.data.readUInt32LE(0) !== 3) {
        throw new Error(`Invalid ProgramData: ${address}`);
      }
      binary = dataResult.value.data.subarray(45);
      slot = dataResult.context.slot;
      writeFileSync(`${output}/${address}.programdata.json`, JSON.stringify({
        address: programData.toBase58(), slot, owner: dataResult.value.owner.toBase58(),
        data: dataResult.value.data.toString("base64"), sha256: digest(dataResult.value.data),
      }), { flag: "wx" });
    } else if (account.owner.toBase58() === "BPFLoader2111111111111111111111111111111111") {
      binary = account.data;
    } else throw new Error(`Unsupported program loader: ${address} ${account.owner}`);
    if (binary.subarray(0, 4).toString("hex") !== "7f454c46") throw new Error(`Not ELF: ${address}`);
    const file = `${address}.so`;
    writeFileSync(`${output}/${file}`, binary, { flag: "wx" });
    programs.push({ address: address.toBase58(), file, sha256: digest(binary), slot });
  }
  return { schema: 1, genesis, slot: captured.context.slot, pool: POOL,
    capturedAt: new Date().toISOString(), ticks: route.tickArrays.map((tick) => tick.address.toBase58()),
    accounts, programs };
}
