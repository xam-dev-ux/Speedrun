'use client';

import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useDeployContract, useChainId } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ActivationBanner } from '@/components/ActivationBanner';
import { LevelGrid } from '@/components/LevelGrid';
import { useActivationStatus, useSpeedrunContractAddress, useSpeedrunProgress } from '@/lib/hooks';
import { SPEEDRUN_ABI, SPEEDRUN_BYTECODE } from '@/lib/abis/Speedrun';
import { SpeedrunContext } from '@/lib/speedrunContext';
import { DATA_SUFFIX } from '@/lib/wagmi';
import Link from 'next/link';

function basescan(chainId: number, type: 'address' | 'tx', value: string) {
  const base = chainId === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org';
  return `${base}/${type}/${value}`;
}

export default function RunPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const activation = useActivationStatus();
  const [contractAddr, setContractAddr] = useSpeedrunContractAddress();
  const [manualAddr, setManualAddr] = useState('');

  // Deploy Speedrun contract from browser
  const { deployContractAsync, isPending: isDeploying } = useDeployContract();
  const [deployHash, setDeployHash] = useState<`0x${string}` | undefined>();
  const { isSuccess: deployConfirmed, data: deployReceipt } = useWaitForTransactionReceipt({ hash: deployHash });

  const progress = useSpeedrunProgress(contractAddr ?? undefined);
  const { writeContractAsync: _write, isPending: isTxPending } = useWriteContract();
  const writeContractAsync: typeof _write = (p) => _write({ ...p, dataSuffix: DATA_SUFFIX } as Parameters<typeof _write>[0]);

  // initTokens state
  const [initCurrency, setInitCurrency] = useState('USD');
  const [isInitializing, setIsInitializing] = useState(false);
  const [initTxHash, setInitTxHash] = useState<`0x${string}` | undefined>();
  const [initError, setInitError] = useState<string | undefined>();
  const { isSuccess: initConfirmed } = useWaitForTransactionReceipt({ hash: initTxHash });

  // Force-refetch all contract reads every 1.5 s while waiting for initialized to flip
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!initConfirmed || progress.initialized) return;
    const id = setInterval(() => { queryClient.invalidateQueries(); }, 1_500);
    return () => clearInterval(id);
  }, [initConfirmed, progress.initialized, queryClient]);

  // Speedrun shared state (used across steps via context)
  const [blocklistPolicyId, setBlocklistPolicyId] = useState<bigint>(0n);
  const [allowlistPolicyId, setAllowlistPolicyId] = useState<bigint>(0n);
  const [victimAddress, setVictimAddress] = useState<`0x${string}`>('0x000000000000000000000000000000000000dEaD');

  // Grab deployed address from receipt
  if (deployConfirmed && deployReceipt?.contractAddress && !contractAddr) {
    setContractAddr(deployReceipt.contractAddress);
  }

  async function handleDeploy() {
    if (!SPEEDRUN_BYTECODE || SPEEDRUN_BYTECODE === '0x') {
      alert('Run `make sync-abi` first to populate the Speedrun bytecode.');
      return;
    }
    const hash = await deployContractAsync({ abi: SPEEDRUN_ABI, bytecode: SPEEDRUN_BYTECODE, args: [] });
    setDeployHash(hash);
  }

  async function handleInitTokens() {
    if (!contractAddr) return;
    const code = initCurrency.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'USD';
    const saltAsset  = `0x${'6173736574'.padEnd(64, '0')}` as `0x${string}`;
    const saltStable = `0x${'737461626c65'.padEnd(64, '0')}` as `0x${string}`;
    setIsInitializing(true);
    setInitError(undefined);
    try {
      const hash = await writeContractAsync({
        address: contractAddr, abi: SPEEDRUN_ABI,
        functionName: 'initTokens', args: [saltAsset, saltStable, code],
      });
      setInitTxHash(hash);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setInitError(msg.includes('FeatureNotActivated')
        ? 'B20 tokens are not yet enabled on mainnet. Check https://status.base.org for updates.'
        : msg.slice(0, 120));
    } finally {
      setIsInitializing(false);
    }
  }

  if (!isConnected) {
    return (
      <main className="max-w-lg mx-auto px-4 py-24 text-center">
        <h1 className="text-3xl font-bold mb-6">Connect your wallet</h1>
        <ConnectButton />
        <p className="text-gray-500 mt-4 text-sm">Only the wallet that deployed the Speedrun contract can mark steps.</p>
      </main>
    );
  }

  return (
    <SpeedrunContext.Provider value={{
      contractAddress: contractAddr ?? '0x0000000000000000000000000000000000000000',
      assetToken: progress.assetToken,
      stablecoinToken: progress.stablecoinToken,
      deployer: address,
      blocklistPolicyId,
      allowlistPolicyId,
      victimAddress,
      setBlocklistPolicyId,
      setAllowlistPolicyId,
      setVictimAddress,
    }}>
      <main className="max-w-5xl mx-auto px-4 py-10">
        {/* Nav */}
        <div className="flex items-center justify-between mb-8">
          <Link href="/" className="text-gray-500 hover:text-white text-sm transition-colors">← Home</Link>
          <ConnectButton />
        </div>

        <h1 className="text-4xl font-bold mb-2">
          <span className="text-blue-400">B20</span> Speedrun
        </h1>
        <p className="text-gray-500 mb-8">
          Runner: <span className="font-mono text-gray-300">{address}</span>
        </p>

        {activation === 'pending' && (
          <div className="mb-8"><ActivationBanner /></div>
        )}

        {/* Step 0: Deploy Speedrun contract */}
        {!contractAddr ? (
          <section className="border border-gray-800 rounded-xl p-8 mb-8">
            <h2 className="text-xl font-bold mb-2">Deploy your Speedrun contract</h2>
            <p className="text-gray-400 text-sm mb-6">Each runner deploys their own Speedrun.sol to track progress onchain.</p>

            <div className="bg-gray-900 rounded-lg p-4 font-mono text-xs text-green-400 mb-6 overflow-x-auto">
              <div className="text-gray-500 mb-1"># Option A — Foundry CLI (recommended)</div>
              <div>cast wallet import speedrun --interactive</div>
              <div className="text-gray-500 mt-2 mb-1"># Deploy:</div>
              <div>make deploy-sepolia</div>
            </div>

            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1 border-t border-gray-800" />
              <span className="text-gray-600 text-sm">or</span>
              <div className="flex-1 border-t border-gray-800" />
            </div>

            <button onClick={handleDeploy} disabled={isDeploying}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2 px-6 rounded-lg transition-colors">
              {isDeploying ? 'Deploying…' : 'Deploy via Wallet'}
            </button>

            <div className="mt-8 pt-6 border-t border-gray-800">
              <p className="text-gray-500 text-sm mb-3">Already deployed? Import your contract address:</p>
              <div className="flex gap-3">
                <input type="text" placeholder="0x..." value={manualAddr}
                  onChange={(e) => setManualAddr(e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 font-mono text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500" />
                <button onClick={() => { if (manualAddr.startsWith('0x')) setContractAddr(manualAddr as `0x${string}`); }}
                  className="bg-gray-800 hover:bg-gray-700 text-white px-5 py-2 rounded-lg text-sm transition-colors">
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
                  <a href={basescan(chainId, 'address', contractAddr!)} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-blue-400 hover:underline text-sm">{contractAddr}</a>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-bold text-white">
                    {progress.stepsCompleted}<span className="text-gray-600 text-2xl">/40</span>
                  </div>
                  <div className="text-xs text-gray-500">steps done</div>
                </div>
              </div>

              <div className="mt-4 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${(progress.stepsCompleted / 40) * 100}%` }} />
              </div>

              {/* Token addresses */}
              {progress.initialized && (
                <div className="mt-4 grid sm:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="bg-gray-900 rounded-lg p-3">
                    <div className="text-gray-500 mb-1">Asset token (SRA, decimals=12)</div>
                    <a href={basescan(chainId, 'address', progress.assetToken!)} target="_blank" rel="noopener noreferrer"
                      className="text-violet-400 hover:underline break-all">{progress.assetToken ?? '–'}</a>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-3">
                    <div className="text-gray-500 mb-1">Stablecoin token (SRS, USD)</div>
                    <a href={basescan(chainId, 'address', progress.stablecoinToken!)} target="_blank" rel="noopener noreferrer"
                      className="text-cyan-400 hover:underline break-all">{progress.stablecoinToken ?? '–'}</a>
                  </div>
                </div>
              )}

              {/* Policy IDs (shown once created) */}
              {(blocklistPolicyId > 0n || allowlistPolicyId > 0n) && (
                <div className="mt-3 grid sm:grid-cols-2 gap-3 text-xs font-mono">
                  {blocklistPolicyId > 0n && (
                    <div className="bg-gray-900 rounded-lg px-3 py-2">
                      <span className="text-gray-500">Blocklist policy: </span>
                      <span className="text-orange-400">{blocklistPolicyId.toString()}</span>
                    </div>
                  )}
                  {allowlistPolicyId > 0n && (
                    <div className="bg-gray-900 rounded-lg px-3 py-2">
                      <span className="text-gray-500">Allowlist policy: </span>
                      <span className="text-cyan-400">{allowlistPolicyId.toString()}</span>
                    </div>
                  )}
                </div>
              )}

              {/* initTokens */}
              {!progress.initialized && activation === 'active' && (
                <div className="mt-6 border border-yellow-500/30 bg-yellow-900/10 rounded-xl p-5">
                  <h3 className="font-bold text-yellow-400 mb-1">Step 0 — Deploy B20 tokens</h3>

                  {initConfirmed ? (
                    <p className="text-gray-400 text-sm">
                      Tokens deployed — waiting for chain data…
                      <span className="ml-2 animate-pulse">⏳</span>
                    </p>
                  ) : (
                    <>
                      <p className="text-gray-400 text-sm mb-4">
                        Call <span className="font-mono text-yellow-300">initTokens()</span> to deploy your Asset and Stablecoin.
                      </p>
                      <div className="flex gap-3 items-center">
                        <input type="text" maxLength={5} placeholder="USD" value={initCurrency}
                          onChange={(e) => setInitCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                          className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-gray-600 focus:outline-none focus:border-yellow-500 uppercase" />
                        <button onClick={handleInitTokens} disabled={isInitializing || isTxPending}
                          className="bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold py-2 px-6 rounded-lg transition-colors">
                          {isInitializing || isTxPending ? 'Sending…' : 'Deploy tokens →'}
                        </button>
                      </div>
                    </>
                  )}

                  {initTxHash && (
                    <p className="text-xs text-gray-500 mt-2 font-mono">
                      tx: <a href={basescan(chainId, 'tx', initTxHash!)} target="_blank" rel="noopener noreferrer"
                        className="text-blue-400 hover:underline">{initTxHash}</a>
                    </p>
                  )}
                  {initError && (
                    <p className="text-xs text-red-400 mt-2">{initError}</p>
                  )}
                </div>
              )}

              {progress.completedAt > 0n && (
                <div className="mt-4 bg-green-900/20 border border-green-500/30 rounded-lg p-4 text-center">
                  <div className="text-green-400 font-bold text-lg">Run Complete!</div>
                  <div className="text-gray-400 text-sm mt-1">
                    Completed at {new Date(Number(progress.completedAt) * 1000).toUTCString()}
                  </div>
                  <Link href={`/profile/${address}`} className="text-green-400 hover:underline text-sm">
                    View your certificate →
                  </Link>
                </div>
              )}

              <button onClick={() => { if (confirm('Clear the stored contract address?')) setContractAddr(null); }}
                className="mt-4 text-gray-600 hover:text-red-400 text-xs transition-colors">
                Change contract
              </button>
            </section>

            {/* Level grid */}
            {progress.initialized && (
              <LevelGrid progress={progress.progress} assetToken={progress.assetToken} />
            )}
          </>
        )}
      </main>
    </SpeedrunContext.Provider>
  );
}
