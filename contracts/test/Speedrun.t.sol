// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test, console} from "forge-std/Test.sol";
import {Speedrun} from "../src/Speedrun.sol";

contract SpeedrunTest is Test {
    Speedrun internal speedrun;
    address internal runner;
    address internal alice;

    bytes32 internal constant SALT_A = bytes32("salt_asset");
    bytes32 internal constant SALT_S = bytes32("salt_stable");

    // ── Setup ──────────────────────────────────────────────────────────────
    function setUp() public {
        runner = makeAddr("runner");
        alice  = makeAddr("alice");

        vm.deal(runner, 1 ether);

        vm.prank(runner);
        speedrun = new Speedrun();
    }

    // ── Constructor ────────────────────────────────────────────────────────
    function test_constructor_setsDeployer() public view {
        assertEq(speedrun.deployer(), runner);
    }

    function test_constructor_notInitialized() public view {
        assertFalse(speedrun.initialized());
        assertEq(speedrun.progress(), 0);
        assertEq(speedrun.completedAt(), 0);
        assertGt(speedrun.startedAt(), 0);
    }

    // ── initTokens ─────────────────────────────────────────────────────────
    function test_initTokens_success() public {
        _init();

        assertTrue(speedrun.initialized());
        assertTrue(speedrun.assetToken() != address(0));
        assertTrue(speedrun.stablecoinToken() != address(0));
        assertTrue(speedrun.assetToken() != speedrun.stablecoinToken());
    }

    function test_initTokens_emitsEvent() public {
        address expectedAsset  = speedrun.predictedAssetToken(SALT_A);
        address expectedStable = speedrun.predictedStablecoinToken(SALT_S);
        vm.prank(runner);
        vm.expectEmit(true, true, true, true);
        emit Speedrun.Initialized(expectedAsset, expectedStable, runner);
        speedrun.initTokens(SALT_A, SALT_S, "USD");
    }

    function test_initTokens_onlyDeployer() public {
        vm.prank(alice);
        vm.expectRevert(Speedrun.Unauthorized.selector);
        speedrun.initTokens(SALT_A, SALT_S, "USD");
    }

    function test_initTokens_alreadyInitialized() public {
        _init();
        vm.prank(runner);
        vm.expectRevert(Speedrun.AlreadyInitialized.selector);
        speedrun.initTokens(bytes32("x"), bytes32("y"), "EUR");
    }

    // ── markStep ───────────────────────────────────────────────────────────
    function test_markStep_basic() public {
        _init();
        vm.prank(runner);
        vm.expectEmit(true, true, false, true);
        emit Speedrun.StepCompleted(runner, 0, bytes32("txhash"), bytes32(0));
        speedrun.markStep(0, bytes32("txhash"), bytes32(0));

        assertTrue(speedrun.isStepDone(0));
        assertEq(speedrun.stepsCompleted(), 1);
        assertEq(speedrun.progress(), 1);
    }

    function test_markStep_onlyDeployer() public {
        _init();
        vm.prank(alice);
        vm.expectRevert(Speedrun.Unauthorized.selector);
        speedrun.markStep(0, bytes32(0), bytes32(0));
    }

    function test_markStep_notInitialized() public {
        vm.prank(runner);
        vm.expectRevert(Speedrun.NotInitialized.selector);
        speedrun.markStep(0, bytes32(0), bytes32(0));
    }

    function test_markStep_invalidStep_boundary() public {
        _init();
        vm.prank(runner);
        vm.expectRevert(abi.encodeWithSelector(Speedrun.InvalidStep.selector, 40));
        speedrun.markStep(40, bytes32(0), bytes32(0));
    }

    function test_markStep_alreadyDone() public {
        _init();
        vm.startPrank(runner);
        speedrun.markStep(5, bytes32(0), bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(Speedrun.StepAlreadyDone.selector, 5));
        speedrun.markStep(5, bytes32(0), bytes32(0));
        vm.stopPrank();
    }

    function test_markStep_lastStep_triggersCompletion() public {
        _init();
        vm.startPrank(runner);
        for (uint8 i = 0; i < 39; i++) {
            speedrun.markStep(i, bytes32(0), bytes32(0));
        }
        assertEq(speedrun.completedAt(), 0);

        vm.expectEmit(true, false, false, false);
        emit Speedrun.RunCompleted(runner, block.timestamp);
        speedrun.markStep(39, bytes32(0), bytes32(0));
        vm.stopPrank();

        assertGt(speedrun.completedAt(), 0);
    }

    // ── Full run ───────────────────────────────────────────────────────────
    function test_fullRun_40Steps() public {
        _init();
        vm.startPrank(runner);
        for (uint8 i = 0; i < 40; i++) {
            speedrun.markStep(i, bytes32(uint256(i + 1)), bytes32(0));
        }
        vm.stopPrank();

        assertEq(speedrun.stepsCompleted(), 40);
        assertGt(speedrun.completedAt(), 0);
        // All 40 bits set = 2^40 - 1
        assertEq(speedrun.progress(), (uint64(1) << 40) - 1);
    }

    // ── stepsCompleted (popcount) ──────────────────────────────────────────
    function test_stepsCompleted_threeSteps() public {
        _init();
        vm.startPrank(runner);
        speedrun.markStep(0,  bytes32(0), bytes32(0));
        speedrun.markStep(7,  bytes32(0), bytes32(0));
        speedrun.markStep(39, bytes32(0), bytes32(0));
        vm.stopPrank();
        assertEq(speedrun.stepsCompleted(), 3);
    }

    // ── isStepDone out-of-bounds ───────────────────────────────────────────
    function test_isStepDone_outOfBounds_returnsFalse() public view {
        assertFalse(speedrun.isStepDone(40));
        assertFalse(speedrun.isStepDone(255));
    }

    // ── Fuzz ───────────────────────────────────────────────────────────────
    function testFuzz_markStep_anyValidStep(uint8 stepId) public {
        vm.assume(stepId < 40);
        _init();
        vm.prank(runner);
        speedrun.markStep(stepId, bytes32(0), bytes32(0));
        assertTrue(speedrun.isStepDone(stepId));
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    function _init() internal {
        vm.prank(runner);
        speedrun.initTokens(SALT_A, SALT_S, "USD");
    }
}
