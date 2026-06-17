// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {Speedrun} from "../src/Speedrun.sol";

/// @notice Deploys the Speedrun scorekeeper contract.
///
///         Uses an encrypted local keystore — the private key is NEVER passed
///         as a CLI arg, env var, or stored in plaintext anywhere.
///
///         One-time setup (run once, key stored AES-256 encrypted):
///           cast wallet import speedrun --interactive
///             → paste private key (hidden input, like a password)
///             → set a keystore password
///             → stored at ~/.foundry/keystores/speedrun
///
///         Deploy:
///           make deploy-sepolia     ← prompts for keystore password only
///           make deploy-mainnet
///
///         After deployment, call initTokens():
///           cast send <SPEEDRUN_ADDR> \
///             "initTokens(bytes32,bytes32,string)" \
///             <SALT_ASSET> <SALT_STABLE> "USD" \
///             --rpc-url $RPC_URL \
///             --account speedrun
contract DeploySpeedrun is Script {
    function run() external returns (Speedrun speedrun) {
        // vm.startBroadcast() with no args uses the account provided via --account flag.
        // The private key never touches this script.
        vm.startBroadcast();
        speedrun = new Speedrun();
        vm.stopBroadcast();

        // speedrun.deployer() is set to msg.sender in the constructor,
        // which equals the broadcast account — no need to read the key here.
        address runner = speedrun.deployer();

        console.log("");
        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("Speedrun contract:", address(speedrun));
        console.log("Runner (deployer):", runner);
        console.log("Chain ID:         ", block.chainid);
        console.log("");
        console.log("Next: call initTokens() to deploy both B20 tokens.");
        console.log("Example (adjust salts and currency to taste):");
        console.log("");
        console.log("  cast send %s \\", address(speedrun));
        console.log("    \"initTokens(bytes32,bytes32,string)\" \\");
        console.log("    $(cast --from-utf8 asset | cast --to-bytes32) \\");
        console.log("    $(cast --from-utf8 stable | cast --to-bytes32) \\");
        console.log("    \"USD\" \\");
        console.log("    --rpc-url $RPC_URL \\");
        console.log("    --account speedrun");

        vm.writeFile(
            string.concat(vm.projectRoot(), "/broadcast/speedrun-address.txt"),
            vm.toString(address(speedrun))
        );
    }
}
