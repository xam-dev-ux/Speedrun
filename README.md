# B20 Speedrun

A public dApp on Base that demonstrates every feature of B20 — Base's native token standard — in a guided, gamified flow.

Deploy two B20 tokens (Asset + Stablecoin) via the `B20Factory` precompile, exercise all 40 capabilities one by one, and call `renounceLastAdmin` to seal the run as immutable onchain evidence.

---

## Network activation schedule

| Network | Upgrade | Timestamp | Date (UTC) |
|---|---|---|---|
| **Base Sepolia** | Beryl | `1781805600` | **2026-06-18 18:00 UTC** |
| **Base Mainnet** | Beryl | `1782410400` | **2026-06-25 18:00 UTC** |

All code is complete and ready. The UI shows a countdown banner until activation. Nothing needs to change — the app detects activation automatically by calling `eth_getCode` at the B20Factory address (`0xB20f000000000000000000000000000000000000`).

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| Foundry | latest | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| git | any | — |

---

## Repo layout

```
/contracts
  src/Speedrun.sol          ← Onchain scorekeeper (40 steps, uint64 bitmap)
  script/Deploy.s.sol       ← forge script deploy
  test/Speedrun.t.sol       ← Foundry tests (mock precompile via vm.etch)
  foundry.toml
  remappings.txt

/web                        ← Next.js 14 (App Router)
  app/
    layout.tsx
    page.tsx                ← Landing + activation banner + leaderboard
    run/page.tsx            ← Active speedrun dashboard (all 40 steps)
    profile/[addr]/page.tsx ← Public per-runner view + step checklist
  components/
    Providers.tsx           ← wagmi + RainbowKit providers
    ActivationBanner.tsx    ← Live countdown to Beryl activation
    StepCard.tsx            ← Individual step with Execute + Mark Done
    LevelGrid.tsx           ← 5-level grid of StepCards
    PauseProbe.tsx          ← Simulates paused op and captures revert proof
  lib/
    abis/
      B20.ts                ← IB20 ABI (both token variants)
      B20Asset.ts           ← IB20Asset extensions (announce, multiplier, etc.)
      B20Factory.ts         ← IB20Factory ABI + B20Variant enum
      PolicyRegistry.ts     ← IPolicyRegistry ABI + PolicyType enum
      Speedrun.ts           ← Speedrun ABI + bytecode (populated by make sync-abi)
    addresses.ts            ← Precompile addresses + Beryl activation timestamps
    wagmi.ts                ← wagmi config (Base Sepolia + Mainnet)
    steps.ts                ← All 40 step definitions with prereqs, gas, doc links
    hooks.ts                ← useActivationStatus, useBerylCountdown, useSpeedrunProgress

/scripts
  sync-abi.js               ← Copies ABI+bytecode from forge out/ to web/lib/abis/Speedrun.ts

Makefile                    ← install, build, test, sync-abi, deploy-*, web-dev
.env.example                ← Required env vars (never commit .env)
```

---

## Quick start

```bash
# 1. Clone
git clone <this-repo>
cd Speedrun

# 2. Copy env and fill in your values
cp .env.example .env
# Edit .env: set BASE_SEPOLIA_RPC_URL, PRIVATE_KEY, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

# 3. Install everything (forge-std + npm deps)
make install

# 4. Build contracts + sync ABI to the web app
make sync-abi

# 5. Run tests
make test

# 6. Start the frontend
make web-dev
# → http://localhost:3000
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BASE_MAINNET_RPC_URL` | Contracts | RPC for Base mainnet (default: `https://mainnet.base.org`) |
| `BASE_SEPOLIA_RPC_URL` | Contracts | RPC for Base Sepolia (default: `https://sepolia.base.org`) |
| `PRIVATE_KEY` | Deploy only | Deployer key for `forge script`. Never used by the web app. |
| `BASESCAN_API_KEY` | Optional | For `--verify` on deploy. Get free at basescan.org. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Frontend | Free at cloud.walletconnect.com |
| `NEXT_PUBLIC_SPEEDRUN_ADDRESS` | Optional | Pre-fill the Speedrun contract address in the UI |

---

## Deploying to Base Sepolia (after 2026-06-18 18:00 UTC)

```bash
# Deploy Speedrun.sol
make deploy-sepolia

# The script prints the contract address and the cast command for initTokens.
# Example:
# Source your .env so PRIVATE_KEY is in the environment (not passed as CLI arg)
export $(grep -v '^#' .env | xargs)

# Deploy — the script reads PRIVATE_KEY via vm.envUint(), never from --private-key flag
make deploy-sepolia

# Call initTokens() using an encrypted keystore (safest approach):
# First time only: cast wallet import speedrun --interactive
cast send <SPEEDRUN_ADDR> \
  "initTokens(bytes32,bytes32,string)" \
  0x6173736574000000000000000000000000000000000000000000000000000000 \
  0x737461626c650000000000000000000000000000000000000000000000000000 \
  "USD" \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --account speedrun
```

