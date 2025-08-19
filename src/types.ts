import {PublicKey, TransactionInstruction} from "@solana/web3.js";

export type U64 = bigint;

export type PoolKind = "spl-token-swap" | "custom";

export type PoolConfig = {
  type: PoolKind;
  programId: string;
  swap: string;
  authority: string;
  vaultA: string;
  vaultB: string;
  mintA: string;
  mintB: string;
};

export interface PoolsFile {
  poolA: PoolConfig;
  poolB: PoolConfig;
}

export interface PoolState {
  kind: PoolKind;
  programId: PublicKey;
  swap: PublicKey;
  authority: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  decimalsA: number;
  decimalsB: number;
  reserveA: bigint;
  reserveB: bigint;
  feeBps: number;
  poolMint: PublicKey;
  feeAccount: PublicKey;
}

export interface SwapIxBuildParams {
  user: PublicKey;
  userSourceAta: PublicKey;
  userDestAta: PublicKey;
  amountIn: bigint;
  minOut: bigint;
}

export interface PoolAdapter {
  loadState(): Promise<PoolState>;
  buildSwapIx(params: SwapIxBuildParams): Promise<TransactionInstruction>;
}