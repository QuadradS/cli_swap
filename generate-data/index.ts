import {Connection, Keypair, PublicKey} from "@solana/web3.js";
import * as fs from "fs";
import {
  createAccount,
  createMint, getAccount, getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import {CurveType, TOKEN_SWAP_PROGRAM_ID, TokenSwap} from "@solana/spl-token-swap";
import {envBig, envInt, envOptStr, envStr} from "./getEnv";

const RPC = envStr("RPC_URL");
const KEYPAIR = envStr("KEYPAIR");
const MINT_A_STR = envOptStr("MINT_A");
const MINT_B_STR = envOptStr("MINT_B");
const MINT_A_DEC = envInt("MINT_A_DECIMALS", 9);
const MINT_B_DEC = envInt("MINT_B_DECIMALS", 9);
const LIQUIDITY_A = envBig("LIQUIDITY_A");
const LIQUIDITY_B = envBig("LIQUIDITY_B");
const POOL_MINT_DEC = envInt("POOL_MINT_DECIMALS", 6);

const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR, "utf8")))
);
const connection = new Connection(RPC, "confirmed");


async function main() {

  console.log("====================================");
  console.log("create swap");
  console.log("====================================");

  let mintA: PublicKey;
  let mintB: PublicKey;

  if (MINT_A_STR) {
    mintA = new PublicKey(MINT_A_STR);
    console.log("Using existing MINT_A:", mintA.toBase58());
  } else {
    mintA = await createMint(connection, payer, payer.publicKey, null, MINT_A_DEC);
    console.log("Created MINT_A:", mintA.toBase58(), "(decimals:", MINT_A_DEC, ")");
  }

  if (MINT_B_STR) {
    mintB = new PublicKey(MINT_B_STR);
    console.log("Using existing MINT_B:", mintB.toBase58());
  } else {
    mintB = await createMint(connection, payer, payer.publicKey, null, MINT_B_DEC);
    console.log("Created MINT_B:", mintB.toBase58(), "(decimals:", MINT_B_DEC, ")");
  }

  console.log("Payer: ", payer.publicKey.toBase58());
  console.log("Mint A:", mintA.toBase58());
  console.log("Mint B:", mintB.toBase58());
  console.log("====================================");

  const userAtaA = await getOrCreateAssociatedTokenAccount(
    connection, payer, mintA, payer.publicKey
  );
  const userAtaB = await getOrCreateAssociatedTokenAccount(
    connection, payer, mintB, payer.publicKey
  );

  const tokenSwapAccount = Keypair.generate();
  const [authority] = PublicKey.findProgramAddressSync(
    [tokenSwapAccount.publicKey.toBuffer()],
    TOKEN_SWAP_PROGRAM_ID
  );

  const poolMint = await createMint(connection, payer, authority, null, POOL_MINT_DEC);

  const vaultA = await createAccount(connection, payer, mintA, authority, Keypair.generate());
  const vaultB = await createAccount(connection, payer, mintB, authority, Keypair.generate());

  const poolTokenAccount = (await getOrCreateAssociatedTokenAccount(
    connection, payer, poolMint, payer.publicKey
  )).address;
  const feeAccount = (await getOrCreateAssociatedTokenAccount(
    connection, payer, poolMint, payer.publicKey
  )).address;

  await mintTo(connection, payer, mintA, vaultA, payer, LIQUIDITY_A);
  await mintTo(connection, payer, mintB, vaultB, payer, LIQUIDITY_B);

  const [va, vb, pm, fa] = await Promise.all([
    getAccount(connection, vaultA),
    getAccount(connection, vaultB),
    getMint(connection, poolMint),
    getAccount(connection, feeAccount),
  ]);
  if (!va.owner.equals(authority) || !vb.owner.equals(authority)) {
    throw new Error("Vaults must be owned by swap authority (PDA).");
  }
  if (!pm.mintAuthority || !pm.mintAuthority.equals(authority)) {
    throw new Error("poolMint.mintAuthority must equal swap authority.");
  }
  if (!fa.mint.equals(poolMint)) {
    throw new Error("feeAccount must be for poolMint.");
  }

  // Для информации: decimals и реальные UI-балансы резервов
  const [mintAInfo, mintBInfo] = await Promise.all([
    getMint(connection, mintA),
    getMint(connection, mintB),
  ]);
  const decA = mintAInfo.decimals;
  const decB = mintBInfo.decimals;
  console.log(`decimals: A=${decA} B=${decB}`);
  console.log(`vaultA amount = ${Number(va.amount) / 10 ** decA}`);
  console.log(`vaultB amount = ${Number(vb.amount) / 10 ** decB}`);

  await mintTo(connection, payer, mintA, userAtaA.address, payer, 2_000_000_000n);
  await mintTo(connection, payer, mintB, userAtaB.address, payer, 2_000_000_000n);

  console.log("Start creating");


  const swap = await TokenSwap.createTokenSwap(
    connection,
    payer,
    tokenSwapAccount,
    authority,
    vaultA,
    vaultB,
    poolMint,
    mintA,
    mintB,
    feeAccount,
    poolTokenAccount,
    TOKEN_SWAP_PROGRAM_ID,

    TOKEN_PROGRAM_ID,
    25n,
    10000n,
    0n,
    1n,
    0n, 1n,
    0n, 1n,
    CurveType.ConstantProduct
  );

  console.log("====================================");
  console.log("Copy this json to pools.json as poolA or poolA");

  const json = {
    type: "spl-token-swap",
    programId: TOKEN_SWAP_PROGRAM_ID.toBase58(),
    swap: swap.tokenSwap.toBase58(),
    authority: swap.authority.toBase58(),
    vaultA: vaultA.toBase58(),
    vaultB: vaultB.toBase58(),
    mintA: mintA.toBase58(),
    mintB: mintB.toBase58(),
    poolMint: poolMint.toBase58(),
    feeAccount: feeAccount.toBase58(),
  };
  console.log(JSON.stringify(json, null, 2));
  console.log("====================================");
}


main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
// заебался уже это писать x_X