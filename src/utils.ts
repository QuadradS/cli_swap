import {Connection, Keypair, PublicKey} from "@solana/web3.js";
import {createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync} from "@solana/spl-token";
import {TOKEN_SWAP_PROGRAM_ID, TokenSwap} from "@solana/spl-token-swap";

export function bpsToRatio(bps: number) {
  return bps / 10_000;
}

export function ui(amount: bigint, decimals: number) {
  return Number(amount) / 10 ** decimals;
}

export function toRaw(amountUi: number, decimals: number): bigint {
  return BigInt(Math.floor(amountUi * 10 ** decimals));
}

export function constantProductOut(
  amountInRaw: bigint,
  reserveInRaw: bigint,
  reserveOutRaw: bigint,
  feeBps: number
): bigint {
  const feeNum = BigInt(10_000 - feeBps);
  const feeDen = BigInt(10_000);
  const amountInAfterFee = (amountInRaw * feeNum) / feeDen;
  const numerator = amountInAfterFee * reserveOutRaw;
  const denominator = reserveInRaw + amountInAfterFee;
  return numerator / denominator;
}

export function priceFromReserves(
  reserveA: bigint,
  reserveB: bigint,
  decimalsA: number,
  decimalsB: number
) {
  const a = Number(reserveA) / 10 ** decimalsA;
  const b = Number(reserveB) / 10 ** decimalsB;
  if (a === 0) return Infinity;
  return b / a;
}

export function spreadBps(priceA: number, priceB: number): number {
  const mid = (priceA + priceB) / 2;
  if (mid === 0) return 0;
  return Math.abs(priceA - priceB) / mid * 10_000;
}

export async function getMintDecimals(connection: Connection, mint: PublicKey): Promise<number> {
  const info = await connection.getParsedAccountInfo(mint);
  const data: any = info.value?.data;

  return  data?.parsed?.info?.decimals;
}

export async function getTokenBalanceRaw(connection: Connection, tokenAccount: PublicKey): Promise<bigint> {
  const res = await connection.getTokenAccountBalance(tokenAccount);
  return BigInt(res.value.amount);
}

export async function ensureAtaIx(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey
) {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  const info = await connection.getAccountInfo(ata);
  if (info) return { ata, createIx: null as any, rentLamports: 0n };
  const ix = createAssociatedTokenAccountInstruction(
    owner,
    ata,
    owner,
    mint,
    tokenProgram,
  );
  const rentLamports = BigInt(await connection.getMinimumBalanceForRentExemption(165));
  return { ata, createIx: ix, rentLamports };
}


export async function loadSwapAddresses(connection, swapPk: PublicKey) {
  const dummy = Keypair.generate();

  const swap = await TokenSwap.loadTokenSwap(
    connection,
    swapPk,
    TOKEN_SWAP_PROGRAM_ID,
    dummy,
  );

  return {
    swap: swap.tokenSwap,
    authority: swap.authority,
    vaultA: swap.tokenAccountA,
    vaultB: swap.tokenAccountB,
    poolMint: swap.poolToken,
    feeAccount: swap.feeAccount,
  };
}