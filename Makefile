.PHONY: install build test sync-abi deploy-sepolia deploy-mainnet web-dev web-build

BASE_SEPOLIA_RPC_URL ?= https://sepolia.base.org
BASE_MAINNET_RPC_URL ?= https://mainnet.base.org
BASE_LOCAL_RPC_URL   ?= http://127.0.0.1:8545
BASESCAN_API_KEY     ?= $(shell grep -E '^BASESCAN_API_KEY=' .env 2>/dev/null | cut -d= -f2-)
KEYSTORE_WALLET      ?= 0x8F058fE6b568D97f85d517Ac441b52B95722fDDe
export BASESCAN_API_KEY

# ── Setup ──────────────────────────────────────────────────────────────────
install:
	cd contracts && forge install foundry-rs/forge-std
	cd web && npm install

# ── Contracts ──────────────────────────────────────────────────────────────
build:
	cd contracts && forge build

test:
	cd contracts && forge test -vv

test-verbose:
	cd contracts && forge test -vvvv

# Sync Speedrun ABI + bytecode from Foundry output to web/lib/abis/Speedrun.ts
sync-abi: build
	node scripts/sync-abi.js

# ── Deploy ─────────────────────────────────────────────────────────────────
deploy-sepolia:
	@# Uses encrypted keystore — key never in CLI args, env vars, or logs.
	@# One-time setup: cast wallet import speedrun --interactive
	cd contracts && forge script script/Deploy.s.sol \
		--rpc-url $(BASE_SEPOLIA_RPC_URL) \
		--account speedrun \
		--broadcast \
		--verify \
		-vv; true

level1-sepolia:
	cd contracts && forge script script/Level1.s.sol \
		--rpc-url $(BASE_SEPOLIA_RPC_URL) \
		--account speedrun \
		--broadcast -vv

deploy-mainnet:
	@echo "⚠️  Deploying to BASE MAINNET. Press Ctrl-C to cancel, Enter to continue."
	@read _
	cd contracts && forge script script/Deploy.s.sol \
		--rpc-url $(BASE_MAINNET_RPC_URL) \
		--account speedrun \
		--broadcast \
		--verify \
		-vv; true

# ── Local (base-anvil) ─────────────────────────────────────────────────────
# Starts base-anvil, funds the keystore wallet, and deploys Speedrun.sol.
# Use: make anvil-start (in one terminal), then make deploy-local / test-local.
anvil-start:
	base-anvil --chain-id 8453

anvil-fund:
	@# Fund keystore wallet from anvil dev account 0
	base-cast send $(KEYSTORE_WALLET) \
		--value 10ether \
		--rpc-url $(BASE_LOCAL_RPC_URL) \
		--private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

deploy-local: anvil-fund
	@echo "Deploying to local base-anvil (chain 8453)..."
	cd contracts && forge script script/Deploy.s.sol \
		--rpc-url $(BASE_LOCAL_RPC_URL) \
		--account speedrun \
		--broadcast \
		-vv

test-local:
	cd contracts && FOUNDRY_PROFILE=local base-forge test -vv

# ── Frontend ───────────────────────────────────────────────────────────────
web-dev:
	cd web && npm run dev

web-build:
	cd web && npm run build

web-typecheck:
	cd web && npm run typecheck

# ── All-in-one ─────────────────────────────────────────────────────────────
all: install sync-abi web-build test
