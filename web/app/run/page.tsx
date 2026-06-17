'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useDeployContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { encodeAbiParameters } from 'viem';
import { ActivationBanner } from '@/components/ActivationBanner';
import { LevelGrid } from '@/components/LevelGrid';
import { useActivationStatus, useSpeedrunContractAddress, useSpeedrunProgress } from '@/lib/hooks';
import { SPEEDRUN_ABI, SPEEDRUN_BYTECODE } from '@/lib/abis/Speedrun';
import { STEPS } from '@/lib/steps';
import Link from 'next/link';

export default function RunPage() {
  const { isConnected, address } = useAccount();
  const activation = useActivationStatus();
  const [contractAddr, setContractAddr] = useSpeedrunContractAddress();
  const [manualAddr, setManualAddr] = useState('');

  const { deployContract, isPending: isDeploying } = useDeployContract();
  const [deployHash, setDeployHash] = useState<`0x${string}` | undefined>();
  const { isSuccess: deployConfirmed, data: deployReceipt } = useWaitForTransactionReceipt({
    hash: deployHash,
  });

  const progress = useSpeedrunProgress(contractAddr ?? undefined);
  const { writeContractAsync } = useWriteContract();

  // Handle deploy
  async function handleDeploy() {
    if (!SPEEDRUN_BYTECODE || SPEEDRUN_BYTECODE === '0x') {
      alert('Run `make sync-abi` first to populate the Speedrun bytecode.');
      return;
    }
    const hash = await deployContract({
      abi: SPEEDRUN_ABI,
      bytecode: SPEEDRUN_BYTECODE,
      args: [],
    });
    setDeployHash(hash);
  }

  // Grab deployed address from receipt
  if (deployConfirmed && deployReceipt?.contractAddress && !contractAddr) {
    setContractAddr(deployReceipt.contractAddress);
  }

  // markStep
  async function handleMarkStep(stepId: number, txRef: `0x${string}`, memo: `0x${string}`) {
    if (!contractAddr) return;
    await writeContractAsync({
      address: contractAddr,
      abi: SPEEDRUN_ABI,
      functionName: 'markStep',
      args: [stepId, txRef, memo],
    });
  }

  if (!isConnected) {
    return (
      <main className="max-w-lg mx-auto px-4 py-24 text-center">
        <h1 className="text-3xl font-bold mb-6">Connect your wallet</h1>
        <ConnectButton />
        <p className="text-gray-500 mt-4 text-sm">
          Only the wallet that deployed the Speedrun contract can mark steps.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      {/* Nav */}
      <div className="flex items-center justify-between mb-8">
        <Link href="/" className="text-gray-500 hover:text-white text-sm transition-colors">
          ← Home
        </Link>
        <ConnectButton />
      </div>

      <h1 className="text-4xl font-bold mb-2">
        <span className="text-blue-400">B20</span> Speedrun
      </h1>
      <p className="text-gray-500 mb-8">
        Runner: <span className="font-mono text-gray-300">{address}</span>
      </p>

      {/* Activation warning */}
      {activation === 'pending' && (
        <div className="mb-8">
          <ActivationBanner />
        </div>
      )}

      {/* Step 0: Deploy Speedrun contract */}
      {!contractAddr ? (
        <section className="border border-gray-800 rounded-xl p-8 mb-8">
          <h2 className="text-xl font-bold mb-2">Deploy your Speedrun contract</h2>
          <p className="text-gray-400 text-sm mb-6">
            Each runner deploys their own Speedrun.sol. Deploy via the Foundry CLI (key stays
            in env, never as a CLI arg) — or deploy directly from your browser wallet below.
          </p>

          {/* CLI option */}
          <div className="bg-gray-900 rounded-lg p-4 font-mono text-xs text-green-400 mb-6 overflow-x-auto">
            <div className="text-gray-500 mb-1"># Option A — Foundry CLI (recommended)</div>
            <div className="text-gray-500 mb-1"># PRIVATE_KEY is read from env, never passed as --private-key flag</div>
            export $(grep -v {`'^#'`} .env | xargs)<br />
            make deploy-sepolia
          </div>

          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 border-t border-gray-800" />
            <span className="text-gray-600 text-sm">or</span>
            <div className="flex-1 border-t border-gray-800" />
          </div>

          {/* Browser deploy */}
          <button
            onClick={handleDeploy}
            disabled={isDeploying || activation !== 'active'}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2 px-6 rounded-lg transition-colors"
          >
            {isDeploying ? 'Deploying…' : 'Deploy via Wallet (Option B)'}
          </button>
          {activation !== 'active' && (
            <p className="text-yellow-500 text-xs mt-2">
              Waiting for Beryl activation before deploying.
            </p>
          )}

          {/* Manual import */}
          <div className="mt-8 pt-6 border-t border-gray-800">
            <p className="text-gray-500 text-sm mb-3">
              Already deployed? Import your contract address:
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="0x..."
                value={manualAddr}
                onChange={(e) => setManualAddr(e.target.value)}
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 font-mono text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => {
                  if (manualAddr.startsWith('0x')) {
                    setContractAddr(manualAddr as `0x${string}`);
                  }
                }}
                className="bg-gray-800 hover:bg-gray-700 text-white px-5 py-2 rounded-lg text-sm transition-colors"
              >
                Import
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* Progress header */}
          <section className="border border-gray-800 rounded-xl p-6 mb-8">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="text-xs text-gray-500 font-mono mb-1">Speedrun contract</div>
                <a
                  href={`https://basescan.org/address/${contractAddr}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-blue-400 hover:underline text-sm"
                >
                  {contractAddr}
                </a>
              </div>
              <div className="text-right">
                <div className="text-4xl font-bold text-white">
                  {progress.stepsCompleted}
                  <span className="text-gray-600 text-2xl">/40</span>
                </div>
                <div className="text-xs text-gray-500">steps done</div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-4 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${(progress.stepsCompleted / 40) * 100}%` }}
              />
            </div>

            {/* Token addresses */}
            {progress.initialized && (
              <div className="mt-4 grid sm:grid-cols-2 gap-3 text-xs font-mono">
                <div className="bg-gray-900 rounded-lg p-3">
                  <div className="text-gray-500 mb-1">Asset token (SRA, decimals=12)</div>
                  <a
                    href={`https://basescan.org/address/${progress.assetToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:underline break-all"
                  >
                    {progress.assetToken ?? '–'}
                  </a>
                </div>
                <div className="bg-gray-900 rounded-lg p-3">
                  <div className="text-gray-500 mb-1">Stablecoin token (SRS)</div>
                  <a
                    href={`https://basescan.org/address/${progress.stablecoinToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:underline break-all"
                  >
                    {progress.stablecoinToken ?? '–'}
                  </a>
                </div>
              </div>
            )}

            {progress.completedAt > 0n && (
              <div className="mt-4 bg-green-900/20 border border-green-500/30 rounded-lg p-4 text-center">
                <div className="text-green-400 font-bold text-lg">🏁 Run Complete!</div>
                <div className="text-gray-400 text-sm mt-1">
                  Completed at {new Date(Number(progress.completedAt) * 1000).toUTCString()}
                </div>
                <Link
                  href={`/profile/${address}`}
                  className="text-green-400 hover:underline text-sm"
                >
                  View your certificate →
                </Link>
              </div>
            )}

            <button
              onClick={() => {
                if (confirm('Clear the stored contract address? You can re-import it.')) {
                  setContractAddr(null);
                }
              }}
              className="mt-4 text-gray-600 hover:text-red-400 text-xs transition-colors"
            >
              Change contract
            </button>
          </section>

          {/* All 5 levels */}
          <LevelGrid
            progress={progress.progress}
            contractAddress={contractAddr}
            assetToken={progress.assetToken}
            stablecoinToken={progress.stablecoinToken}
            initialized={progress.initialized}
            onMarkStep={handleMarkStep}
          />
        </>
      )}
    </main>
  );
}
