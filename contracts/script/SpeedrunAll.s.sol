// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Script.sol";
import "forge-std/console.sol";

// ── Precompile + contract addresses ──────────────────────────────────────────
address constant B20_FACTORY_ADDR     = 0xB20f000000000000000000000000000000000000;
address constant POLICY_REGISTRY_ADDR = 0x8453000000000000000000000000000000000002;

// Victim for blocklist / burnBlocked demo
address constant VICTIM = 0x000000000000000000000000000000000000dEaD;

// ── Interfaces ────────────────────────────────────────────────────────────────

interface ISpeedrun {
    function initTokens(bytes32 saltAsset, bytes32 saltStable, string calldata currencyCode) external;
    function markStep(uint8 stepId, bytes32 txRef, bytes32 memo) external;
    function assetToken() external view returns (address);
    function stablecoinToken() external view returns (address);
    function initialized() external view returns (bool);
    function progress() external view returns (uint256);
}

interface IPolicyRegistry {
    enum PolicyType { BLOCKLIST, ALLOWLIST }
    function createPolicy(address admin, PolicyType policyType) external returns (uint64 newPolicyId);
    function updateBlocklist(uint64 policyId, bool blocked, address[] calldata accounts) external;
    function updateAllowlist(uint64 policyId, bool allowed, address[] calldata accounts) external;
    function stageUpdateAdmin(uint64 policyId, address newAdmin) external;
    function finalizeUpdateAdmin(uint64 policyId) external;
}

// Shared IB20 methods used on both Asset and Stablecoin tokens
interface IB20Base {
    function grantRole(bytes32 role, address account) external;
    function renounceLastAdmin() external;
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonces(address owner) external view returns (uint256);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
    function balanceOf(address account) external view returns (uint256);
}

// Asset token — full interface
interface IB20Asset is IB20Base {
    // ERC-20
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transferWithMemo(address to, uint256 amount, bytes32 memo) external returns (bool);
    function transferFromWithMemo(address from, address to, uint256 amount, bytes32 memo) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    // Mint / Burn
    function mint(address to, uint256 amount) external;
    function mintWithMemo(address to, uint256 amount, bytes32 memo) external;
    function batchMint(address[] calldata recipients, uint256[] calldata amounts) external;
    function burn(uint256 amount) external;
    function burnWithMemo(uint256 amount, bytes32 memo) external;
    function burnBlocked(address from, uint256 amount) external;
    // Policy
    function updatePolicy(bytes32 policyScope, uint64 newPolicyId) external;
    function TRANSFER_SENDER_POLICY() external view returns (bytes32);
    function TRANSFER_RECEIVER_POLICY() external view returns (bytes32);
    function TRANSFER_EXECUTOR_POLICY() external view returns (bytes32);
    function MINT_RECEIVER_POLICY() external view returns (bytes32);
    // Supply cap
    function updateSupplyCap(uint256 newSupplyCap) external;
    // Pause
    function pause(uint8[] calldata features) external;
    function unpause(uint8[] calldata features) external;
    // Asset specials
    function updateMultiplier(uint256 newMultiplier) external;
    function announce(bytes[] calldata internalCalls, string calldata id, string calldata description, string calldata uri) external;
    function updateExtraMetadata(string calldata key, string calldata value) external;
    function updateName(string calldata newName) external;
    function updateSymbol(string calldata newSymbol) external;
    function updateContractURI(string calldata newURI) external;
}

// ── Script ────────────────────────────────────────────────────────────────────