Salts are arbitrary `bytes32` values. Pick any two different ones.

---

## Deploying to Base Mainnet (after 2026-06-25 18:00 UTC)

```bash
make deploy-mainnet   # prompts for confirmation
```

---

## The 40 steps

### Level 1 — Factory & Roles (steps 1–9)

| # | Operation | Token | Gas est. |
|---|---|---|---|
| 1 | Deploy Asset token (decimals=12) via `initTokens()` | Asset | 180k |
| 2 | Deploy Stablecoin token (immutable currency code) | Stable | 160k |
| 3 | `grantRole(MINT_ROLE, deployer)` | Asset | 45k |
| 4 | `grantRole(BURN_ROLE, deployer)` | Asset | 45k |
| 5 | `grantRole(BURN_BLOCKED_ROLE, deployer)` | Asset | 45k |
| 6 | `grantRole(PAUSE_ROLE, deployer)` | Asset | 45k |
| 7 | `grantRole(UNPAUSE_ROLE, deployer)` | Asset | 45k |
| 8 | `grantRole(METADATA_ROLE, deployer)` | Asset | 45k |
| 9 | `grantRole(OPERATOR_ROLE, deployer)` on Asset | Asset | 45k |

### Level 2 — Policies (steps 10–18)

| # | Operation | Target | Gas est. |
|---|---|---|---|
| 10 | `PolicyRegistry.createPolicy(admin, BLOCKLIST)` → `blocklistId` | PolicyRegistry | 60k |
| 11 | `PolicyRegistry.createPolicy(admin, ALLOWLIST)` → `allowlistId` | PolicyRegistry | 60k |
| 12 | `updateBlocklist(blocklistId, true, [victim])` | PolicyRegistry | 55k |
| 13 | `updateAllowlist(allowlistId, true, [addr])` | PolicyRegistry | 55k |
| 14 | `updatePolicy(TRANSFER_SENDER_POLICY, blocklistId)` | Asset | 50k |
| 15 | `updatePolicy(TRANSFER_RECEIVER_POLICY, allowlistId)` | Asset | 50k |
| 16 | `updatePolicy(TRANSFER_EXECUTOR_POLICY, policyId)` | Asset | 50k |
| 17 | `updatePolicy(MINT_RECEIVER_POLICY, allowlistId)` | Asset | 50k |
| 18 | `stageUpdateAdmin(policyId, newAdmin)` + `finalizeUpdateAdmin(policyId)` | PolicyRegistry | 80k |

### Level 3 — Movement (steps 19–29)

| # | Operation | Token | Gas est. |
|---|---|---|---|
| 19 | `mint(to, amount)` | Asset | 55k |
| 20 | `mintWithMemo(to, amount, memo)` | Asset | 60k |
| 21 | `transfer(to, amount)` | Asset | 55k |
| 22 | `transferWithMemo(to, amount, memo)` | Asset | 60k |
| 23 | `approve(spender, amount)` + `transferFrom(from, to, amount)` | Asset | 70k |
| 24 | `transferFromWithMemo(from, to, amount, memo)` | Asset | 75k |
| 25 | `burn(amount)` | Asset | 50k |
| 26 | `burnWithMemo(amount, memo)` | Asset | 55k |
| 27 | Mint to victim → `burnBlocked(victim, amount)` | Asset | 80k |
| 28 | `updateSupplyCap(newCap)` | Asset | 45k |
| 29 | EIP-712 off-chain sign → `permit(owner, spender, value, deadline, v, r, s)` | Asset | 65k |

### Level 4 — Asset Specials (steps 30–35)

| # | Operation | Token | Gas est. |
|---|---|---|---|
| 30 | `updateMultiplier(newMultiplier)` — UI shows `scaledBalanceOf` before/after | Asset | 50k |
| 31 | `announce([batchMint(…)], id, description, uri)` — posts disclosure + mints atomically | Asset | 150k |
| 32 | `updateExtraMetadata("twitter", "@…")` then `updateExtraMetadata("twitter", "")` to delete | Asset | 60k |
| 33 | `updateName(newName)` — emits `NameUpdated` + `EIP712DomainChanged` | Asset | 50k |
| 34 | `updateSymbol(newSymbol)` — emits `SymbolUpdated` (no EIP712DomainChanged) | Asset | 50k |
| 35 | `updateContractURI(newURI)` — emits parameterless `ContractURIUpdated` per ERC-7572 | Asset | 50k |

