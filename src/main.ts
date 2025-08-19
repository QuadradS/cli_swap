import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL, TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";
import * as fs from "fs";
import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import * as path from "path";
import {PoolsFile} from "./types";
import {constantProductOut, ensureAtaIx, priceFromReserves, spreadBps, toRaw, ui} from "./utils";
import {TOKEN_PROGRAM_ID} from "@solana/spl-token";
import {makeAdapter} from "./spl-token-swap-adapter";

export async function main() {
  const argv = await yargs(hideBin(process.argv))
    .strict()
    .options({
      rpcUrl: {type: "string", demandOption: true, desc: "RPC URL"},
      keypair: {type: "string", demandOption: true, desc: "Path to keypair JSON"},
      amountIn: {type: "number", demandOption: true, desc: "Input amount (UI units of token A)"},
      spreadThresholdBps: {type: "number", demandOption: true, desc: "Min spread to trigger (bps)"},
      slippageBps: {type: "number", demandOption: true, desc: "Slippage tolerance per leg (bps)"},
      priorityFee: {type: "number", demandOption: true, desc: "Compute unit price (microLamports)"},
      simulateOnly: {type: "boolean", default: false, desc: "Do not send, only simulate & report"},
      pools: {type: "string", default: "pools.json", desc: "Path to pools.json config"},
    })
    .parse();

  const connection = new Connection(argv.rpcUrl, {commitment: "confirmed"});
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(argv.keypair, "utf8")))
  );

  const poolsPath = path.resolve(String(argv.pools));
  if (!fs.existsSync(poolsPath)) throw new Error(`Pools config not found: ${poolsPath}`);
  const poolsFile: PoolsFile = JSON.parse(fs.readFileSync(poolsPath, "utf8"));

  const adapterA = makeAdapter(connection, poolsFile.poolA);
  const adapterB = makeAdapter(connection, poolsFile.poolB);

  const [stateA, stateB] = await Promise.all([adapterA.loadState(), adapterB.loadState()]);

  const priceA = priceFromReserves(stateA.reserveA, stateA.reserveB, stateA.decimalsA, stateA.decimalsB);
  const priceB = priceFromReserves(stateB.reserveA, stateB.reserveB, stateB.decimalsA, stateB.decimalsB);
  const spread = spreadBps(priceA, priceB);

  const amountInRaw = toRaw(argv.amountIn, stateA.decimalsA);

  const out1 = constantProductOut(amountInRaw, stateA.reserveA, stateA.reserveB, stateA.feeBps);
  const out2 = constantProductOut(out1, stateB.reserveB, stateB.reserveA, stateB.feeBps);

  const minOut1 = (out1 * BigInt(10_000 - argv.slippageBps)) / BigInt(10_000);
  const minOut2 = (out2 * BigInt(10_000 - argv.slippageBps)) / BigInt(10_000);

  let lamportsCost = 0n;

  const tokenProgram = TOKEN_PROGRAM_ID;
  const {ata: userAtaA, createIx: createAtaAIx, rentLamports: rentA} = await ensureAtaIx(
    connection, payer.publicKey, stateA.mintA, tokenProgram
  );
  const {ata: userAtaB, createIx: createAtaBIx, rentLamports: rentB} = await ensureAtaIx(
    connection, payer.publicKey, stateA.mintB, tokenProgram
  );
  lamportsCost += rentA + rentB;

  const priorityFeeMicroLamports = BigInt(argv.priorityFee);
  const ASSUMED_CU = 400_000n;
  lamportsCost += (priorityFeeMicroLamports * ASSUMED_CU) / 1_000_000n;

  const rateTokensPerSol = Number(process.env.RATE_TOKENS_PER_SOL || "0");
  const lamportsAsTokens = rateTokensPerSol > 0 ? (Number(lamportsCost) / LAMPORTS_PER_SOL) * rateTokensPerSol : 0;
  const pnlRaw = (out2 - amountInRaw) - toRaw(lamportsAsTokens, stateA.decimalsA);
  const pnlUi = ui(pnlRaw, stateA.decimalsA);

  const decision = {
    priceA,
    priceB,
    spread_bps: spread,
    meets_threshold: spread >= argv.spreadThresholdBps,
    expected_out_leg1: ui(out1, stateB.decimalsB),
    expected_out_leg2: ui(out2, stateA.decimalsA),
    min_out_leg1: ui(minOut1, stateB.decimalsB),
    min_out_leg2: ui(minOut2, stateA.decimalsA),
    lamports_cost: Number(lamportsCost),
    lamports_cost_tokens_equiv: lamportsAsTokens,
    pnl_tokens: pnlUi,
    trade_allowed: spread >= argv.spreadThresholdBps && pnlRaw > 0n,
  };

  const steps: string[] = [];
  steps.push(`Loaded poolA: fee=${stateA.feeBps} bps reservesA=${ui(stateA.reserveA, stateA.decimalsA)} reservesB=${ui(stateA.reserveB, stateA.decimalsB)}`);
  steps.push(`Loaded poolB: fee=${stateB.feeBps} bps reservesA=${ui(stateB.reserveA, stateB.decimalsA)} reservesB=${ui(stateB.reserveB, stateB.decimalsB)}`);
  steps.push(`Prices: priceA=${priceA.toFixed(8)} priceB=${priceB.toFixed(8)} spread_bps=${spread.toFixed(2)}`);
  steps.push(`AmountIn=${argv.amountIn}, out1=${ui(out1, stateB.decimalsB)}, out2=${ui(out2, stateA.decimalsA)}, pnl=${pnlUi}`);

  let signature: string | null = null;

  if (argv.simulateOnly || !decision.trade_allowed) {
    const ixs = [] as TransactionInstruction[];
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({microLamports: Number(priorityFeeMicroLamports)}));
    ixs.push(ComputeBudgetProgram.setComputeUnitLimit({units: Number(ASSUMED_CU)}));

    if (createAtaAIx) {
      ixs.push(createAtaAIx);
    }
    if (createAtaBIx) {
      ixs.push(createAtaBIx);
    }

    const ix1 = await adapterA.buildSwapIx({
      user: payer.publicKey,
      userSourceAta: userAtaA,
      userDestAta: userAtaB,
      amountIn: amountInRaw,
      minOut: minOut1,
    });
    const ix2 = await adapterB.buildSwapIx({
      user: payer.publicKey,
      userSourceAta: userAtaB,
      userDestAta: userAtaA,
      amountIn: out1,
      minOut: minOut2,
    });
    ixs.push(ix1, ix2);

    const latest = await connection.getLatestBlockhash();
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    tx.sign([payer]);

    const sim = await connection.simulateTransaction(tx, {sigVerify: true});
    steps.push(`simulate logs: ${(sim.value.logs || []).slice(-10).join(" | ")}`);

    const report = {steps, decision, simulateOnly: true, txLogsLast: (sim.value.logs || []).slice(-30)};
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const ixs = [] as TransactionInstruction[];
  ixs.push(ComputeBudgetProgram.setComputeUnitPrice({microLamports: Number(priorityFeeMicroLamports)}));
  ixs.push(ComputeBudgetProgram.setComputeUnitLimit({units: Number(ASSUMED_CU)}));

  if (createAtaAIx) ixs.push(createAtaAIx);
  if (createAtaBIx) ixs.push(createAtaBIx);

  const ix1 = await adapterA.buildSwapIx({
    user: payer.publicKey,
    userSourceAta: userAtaA,
    userDestAta: userAtaB,
    amountIn: amountInRaw,
    minOut: minOut1,
  });
  const ix2 = await adapterB.buildSwapIx({
    user: payer.publicKey,
    userSourceAta: userAtaB,
    userDestAta: userAtaA,
    amountIn: out1,
    minOut: minOut2,
  });

  ixs.push(ix1, ix2);

  const latest = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  }).compileToV0Message();

  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);

  const sig = await connection.sendTransaction(tx, {skipPreflight: false, maxRetries: 3});
  signature = sig;
  steps.push(`sent tx: ${sig}`);

  const conf = await connection.confirmTransaction({signature: sig, ...latest}, "confirmed");
  steps.push(`confirm status: ${conf.value.err ? "ERR" : "OK"}`);

  const report = {steps, decision, simulateOnly: false, signature};
  console.log(JSON.stringify(report, null, 2));
}