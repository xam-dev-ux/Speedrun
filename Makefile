.PHONY: install build test sync-abi deploy-sepolia deploy-mainnet web-dev web-build

# ── Setup ──────────────────────────────────────────────────────────────────
install:
	cd contracts && forge install foundry-rs/forge-std --no-commit
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
	@# PRIVATE_KEY is read inside the script via vm.envUint("PRIVATE_KEY").
	@# Do NOT pass it as --private-key: that exposes it in `ps aux` and shell history.
	@test -n "$$PRIVATE_KEY" || (echo "❌  Set PRIVATE_KEY in .env and source it first"; exit 1)
	cd contracts && forge script script/Deploy.s.sol \
		--rpc-url $(BASE_SEPOLIA_RPC_URL) \
		--broadcast \
		--verify \
		-vv

deploy-mainnet:
	@test -n "$$PRIVATE_KEY" || (echo "❌  Set PRIVATE_KEY in .env and source it first"; exit 1)
	@echo "⚠️  Deploying to BASE MAINNET. Press Ctrl-C to cancel, Enter to continue."
	@read _
	cd contracts && forge script script/Deploy.s.sol \
		--rpc-url $(BASE_MAINNET_RPC_URL) \
		--broadcast \
		--verify \
		-vv

# ── Frontend ───────────────────────────────────────────────────────────────
web-dev:
	cd web && npm run dev

web-build:
	cd web && npm run build

web-typecheck:
	cd web && npm run typecheck

# ── All-in-one ─────────────────────────────────────────────────────────────
all: install sync-abi web-build test