### Boss — Pause & Renounce (steps 36–40)

| # | Operation | Notes |
|---|---|---|
| 36 | `pause([TRANSFER])` | UI auto-probes `transfer` → captures `ContractPaused(TRANSFER)` revert |
| 37 | `pause([MINT])` | UI auto-probes `mint` → captures `ContractPaused(MINT)` revert |
| 38 | `pause([BURN])` | UI auto-probes `burn` → captures `ContractPaused(BURN)` revert |
| 39 | `unpause([TRANSFER, MINT, BURN])` | Unpauses all three in one call |
| 40 | `renounceLastAdmin()` on **both** tokens | **IRREVERSIBLE** — triple-confirm modal. Caller must be sole admin. |

**Total estimated cost:** ~$1–3 at typical Base fees (1–5 gwei).

---

## Key B20 facts (pre-code research)

Verified from `base/base-std` and `eth_getCode` on both networks:

| Precompile | Address |
|---|---|
| B20Factory | `0xB20f000000000000000000000000000000000000` |
| ActivationRegistry | `0x8453000000000000000000000000000000000001` |
| PolicyRegistry | `0x8453000000000000000000000000000000000002` |

**Struct layouts** (version must be `1`):
```solidity
// Asset
abi.encode(uint8(1), name, symbol, initialAdmin, uint8(decimals))
// Stablecoin
abi.encode(uint8(1), name, symbol, initialAdmin, currency)
```

**Divergences from original spec:**
- `announce(internalCalls, id, description, uri)` — `id` is `string`, not `bytes32`
- `pause` / `unpause` take `uint8[]` (feature array), not a single feature
- `renounceLastAdmin` requires caller to be **sole** DEFAULT_ADMIN holder (check before calling)
- ERC-2612 `permit`: EOA signatures only — ERC-1271 contract signatures **not supported**

---

## Architecture decisions

1. **Single-player per deployment**: each runner deploys their own `Speedrun.sol`. No factory pattern.
2. **Progress stored onchain as `uint64` bitmap**: bit `i` = step `i` complete. 40 steps fit with headroom.
3. **`markStep` is honor-system**: the runner provides the proving tx hash. The event log is the permanent evidence.
4. **Speedrun.sol does NOT forward B20 calls**: the player calls B20 tokens and PolicyRegistry directly from their wallet. `markStep` is a separate write.
5. **Activation detection**: `useActivationStatus()` calls `eth_getCode` at the factory address. If empty → shows banner. Auto-clears when Beryl activates.

---

## Running tests (mock precompile via vm.etch)

```bash
make test
# or verbose:
make test-verbose
```

The test file deploys a `MockB20Factory` at `0xB20f000000000000000000000000000000000000` using Foundry's `vm.etch`, then tests all Speedrun.sol logic without needing live precompiles.

---

## Frontend deployment (Vercel)

```bash
# Push to GitHub, then in Vercel:
# Root directory: web
# Build command: npm run build
# Output directory: .next

# Environment variables in Vercel dashboard:
# NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
# NEXT_PUBLIC_SPEEDRUN_ADDRESS=...  (after you deploy the contract)
```

---

## After deployment — checklist

- [ ] `forge build` succeeds
- [ ] `make test` → all tests pass (uses mock precompile)
- [ ] `make sync-abi` → bytecode populated in `web/lib/abis/Speedrun.ts`
- [ ] **2026-06-18 18:00 UTC** → Beryl activates on Base Sepolia
- [ ] Deploy Speedrun.sol to Sepolia via `make deploy-sepolia`
- [ ] Call `initTokens()` with your chosen salts + currency
- [ ] Run all 40 steps via the UI
- [ ] `renounceLastAdmin` on both tokens (step 40)
- [ ] **2026-06-25 18:00 UTC** → Beryl activates on Base Mainnet
- [ ] Repeat on mainnet for the permanent run
- [ ] Add deployed addresses to this README
- [ ] Deploy frontend to Vercel

---

## Deployed instances

> _To be filled in after Beryl activates._

| Network | Speedrun contract | Asset token | Stablecoin token |
|---|---|---|---|
| Base Sepolia | — | — | — |
| Base Mainnet | — | — | — |

---

## References

- [B20 specification](https://docs.base.org/base-chain/specs/upgrades/beryl/b20)
- [Beryl upgrade overview](https://docs.base.org/base-chain/specs/upgrades/beryl/overview)
- [base/base-std — interfaces + constants](https://github.com/base/base-std)
- [BaseScan](https://basescan.org)
- [Base Sepolia Explorer](https://sepolia.basescan.org)
