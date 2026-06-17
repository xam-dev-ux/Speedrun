// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {Speedrun} from "../src/Speedrun.sol";

/// @notice Deploys the Speedrun scorekeeper contract.
///
///         The private key is read from the PRIVATE_KEY environment variable via
///         vm.envUint() — never pass it as a CLI flag (visible in `ps aux`).
///
///         Recommended flow:
///           export $(grep -v '^#' .env | xargs)   # source .env without printing it
///           make deploy-sepolia                    # reads PRIVATE_KEY from env
///
///         After deployment, call initTokens() via cast:
///           cast send <SPEEDRUN_ADDR> \
///             "initTokens(bytes32,bytes32,string)" \
///             <SALT_ASSET> <SALT_STABLE> "USD" \
///             --rpc-url $RPC_URL \
///             --account <keystore-name>            # use `cast wallet import` keystore
///           # or if using raw key (less safe):
///           # PRIVATE_KEY=0x... cast send ... (env var, not --private-key flag)
contract DeploySpeedrun is Script {
    function run() external returns (Speedrun speedrun) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address runner = vm.addr(pk);

        console.log("Deploying Speedrun as:", runner);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(pk);
        speedrun = new Speedrun();
        vm.stopBroadcast();

        console.log("");
        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("Speedrun contract:", address(speedrun));
        console.log("Runner (deployer):", runner);
        console.log("Started at block: ", block.number);
        console.log("");
        console.log("Next step - call initTokens() to deploy both B20 tokens:");
        console.log("  cast send %s \\", address(speedrun));
        console.log("    \"initTokens(bytes32,bytes32,string)\" \\");
        console.log("    0x6173736574000000000000000000000000000000000000000000000000000000 \\");
        console.log("    0x737461626c650000000000000000000000000000000000000000000000000000 \\");
        console.log("    \"USD\" \\");
        console.log("    --rpc-url $RPC_URL --account <keystore-name>");
        console.log("  # (create keystore once with: cast wallet import speedrun --interactive)");

        // Write address to broadcast output for Makefile to pick up
        vm.writeFile(
            string.concat(vm.projectRoot(), "/broadcast/speedrun-address.txt"),
            vm.toString(address(speedrun))
        );
    }
}
