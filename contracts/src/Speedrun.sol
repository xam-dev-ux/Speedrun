// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Minimal interface for the B20Factory precompile (Beryl upgrade).
/// @dev    Precompile address: 0xB20f000000000000000000000000000000000000
interface IB20Factory {
    enum B20Variant { ASSET, STABLECOIN }

    // params must be abi.encode(struct) — the factory decodes as a dynamic tuple (0x20 offset prefix).
    struct B20AssetCreateParams {
        uint8 version;      // must be 1
        string name;
        string symbol;
        address initialAdmin;
        uint8 decimals;     // 6–18
    }

    struct B20StablecoinCreateParams {
        uint8 version;      // must be 1
        string name;
        string symbol;
        address initialAdmin;
        string currency;    // A–Z only, immutable
    }

    function createB20(
        B20Variant variant,
        bytes32 salt,
        bytes calldata params,
        bytes[] calldata initCalls
    ) external payable returns (address token);

    function getB20Address(
        B20Variant variant,
        address deployer,
        bytes32 salt
    ) external view returns (address);

    function isB20(address token) external view returns (bool);
    function isB20Initialized(address token) external view returns (bool);
}

/// @title  Speedrun
/// @notice Onchain scorekeeper for the B20 feature speedrun.
///
/// One deployment per runner. The deployer creates two B20 tokens (Asset + Stablecoin)
/// via initTokens(), then exercises all 40 B20 capabilities one by one, calling
/// markStep(stepId, txRef, memo) after each to record the evidence onchain.
///
/// End state: caller invokes renounceLastAdmin on both tokens (step 39), sealing
/// the run as immutable evidence. The Speedrun contract itself stays readable forever.
///
/// Steps are 0-indexed (0–39) mapping to spec steps 1–40:
///   Level 1  (0–8):  Factory & roles
///   Level 2  (9–17): Policies
///   Level 3 (18–28): Token movement
///   Level 4 (29–34): Asset specials
///   Boss    (35–39): Pause & renounce
contract Speedrun {
    // ── Precompile ────────────────────────────────────────────────────────
    address public constant B20_FACTORY = 0xB20f000000000000000000000000000000000000;

    // ── Constants ─────────────────────────────────────────────────────────
    uint8 public constant TOTAL_STEPS = 40;

    // ── Immutables ────────────────────────────────────────────────────────
    address public immutable deployer;

    // ── State ─────────────────────────────────────────────────────────────
    address public assetToken;
    address public stablecoinToken;

    /// @dev Bitmap: bit i is set iff step i has been completed.
    uint64 public progress;

    uint256 public startedAt;
    uint256 public completedAt; // 0 until all 40 steps done

    bool public initialized;

    // ── Events ────────────────────────────────────────────────────────────
    event Initialized(
        address indexed assetToken,
        address indexed stablecoinToken,
        address indexed runner
    );

    /// @param player  The runner's address.
    /// @param stepId  0-indexed step number (0–39).
    /// @param txRef   Transaction hash of the proving on-chain operation, or bytes32(0).
    /// @param memo    Optional free-form tag (e.g. keccak of the revert reason for pause proofs).
    event StepCompleted(
        address indexed player,
        uint8 indexed stepId,
        bytes32 txRef,
        bytes32 memo
    );

    event RunCompleted(address indexed player, uint256 timestamp);

    // ── Errors ────────────────────────────────────────────────────────────
    error Unauthorized();
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidStep(uint8 stepId);
    error StepAlreadyDone(uint8 stepId);

    // ── Modifier ──────────────────────────────────────────────────────────
    modifier onlyDeployer() {
        if (msg.sender != deployer) revert Unauthorized();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────
    constructor() {
        deployer = msg.sender;
        startedAt = block.timestamp;
    }

    // ── Initialization ────────────────────────────────────────────────────
    /// @notice Deploy both B20 tokens via the B20Factory precompile. Callable once.
    /// @param saltAsset     bytes32 salt for the Asset token deterministic address.
    /// @param saltStable    bytes32 salt for the Stablecoin token deterministic address.
    /// @param currencyCode  Immutable ISO-style code (A–Z only, e.g. "USD").
    function initTokens(
        bytes32 saltAsset,
        bytes32 saltStable,
        string calldata currencyCode
    ) external onlyDeployer {
        if (initialized) revert AlreadyInitialized();

        IB20Factory factory = IB20Factory(B20_FACTORY);

        // Asset: abi.encode(struct) produces the dynamic-tuple encoding the factory expects.
        bytes memory assetParams = abi.encode(IB20Factory.B20AssetCreateParams({
            version:      1,
            name:         "Speedrun Asset",
            symbol:       "SRA",
            initialAdmin: deployer,
            decimals:     12
        }));
        assetToken = factory.createB20(
            IB20Factory.B20Variant.ASSET,
            saltAsset,
            assetParams,
            new bytes[](0)
        );

        // Stablecoin: same pattern.
        bytes memory stableParams = abi.encode(IB20Factory.B20StablecoinCreateParams({
            version:      1,
            name:         "Speedrun Stable",
            symbol:       "SRS",
            initialAdmin: deployer,
            currency:     currencyCode
        }));
        stablecoinToken = factory.createB20(
            IB20Factory.B20Variant.STABLECOIN,
            saltStable,
            stableParams,
            new bytes[](0)
        );

        initialized = true;
        emit Initialized(assetToken, stablecoinToken, deployer);
    }

    // ── Progress ──────────────────────────────────────────────────────────
    /// @notice Record a completed step.
    /// @param stepId  0-indexed step number (0–39).
    /// @param txRef   Hash of the proving transaction (pass bytes32(0) if not applicable).
    /// @param memo    Optional tag — for pause-proof steps, use keccak256(revertReason).
    function markStep(uint8 stepId, bytes32 txRef, bytes32 memo) external onlyDeployer {
        if (!initialized) revert NotInitialized();
        if (stepId >= TOTAL_STEPS) revert InvalidStep(stepId);

        uint64 bit = uint64(1) << stepId;
        if (progress & bit != 0) revert StepAlreadyDone(stepId);

        progress |= bit;
        emit StepCompleted(msg.sender, stepId, txRef, memo);

        // (2^40 − 1): all 40 bits set → run complete
        if (progress == (uint64(1) << TOTAL_STEPS) - 1) {
            completedAt = block.timestamp;
            emit RunCompleted(msg.sender, block.timestamp);
        }
    }

    // ── Views ─────────────────────────────────────────────────────────────
    /// @notice Number of completed steps (popcount of progress bitmap).
    function stepsCompleted() external view returns (uint8 count) {
        uint64 p = progress;
        while (p != 0) {
            count += uint8(p & 1);
            p >>= 1;
        }
    }

    /// @notice Whether step `stepId` has been marked done.
    function isStepDone(uint8 stepId) external view returns (bool) {
        if (stepId >= TOTAL_STEPS) return false;
        return progress & (uint64(1) << stepId) != 0;
    }

    /// @notice Address predicted for the Asset token before initTokens is called.
    function predictedAssetToken(bytes32 salt) external view returns (address) {
        return IB20Factory(B20_FACTORY).getB20Address(
            IB20Factory.B20Variant.ASSET,
            address(this),
            salt
        );
    }

    /// @notice Address predicted for the Stablecoin token before initTokens is called.
    function predictedStablecoinToken(bytes32 salt) external view returns (address) {
        return IB20Factory(B20_FACTORY).getB20Address(
            IB20Factory.B20Variant.STABLECOIN,
            address(this),
            salt
        );
    }
}
