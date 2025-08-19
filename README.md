# SOL AMM Arbitrage CLI (TypeScript)

A CLI tool for arbitrage between two AMM pools on Solana (with an adapter for SPL Token Swap).  
It reads pool states, computes prices/spread/PnL, and builds an atomic transaction of two swaps (A→B, then B→A) with slippage protection and optional priority fee. Includes a simulation mode with a full JSON report.

---

## Features

- Reads two AMM pools (reserves, decimals, fees) via adapters  
- Computes prices and spread in basis points (`spread_bps`)  
- Calculates expected PnL including pool fees, optional ATA rent, and priority fee  
- Builds an atomic transaction with two swaps (A → B, then B → A)  
- Slippage guard (`min_out`)  
- Adds `ComputeBudget` and optional priority fee  
- `--simulate-only` mode with full JSON report  

---

## Requirements

- Node.js v18+  
- Solana CLI installed (`solana --version`)  
- A funded devnet wallet (with some SOL for fees)  

---

## Installation

```bash
git clone https://github.com/your-repo/sol-amm-arb-cli.git
cd sol-amm-arb-cli
npm install
```

Build:

```bash
npx tsc
```

---

## Usage

### 1. Generate a keypair
```bash
solana-keygen new --outfile id.json
```

### 2. Fund your wallet on devnet
```bash
solana airdrop 2 --keypair id.json --url https://api.devnet.solana.com
```

### 3. Create test tokens and pools
You can use the provided helper script (`src/createPools.ts`) to mint tokens and initialize two SPL Token Swap pools.  
This will output a `pools.json` with pool configs:

run generate:

```bash
  npm run app:gen-data 
```
    

```json
{
  "poolA": {
    "type": "spl-token-swap",
    "programId": "...",
    "swap": "...",
    "authority": "...",
    "vaultA": "...",
    "vaultB": "...",
    "mintA": "...",
    "mintB": "...",
    "poolMint": "...",
    "feeAccount": "..."
  },
  "poolB": { ... }
}
```

---

### 4. Run simulation
```bash
 npx tsc &&  node dist/src/index.js \
    --rpc-url https://api.devnet.solana.com \
    --keypair .../id.json \
    --amount-in 0.01 \
    --spread-threshold-bps 5 \
    --slippage-bps 30 \
    --priority-fee 0 \
    --pools .../pools.json \
    --simulate-only
```

This will print a JSON report with computed prices, spreads, PnL, and logs.

---

### 5. Execute real swap (no `--simulate-only`)
```bash
 npx tsc &&  node dist/src/index.js \
    --rpc-url https://api.devnet.solana.com \
    --keypair .../id.json \
    --amount-in 0.01 \
    --spread-threshold-bps 5 \
    --slippage-bps 30 \
    --priority-fee 0 \
    --pools .../pools.json \
```

---

## Options

| Flag | Description |
|------|-------------|
| `--rpc-url` | Solana RPC endpoint |
| `--keypair` | Path to keypair JSON |
| `--amount-in` | Input amount (in token A) |
| `--spread-threshold-bps` | Minimum spread in bps to trigger a trade |
| `--slippage-bps` | Slippage tolerance in bps |
| `--priority-fee` | MicroLamports per CU for priority fee |
| `--pools` | Path to pools JSON |
| `--simulate-only` | Run in simulation mode (no transaction sent) |

---

## Example Output (simulation)

```json
{
  "steps": [
    "Loaded poolA: fee=0 bps reservesA=0.1 reservesB=50",
    "Loaded poolB: fee=0 bps reservesA=0.1 reservesB=50",
    "Prices: priceA=500.00000000 priceB=500.00000000 spread_bps=0.00"
  ],
  "decision": {
    "priceA": 500,
    "priceB": 500,
    "spread_bps": 0,
    "meets_threshold": false,
    "expected_out_leg1": 45.45,
    "expected_out_leg2": 0.047,
    "pnl_tokens": -0.95,
    "trade_allowed": false
  }
}
```