contract SpeedrunAll is Script {
    // Role constants (keccak256 of role name strings)
    bytes32 constant MINT_ROLE         = keccak256("MINT_ROLE");
    bytes32 constant BURN_ROLE         = keccak256("BURN_ROLE");
    bytes32 constant BURN_BLOCKED_ROLE = keccak256("BURN_BLOCKED_ROLE");
    bytes32 constant PAUSE_ROLE        = keccak256("PAUSE_ROLE");
    bytes32 constant UNPAUSE_ROLE      = keccak256("UNPAUSE_ROLE");
    bytes32 constant METADATA_ROLE     = keccak256("METADATA_ROLE");
    bytes32 constant OPERATOR_ROLE     = keccak256("OPERATOR_ROLE");

    // ERC-2612 permit type hash
    bytes32 constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    // PausableFeature indices: 0=TRANSFER, 1=MINT, 2=BURN
    uint8 constant FEAT_TRANSFER = 0;
    uint8 constant FEAT_MINT     = 1;
    uint8 constant FEAT_BURN     = 2;

    function run() external {
        // Read target contract from env; falls back to the completed first run.
        address speedrunAddr = vm.envOr("SPEEDRUN_CONTRACT", address(0x77132DB890Cd19BA41fb7E516AEd4812e84e8790));

        // Hardcoded broadcast account — msg.sender in script context is the Foundry DefaultSender,
        // not the keystore wallet. After vm.startBroadcast(), external calls go FROM this wallet.
        address deployer = 0x8F058fE6b568D97f85d517Ac441b52B95722fDDe;

        // Ephemeral key for ERC-2612 permit demo (publicly derived — not a production key)
        uint256 permitKey   = uint256(keccak256(bytes("speedrun_permit_test")));
        address permitOwner = vm.addr(permitKey);

        ISpeedrun       sr        = ISpeedrun(speedrunAddr);
        IPolicyRegistry policyReg = IPolicyRegistry(POLICY_REGISTRY_ADDR);

        console.log("Speedrun contract:", speedrunAddr);

        console.log("Deployer:", deployer);
        console.log("Permit signer:", permitOwner);

        vm.startBroadcast();

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 1 — initTokens  (steps 0 + 1)
        // Skip if already done (resume after partial broadcast)
        // ═══════════════════════════════════════════════════════════════════
        uint256 prog = sr.progress();
        if (!sr.initialized()) {
            sr.initTokens(bytes32("asset"), bytes32("stable"), "USD");
            sr.markStep(0, bytes32(0), bytes32(0));  // Deploy Asset token
            sr.markStep(1, bytes32(0), bytes32(0));  // Deploy Stablecoin token
            prog = 3;
        }

        IB20Asset asset = IB20Asset(sr.assetToken());
        IB20Base  stable = IB20Base(sr.stablecoinToken());

        console.log("Asset token:      ", address(asset));
        console.log("Stablecoin token: ", address(stable));

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 2 — Grant all 7 roles on Asset  (steps 2–8)
        // ═══════════════════════════════════════════════════════════════════
        if ((prog >> 2) & 1 == 0) { asset.grantRole(MINT_ROLE,         deployer); sr.markStep(2, bytes32(0), bytes32(0)); }
        if ((prog >> 3) & 1 == 0) { asset.grantRole(BURN_ROLE,         deployer); sr.markStep(3, bytes32(0), bytes32(0)); }
        if ((prog >> 4) & 1 == 0) { asset.grantRole(BURN_BLOCKED_ROLE, deployer); sr.markStep(4, bytes32(0), bytes32(0)); }
        if ((prog >> 5) & 1 == 0) { asset.grantRole(PAUSE_ROLE,        deployer); sr.markStep(5, bytes32(0), bytes32(0)); }
        if ((prog >> 6) & 1 == 0) { asset.grantRole(UNPAUSE_ROLE,      deployer); sr.markStep(6, bytes32(0), bytes32(0)); }
        if ((prog >> 7) & 1 == 0) { asset.grantRole(METADATA_ROLE,     deployer); sr.markStep(7, bytes32(0), bytes32(0)); }
        if ((prog >> 8) & 1 == 0) { asset.grantRole(OPERATOR_ROLE,     deployer); sr.markStep(8, bytes32(0), bytes32(0)); }

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 3 — Create policies + membership  (steps 9–12)
        // ═══════════════════════════════════════════════════════════════════
        uint64 blocklistId;
        uint64 allowlistId;

        if ((prog >> 9) & 1 == 0) {
            blocklistId = policyReg.createPolicy(deployer, IPolicyRegistry.PolicyType.BLOCKLIST);
            sr.markStep(9, bytes32(0), bytes32(0));
            console.log("Blocklist policy ID:", blocklistId);
        } else {
            blocklistId = 2; // known from on-chain creation
        }

        if ((prog >> 10) & 1 == 0) {
            allowlistId = policyReg.createPolicy(deployer, IPolicyRegistry.PolicyType.ALLOWLIST);
            sr.markStep(10, bytes32(0), bytes32(0));
            console.log("Allowlist policy ID:", allowlistId);
        } else {
            allowlistId = 72057594037927939; // known from on-chain creation
        }

        if ((prog >> 11) & 1 == 0) {
            address[] memory victims = new address[](1);
            victims[0] = VICTIM;
            policyReg.updateBlocklist(blocklistId, true, victims);
            sr.markStep(11, bytes32(0), bytes32(0));
        }

        if ((prog >> 12) & 1 == 0) {
            address[] memory allowed = new address[](3);
            allowed[0] = deployer;
            allowed[1] = VICTIM;
            allowed[2] = permitOwner;
            policyReg.updateAllowlist(allowlistId, true, allowed);
            sr.markStep(12, bytes32(0), bytes32(0));
        }

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 4 — Token movement  (steps 18–28, plus step 13 mid-phase)
        //
        // We bind TRANSFER_SENDER_POLICY before burnBlocked so the victim
        // is "blocked from sending" as burnBlocked requires.
        // All other policies stay unbound until Phase 5, so mints/transfers
        // work without allowlist restrictions.
        // ═══════════════════════════════════════════════════════════════════

        // Step 18 — mint
        if ((prog >> 18) & 1 == 0) { asset.mint(deployer, 10_000e12); sr.markStep(18, bytes32(0), bytes32(0)); }

        // Step 19 — mintWithMemo
        if ((prog >> 19) & 1 == 0) { asset.mintWithMemo(deployer, 1_000e12, bytes32("memo1")); sr.markStep(19, bytes32(0), bytes32(0)); }

        // Setup mints (no markStep): only needed if burnBlocked/permit not done yet
        if ((prog >> 26) & 1 == 0) asset.mint(VICTIM,      500e12);
        if ((prog >> 28) & 1 == 0) asset.mint(permitOwner, 100e12);

        // Step 13 — bind TRANSFER_SENDER_POLICY = blocklist
        if ((prog >> 13) & 1 == 0) { asset.updatePolicy(asset.TRANSFER_SENDER_POLICY(), blocklistId); sr.markStep(13, bytes32(0), bytes32(0)); }

        // Step 20 — transfer
        if ((prog >> 20) & 1 == 0) { asset.transfer(deployer, 100e12); sr.markStep(20, bytes32(0), bytes32(0)); }

        // Step 21 — transferWithMemo
        if ((prog >> 21) & 1 == 0) { asset.transferWithMemo(deployer, 100e12, bytes32("memo2")); sr.markStep(21, bytes32(0), bytes32(0)); }

        // Step 22 — transferFrom
        if ((prog >> 22) & 1 == 0) { asset.approve(deployer, 200e12); asset.transferFrom(deployer, deployer, 100e12); sr.markStep(22, bytes32(0), bytes32(0)); }

        // Step 23 — transferFromWithMemo
        if ((prog >> 23) & 1 == 0) { asset.approve(deployer, 200e12); asset.transferFromWithMemo(deployer, deployer, 100e12, bytes32("memo3")); sr.markStep(23, bytes32(0), bytes32(0)); }

        // Step 24 — burn
        if ((prog >> 24) & 1 == 0) { asset.burn(50e12); sr.markStep(24, bytes32(0), bytes32(0)); }

        // Step 25 — burnWithMemo
        if ((prog >> 25) & 1 == 0) { asset.burnWithMemo(50e12, bytes32("burn1")); sr.markStep(25, bytes32(0), bytes32(0)); }

        // Step 26 — burnBlocked (VICTIM blocked by TRANSFER_SENDER_POLICY)
        if ((prog >> 26) & 1 == 0) { asset.burnBlocked(VICTIM, 500e12); sr.markStep(26, bytes32(0), bytes32(0)); }

        // Step 27 — updateSupplyCap
        if ((prog >> 27) & 1 == 0) { asset.updateSupplyCap(1_000_000_000e12); sr.markStep(27, bytes32(0), bytes32(0)); }

        // Step 28 — ERC-2612 permit + transferFrom
        if ((prog >> 28) & 1 == 0) {
            bytes32 domainSep = asset.DOMAIN_SEPARATOR();
            uint256 nonce     = asset.nonces(permitOwner);
            uint256 deadline  = block.timestamp + 7 days;
            uint256 permitAmt = 50e12;

            bytes32 structHash = keccak256(abi.encode(
                PERMIT_TYPEHASH,
                permitOwner,
                deployer,
                permitAmt,
                nonce,
                deadline
            ));
            bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(permitKey, digest);

            asset.permit(permitOwner, deployer, permitAmt, deadline, v, r, s);
            asset.transferFrom(permitOwner, deployer, permitAmt);
            sr.markStep(28, bytes32(0), bytes32(0));
        }

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 5 — Bind remaining policies + 2-step admin transfer
        //           (steps 14–17)
        // ═══════════════════════════════════════════════════════════════════

        // Step 14 — TRANSFER_RECEIVER_POLICY = allowlist
        if ((prog >> 14) & 1 == 0) { asset.updatePolicy(asset.TRANSFER_RECEIVER_POLICY(), allowlistId); sr.markStep(14, bytes32(0), bytes32(0)); }

        // Step 15 — TRANSFER_EXECUTOR_POLICY = blocklist
        if ((prog >> 15) & 1 == 0) { asset.updatePolicy(asset.TRANSFER_EXECUTOR_POLICY(), blocklistId); sr.markStep(15, bytes32(0), bytes32(0)); }

        // Step 16 — MINT_RECEIVER_POLICY = allowlist
        if ((prog >> 16) & 1 == 0) { asset.updatePolicy(asset.MINT_RECEIVER_POLICY(), allowlistId); sr.markStep(16, bytes32(0), bytes32(0)); }

        // Step 17 — two-step policy admin transfer (stage→self, finalize)
        if ((prog >> 17) & 1 == 0) {
            policyReg.stageUpdateAdmin(blocklistId, deployer);
            policyReg.finalizeUpdateAdmin(blocklistId);
            sr.markStep(17, bytes32(0), bytes32(0));
        }

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 6 — Asset specials  (steps 29–34)
        // ═══════════════════════════════════════════════════════════════════

        // Step 29 — updateMultiplier (WAD = 1e18; set to 2x)
        if ((prog >> 29) & 1 == 0) { asset.updateMultiplier(2e18); sr.markStep(29, bytes32(0), bytes32(0)); }

        // Step 30 — announce + batchMint as internalCall
        if ((prog >> 30) & 1 == 0) {
            address[] memory recipients = new address[](1);
            recipients[0] = deployer;
            uint256[] memory amounts = new uint256[](1);
            amounts[0] = 1e12;

            bytes[] memory internalCalls = new bytes[](1);
            internalCalls[0] = abi.encodeCall(IB20Asset.batchMint, (recipients, amounts));

            asset.announce(
                internalCalls,
                "speedrun-b20-1",
                "B20 Speedrun completed on Base mainnet",
                "https://speedrun.base.org"
            );
            sr.markStep(30, bytes32(0), bytes32(0));
        }

        // Step 31 — updateExtraMetadata set + delete
        if ((prog >> 31) & 1 == 0) {
            asset.updateExtraMetadata("twitter", "@speedrunB20");
            asset.updateExtraMetadata("twitter", "");
            sr.markStep(31, bytes32(0), bytes32(0));
        }

        // Step 32 — updateName
        if ((prog >> 32) & 1 == 0) { asset.updateName("Speedrun Asset v2"); sr.markStep(32, bytes32(0), bytes32(0)); }

        // Step 33 — updateSymbol
        if ((prog >> 33) & 1 == 0) { asset.updateSymbol("SRA2"); sr.markStep(33, bytes32(0), bytes32(0)); }

        // Step 34 — updateContractURI
        if ((prog >> 34) & 1 == 0) { asset.updateContractURI("https://speedrun.base.org/asset"); sr.markStep(34, bytes32(0), bytes32(0)); }

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 7 — Boss: Pause & Renounce  (steps 35–39)
        // ═══════════════════════════════════════════════════════════════════

        uint8[] memory feat1 = new uint8[](1);

        // Step 35 — pause(TRANSFER)
        if ((prog >> 35) & 1 == 0) { feat1[0] = FEAT_TRANSFER; asset.pause(feat1); sr.markStep(35, bytes32(0), bytes32(0)); }

        // Step 36 — pause(MINT)
        if ((prog >> 36) & 1 == 0) { feat1[0] = FEAT_MINT; asset.pause(feat1); sr.markStep(36, bytes32(0), bytes32(0)); }

        // Step 37 — pause(BURN)
        if ((prog >> 37) & 1 == 0) { feat1[0] = FEAT_BURN; asset.pause(feat1); sr.markStep(37, bytes32(0), bytes32(0)); }

        // Step 38 — unpause all three features
        if ((prog >> 38) & 1 == 0) {
            uint8[] memory allFeats = new uint8[](3);
            allFeats[0] = FEAT_TRANSFER;
            allFeats[1] = FEAT_MINT;
            allFeats[2] = FEAT_BURN;
            asset.unpause(allFeats);
            sr.markStep(38, bytes32(0), bytes32(0));
        }

        // Step 39 — renounceLastAdmin on BOTH tokens (IRREVERSIBLE)
        if ((prog >> 39) & 1 == 0) {
            asset.renounceLastAdmin();
            stable.renounceLastAdmin();
            sr.markStep(39, bytes32(0), bytes32(0));
        }

        vm.stopBroadcast();

        console.log("=== SPEEDRUN COMPLETE: all 40 steps marked ===");
    }
}
