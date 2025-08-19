import {Connection, Keypair, PublicKey, TransactionInstruction} from "@solana/web3.js";
import * as BufferLayout from "buffer-layout";
import {PoolAdapter, PoolConfig, PoolState, SwapIxBuildParams} from "./types";
import {getAccount, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID} from "@solana/spl-token";
import {TokenSwap} from "@solana/spl-token-swap";

const TokenSwapLayout = BufferLayout.struct([// TODO remove it
  BufferLayout.u8("version"),
  BufferLayout.u8("isInitialized"),
  BufferLayout.u8("bumpSeed"),
  BufferLayout.blob(1, "padding0"),

  BufferLayout.blob(32, "tokenProgramId"),
  BufferLayout.blob(32, "tokenAccountA"),
  BufferLayout.blob(32, "tokenAccountB"),
  BufferLayout.blob(32, "poolMint"),
  BufferLayout.blob(32, "mintA"),
  BufferLayout.blob(32, "mintB"),
  BufferLayout.blob(32, "feeAccount"),

  BufferLayout.nu64("tradeFeeNumerator"),
  BufferLayout.nu64("tradeFeeDenominator"),
  BufferLayout.nu64("ownerTradeFeeNumerator"),
  BufferLayout.nu64("ownerTradeFeeDenominator"),
  BufferLayout.nu64("ownerWithdrawFeeNumerator"),
  BufferLayout.nu64("ownerWithdrawFeeDenominator"),
  BufferLayout.nu64("hostFeeNumerator"),
  BufferLayout.nu64("hostFeeDenominator"),
]);

class SplTokenSwapAdapter implements PoolAdapter {
  constructor(private connection: Connection, private cfg: PoolConfig) {
  }

  async loadState(): Promise<PoolState> {
    const programId = new PublicKey(this.cfg.programId);
    const swapPk = new PublicKey(this.cfg.swap);

    const dummy = Keypair.generate();
    const swapObj = await TokenSwap.loadTokenSwap(
      this.connection,
      swapPk,
      programId,
      dummy,
    );

    const authority = swapObj.authority;
    const vaultA = swapObj.tokenAccountA;
    const vaultB = swapObj.tokenAccountB;
    const poolMint = swapObj.poolToken;
    const feeAccount = swapObj.feeAccount;

    const [va, vb] = await Promise.all([
      getAccount(this.connection, vaultA),
      getAccount(this.connection, vaultB),
    ]);
    const mintA = va.mint;
    const mintB = vb.mint;

    const [decimalsA, decimalsB] = await Promise.all([
      getMint(this.connection, mintA).then(m => m.decimals),
      getMint(this.connection, mintB).then(m => m.decimals),
    ]);

    const [reserveA, reserveB] = [va.amount, vb.amount];
    const feeBps = 0;

    return {
      kind: "spl-token-swap",
      programId,
      swap: swapPk,
      authority,
      vaultA,
      vaultB,
      mintA,
      mintB,
      decimalsA,
      decimalsB,
      reserveA: BigInt(reserveA.toString()),
      reserveB: BigInt(reserveB.toString()),
      poolMint,
      feeAccount,
      feeBps,
    };
  }

  async buildSwapIx(params: SwapIxBuildParams) {
    const st = await this.loadState();

    const src = await getAccount(this.connection, params.userSourceAta);
    const isA = src.mint.equals(st.mintA);

    const poolSrc = isA ? st.vaultA : st.vaultB;
    const poolDst = isA ? st.vaultB : st.vaultA;

    const data = Buffer.alloc(1 + 8 + 8);
    data.writeUInt8(1, 0);
    data.writeBigUInt64LE(params.amountIn, 1);
    data.writeBigUInt64LE(params.minOut, 9);

    return new TransactionInstruction({
      programId: st.programId,
      keys: [
        {pubkey: st.swap, isSigner: false, isWritable: false},
        {pubkey: st.authority, isSigner: false, isWritable: false},
        {pubkey: params.user, isSigner: true, isWritable: false},
        {pubkey: params.userSourceAta, isSigner: false, isWritable: true},
        {pubkey: poolSrc, isSigner: false, isWritable: true},
        {pubkey: poolDst, isSigner: false, isWritable: true},
        {pubkey: params.userDestAta, isSigner: false, isWritable: true},
        {pubkey: st.poolMint, isSigner: false, isWritable: true}, // ВАЖНО
        {pubkey: st.feeAccount, isSigner: false, isWritable: true}, // ВАЖНО
        {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
      ],
      data,
    });
  }
}

export function makeAdapter(connection: Connection, cfg: PoolConfig): PoolAdapter {
  if (cfg.type === "spl-token-swap") return new SplTokenSwapAdapter(connection, cfg);
  throw new Error(`Unsupported pool type: ${cfg.type}`);
}

