'use client';

import { useState } from 'react';
import { useAccount, usePublicClient, useWriteContract, useSignTypedData, useChainId } from 'wagmi';
import { encodeFunctionData, hexToSignature, keccak256, toBytes } from 'viem';
import type { Step } from '@/lib/steps';
import { B20_TOKEN_ABI, B20_ROLES, POLICY_SLOT, PAUSE_FEATURE, TOKEN_AMOUNT } from '@/lib/abis/B20Token';
import { POLICY_REGISTRY_ABI, PolicyType, POLICY_REGISTRY } from '@/lib/abis/PolicyRegistry';
import { SPEEDRUN_ABI } from '@/lib/abis/Speedrun';
import { useSpeedrun } from '@/lib/speedrunContext';
import { DATA_SUFFIX } from '@/lib/wagmi';

// Burn address used as "victim" throughout the speedrun
const VICTIM = '0x000000000000000000000000000000000000dEaD' as const;
// Memo for withMemo steps
const SPEEDRUN_MEMO = keccak256(toBytes('speedrun')) as `0x${string}`;
// Policy event topic
const POLICY_CREATED_TOPIC = keccak256(toBytes('PolicyCreated(uint64,address,uint8)')) as `0x${string}`;
// Zero bytes32
const ZERO32 = ('0x' + '0'.repeat(64)) as `0x${string}`;

interface StepCardProps {
  step: Step;
  isDone: boolean;
  isAvailable: boolean;
}

type Phase = 'idle' | 'action' | 'waiting' | 'marking' | 'done' | 'error';

export function StepCard({ step, isDone, isAvailable }: StepCardProps) {
  const { address: deployer } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync: _write } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const chainId = useChainId();

  // wagmi spreads all params into viem's writeContract, which natively supports dataSuffix
  const writeContractAsync: typeof _write = (params) =>
    _write({ ...params, dataSuffix: DATA_SUFFIX } as Parameters<typeof _write>[0]);

  const {
    contractAddress, assetToken, stablecoinToken,
    blocklistPolicyId, allowlistPolicyId,
    setBlocklistPolicyId, setAllowlistPolicyId,
  } = useSpeedrun();

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [actionHash, setActionHash] = useState<`0x${string}` | null>(null);
  const [markHash, setMarkHash] = useState<`0x${string}` | null>(null);

  const isLocked = !isAvailable && !isDone;

  async function execute() {
    if (!assetToken || !stablecoinToken || !deployer || !publicClient) return;
    setPhase('action');
    setError(null);
    setActionHash(null);
    setMarkHash(null);

    try {
      let actionTx: `0x${string}` | undefined;

      // ── Steps 0 & 1: tokens already deployed, just markStep ──────────────
      if (step.id === 0 || step.id === 1) {
        setPhase('marking');
        const mHash = await writeContractAsync({
          address: contractAddress,
          abi: SPEEDRUN_ABI,
          functionName: 'markStep',
          args: [step.id, ZERO32, ZERO32],
        });
        setMarkHash(mHash);
        setPhase('done');
        return;
      }

      // ── Level 1: grantRole calls ──────────────────────────────────────────
      const ROLES = [
        B20_ROLES.MINT_ROLE, B20_ROLES.BURN_ROLE, B20_ROLES.BURN_BLOCKED_ROLE,
        B20_ROLES.PAUSE_ROLE, B20_ROLES.UNPAUSE_ROLE, B20_ROLES.METADATA_ROLE,
        B20_ROLES.OPERATOR_ROLE,
      ] as const;

      if (step.id >= 2 && step.id <= 8) {
        actionTx = await writeContractAsync({
          address: assetToken,
          abi: B20_TOKEN_ABI,
          functionName: 'grantRole',
          args: [ROLES[step.id - 2], deployer],
        });

      // ── Level 2: Policies ─────────────────────────────────────────────────
      } else if (step.id === 9) {
        actionTx = await writeContractAsync({
          address: POLICY_REGISTRY, abi: POLICY_REGISTRY_ABI,
          functionName: 'createPolicy', args: [deployer, PolicyType.BLOCKLIST],
        });
        setPhase('waiting');
        const r = await publicClient.waitForTransactionReceipt({ hash: actionTx! });
        const log = r.logs.find(l => l.address.toLowerCase() === POLICY_REGISTRY.toLowerCase() && l.topics[0] === POLICY_CREATED_TOPIC);
        if (log?.topics[1]) setBlocklistPolicyId(BigInt(log.topics[1]));

      } else if (step.id === 10) {
        actionTx = await writeContractAsync({
          address: POLICY_REGISTRY, abi: POLICY_REGISTRY_ABI,
          functionName: 'createPolicy', args: [deployer, PolicyType.ALLOWLIST],
        });
        setPhase('waiting');
        const r = await publicClient.waitForTransactionReceipt({ hash: actionTx! });
        const log = r.logs.find(l => l.address.toLowerCase() === POLICY_REGISTRY.toLowerCase() && l.topics[0] === POLICY_CREATED_TOPIC);
        if (log?.topics[1]) setAllowlistPolicyId(BigInt(log.topics[1]));

      } else if (step.id === 11) {
        actionTx = await writeContractAsync({
          address: POLICY_REGISTRY, abi: POLICY_REGISTRY_ABI,
          functionName: 'updateBlocklist',
          args: [blocklistPolicyId, true, [VICTIM]],
        });

      } else if (step.id === 12) {
        actionTx = await writeContractAsync({
          address: POLICY_REGISTRY, abi: POLICY_REGISTRY_ABI,
          functionName: 'updateAllowlist',
          args: [allowlistPolicyId, true, [deployer]],
        });

      } else if (step.id === 13) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'updatePolicy',
          args: [POLICY_SLOT.TRANSFER_SENDER, blocklistPolicyId],
        });

      } else if (step.id === 14) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'updatePolicy',
          args: [POLICY_SLOT.TRANSFER_RECEIVER, allowlistPolicyId],
        });

      } else if (step.id === 15) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'updatePolicy',
          args: [POLICY_SLOT.TRANSFER_EXECUTOR, allowlistPolicyId],
        });

      } else if (step.id === 16) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'updatePolicy',
          args: [POLICY_SLOT.MINT_RECEIVER, allowlistPolicyId],
        });

      } else if (step.id === 17) {
        // Two-step admin transfer on the blocklist policy
        actionTx = await writeContractAsync({
          address: POLICY_REGISTRY, abi: POLICY_REGISTRY_ABI,
          functionName: 'stageUpdateAdmin', args: [blocklistPolicyId, deployer],
        });
        setPhase('waiting');
        await publicClient.waitForTransactionReceipt({ hash: actionTx! });
        actionTx = await writeContractAsync({
          address: POLICY_REGISTRY, abi: POLICY_REGISTRY_ABI,
          functionName: 'finalizeUpdateAdmin', args: [blocklistPolicyId],
        });

      // ── Level 3: Token movement ───────────────────────────────────────────
      } else if (step.id === 18) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'mint', args: [deployer, TOKEN_AMOUNT],
        });

      } else if (step.id === 19) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'mintWithMemo', args: [deployer, TOKEN_AMOUNT / 10n, SPEEDRUN_MEMO],
        });

      } else if (step.id === 20) {
        // Transfer a small amount to self (deployer is in allowlist)
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'transfer', args: [deployer, TOKEN_AMOUNT / 100n],
        });

      } else if (step.id === 21) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'transferWithMemo', args: [deployer, TOKEN_AMOUNT / 100n, SPEEDRUN_MEMO],
        });

      } else if (step.id === 22) {
        // approve self then transferFrom self→self
        const approveTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'approve', args: [deployer, TOKEN_AMOUNT],
        });
        setPhase('waiting');
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'transferFrom', args: [deployer, deployer, TOKEN_AMOUNT / 100n],
        });

      } else if (step.id === 23) {
        // transferFromWithMemo — uses existing allowance from step 22
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'transferFromWithMemo', args: [deployer, deployer, TOKEN_AMOUNT / 100n, SPEEDRUN_MEMO],
        });

      } else if (step.id === 24) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'burn', args: [TOKEN_AMOUNT / 100n],
        });

      } else if (step.id === 25) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'burnWithMemo', args: [TOKEN_AMOUNT / 100n, SPEEDRUN_MEMO],
        });

      } else if (step.id === 26) {
        // Mint to victim first (only works if MINT_RECEIVER_POLICY not bound, or victim in allowlist)
        const mintVictimTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'mint', args: [VICTIM, TOKEN_AMOUNT / 10n],
        });
        setPhase('waiting');
        await publicClient.waitForTransactionReceipt({ hash: mintVictimTx });
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'burnBlocked', args: [VICTIM, TOKEN_AMOUNT / 10n],
        });

      } else if (step.id === 27) {
        // Set supply cap to current totalSupply + large buffer
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'updateSupplyCap', args: [TOKEN_AMOUNT * 1_000_000n],
        });

      } else if (step.id === 28) {
        // EIP-2612 permit: signTypedData then submit permit tx
        const tokenName = await publicClient.readContract({ address: assetToken, abi: B20_TOKEN_ABI, functionName: 'name' });
        const nonce = await publicClient.readContract({ address: assetToken, abi: B20_TOKEN_ABI, functionName: 'nonces', args: [deployer] });
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

        const sig = await signTypedDataAsync({
          domain: { name: tokenName, version: '1', chainId: BigInt(chainId), verifyingContract: assetToken },
          types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
          primaryType: 'Permit',
          message: { owner: deployer, spender: deployer, value: TOKEN_AMOUNT / 10n, nonce, deadline },
        });

        const { v, r, s } = hexToSignature(sig);
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'permit',
          args: [deployer, deployer, TOKEN_AMOUNT / 10n, deadline, Number(v ?? 27n), r as `0x${string}`, s as `0x${string}`],
        });

      // ── Level 4: Asset specials ───────────────────────────────────────────
      } else if (step.id === 29) {
        // updateMultiplier: set to 1.5× WAD (1.5e18)
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'updateMultiplier', args: [1_500_000_000_000_000_000n],
        });

      } else if (step.id === 30) {
        // announce with a batchMint as internalCall
        const batchMintCall = encodeFunctionData({
          abi: B20_TOKEN_ABI,
          functionName: 'batchMint',
          args: [[deployer], [TOKEN_AMOUNT / 10n]],
        });
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'announce',
          args: [[batchMintCall], 1n, 'B20 Speedrun — 40-step demonstration', 'ipfs://speedrun'],
        });

      } else if (step.id === 31) {
        // set extra metadata then delete it (two txs)
        const setTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'updateExtraMetadata', args: ['twitter', '@b20speedrunner'],
        });
        setPhase('waiting');
        await publicClient.waitForTransactionReceipt({ hash: setTx });
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'updateExtraMetadata', args: ['twitter', ''],
        });

      } else if (step.id === 32) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'updateName', args: ['Speedrun Asset v2'],
        });

      } else if (step.id === 33) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'updateSymbol', args: ['SRA2'],
        });

      } else if (step.id === 34) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'updateContractURI', args: ['ipfs://bafybeib20speedrun'],
        });

      // ── Boss: Pause & Renounce ────────────────────────────────────────────
      } else if (step.id === 35) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'pause', args: [[PAUSE_FEATURE.TRANSFER]],
        });

      } else if (step.id === 36) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'pause', args: [[PAUSE_FEATURE.MINT]],
        });

      } else if (step.id === 37) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'pause', args: [[PAUSE_FEATURE.BURN]],
        });

      } else if (step.id === 38) {
        actionTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'unpause', args: [[PAUSE_FEATURE.TRANSFER, PAUSE_FEATURE.MINT, PAUSE_FEATURE.BURN]],
        });

      } else if (step.id === 39) {
        // Renounce on Asset token
        const renounceTx = await writeContractAsync({
          address: assetToken, abi: B20_TOKEN_ABI,
          functionName: 'renounceLastAdmin', args: [],
        });
        setPhase('waiting');
        await publicClient.waitForTransactionReceipt({ hash: renounceTx });
        // Renounce on Stablecoin token
        actionTx = await writeContractAsync({
          address: stablecoinToken, abi: B20_TOKEN_ABI,
          functionName: 'renounceLastAdmin', args: [],
        });
      }

      if (!actionTx) throw new Error('No action transaction produced');
      setActionHash(actionTx);

      // Wait for action to confirm, then markStep
      setPhase('waiting');
      await publicClient.waitForTransactionReceipt({ hash: actionTx });

      setPhase('marking');
      const mHash = await writeContractAsync({
        address: contractAddress,
        abi: SPEEDRUN_ABI,
        functionName: 'markStep',
        args: [step.id, actionTx, ZERO32],
      });
      setMarkHash(mHash);
      setPhase('done');

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.slice(0, 200));
      setPhase('error');
    }
  }

  const phaseLabel: Record<Phase, string> = {
    idle:    step.isRenounce ? '⚠ Renounce (irreversible)' : 'Execute →',
    action:  'Waiting for signature…',
    waiting: 'Confirming…',
    marking: 'Marking step…',
    done:    '✓ Done',
    error:   'Retry',
  };

  return (
    <div className={`border rounded-xl p-5 transition-all ${
      isDone        ? 'border-green-500/30 bg-green-950/20'
      : isLocked    ? 'border-gray-800 bg-gray-950 opacity-50'
      : step.isRenounce ? 'border-red-500/40 bg-red-950/10'
                    : 'border-gray-700 bg-gray-900/50 hover:border-gray-600'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
            isDone ? 'bg-green-500/20 text-green-400 border border-green-500/40'
            : isLocked ? 'bg-gray-800 text-gray-600 border border-gray-700'
            : step.isRenounce ? 'bg-red-900/30 text-red-400 border border-red-500/30'
            : 'bg-blue-900/30 text-blue-400 border border-blue-500/30'
          }`}>
            {isDone ? '✓' : step.specId}
          </div>
          <div>
            <div className={`font-semibold text-sm ${isDone ? 'text-white' : isLocked ? 'text-gray-600' : 'text-gray-200'}`}>
              {step.title}
              {step.isRenounce && <span className="ml-2 text-xs text-red-400 font-normal">⚠ irreversible</span>}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs ${
                step.token === 'asset' ? 'text-violet-400'
                : step.token === 'stablecoin' ? 'text-cyan-400'
                : step.token === 'policy' ? 'text-orange-400'
                : 'text-yellow-400'
              }`}>
                {step.token === 'asset' ? 'Asset' : step.token === 'stablecoin' ? 'Stablecoin' : step.token === 'policy' ? 'PolicyRegistry' : 'Both tokens'}
              </span>
              <span className="text-gray-700">·</span>
              <span className={`text-xs ${step.gasEstimate > 200_000 ? 'text-yellow-500' : 'text-gray-600'}`}>
                ~{(step.gasEstimate / 1000).toFixed(0)}k gas
              </span>
            </div>
          </div>
        </div>
        <a href={step.docAnchor} target="_blank" rel="noopener noreferrer"
          className="text-gray-700 hover:text-blue-400 text-xs shrink-0 transition-colors" title="View docs">
          docs ↗
        </a>
      </div>

      {/* Description */}
      {!isDone && !isLocked && (
        <p className="text-gray-500 text-xs leading-relaxed mb-4">{step.description}</p>
      )}

      {/* Warning */}
      {step.warning && !isDone && (
        <div className="bg-yellow-900/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs text-yellow-400 mb-4">
          {step.warning}
        </div>
      )}

      {/* Locked prereqs */}
      {isLocked && step.prereqs.length > 0 && (
        <div className="text-xs text-gray-700 mt-1">Requires steps: {step.prereqs.map(p => p + 1).join(', ')}</div>
      )}

      {/* Execute button */}
      {!isDone && isAvailable && (
        <div className="space-y-2 mt-3">
          {/* Policy ID warnings */}
          {(step.id === 11 || step.id === 13) && blocklistPolicyId === 0n && (
            <p className="text-xs text-orange-400">⚠ Run step 10 (Create BLOCKLIST) first to set the policy ID.</p>
          )}
          {(step.id === 12 || step.id === 14 || step.id === 15 || step.id === 16) && allowlistPolicyId === 0n && (
            <p className="text-xs text-orange-400">⚠ Run step 11 (Create ALLOWLIST) first to set the policy ID.</p>
          )}

          <button
            onClick={execute}
            disabled={phase === 'action' || phase === 'waiting' || phase === 'marking'}
            className={`w-full py-2 px-4 rounded-lg text-sm font-semibold transition-colors ${
              step.isRenounce
                ? 'bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white'
                : phase === 'done'
                ? 'bg-green-700 text-white'
                : 'bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white'
            }`}
          >
            {phaseLabel[phase]}
          </button>

          {/* Phase indicator */}
          {phase !== 'idle' && phase !== 'error' && (
            <div className="flex gap-2 text-xs">
              {(['action', 'waiting', 'marking'] as const).map((p) => (
                <span key={p} className={`${
                  phase === p ? 'text-blue-400' : phase === 'done' || (p === 'action' && (phase === 'waiting' || phase === 'marking')) || (p === 'waiting' && phase === 'marking') ? 'text-green-500' : 'text-gray-700'
                }`}>
                  {p === 'action' ? '① Sign tx' : p === 'waiting' ? '② Confirm' : '③ markStep'}
                  {phase === p ? ' ●' : ''}
                </span>
              ))}
            </div>
          )}

          {error && (
            <p className="text-red-400 text-xs break-words">{error}</p>
          )}

          {/* Tx links after done */}
          {(actionHash || markHash) && (
            <div className="text-xs space-y-1 mt-1">
              {actionHash && (
                <a href={`https://sepolia.basescan.org/tx/${actionHash}`} target="_blank" rel="noopener noreferrer"
                  className="block text-gray-600 hover:text-blue-400 font-mono transition-colors">
                  action: {actionHash.slice(0, 14)}… ↗
                </a>
              )}
              {markHash && (
                <a href={`https://sepolia.basescan.org/tx/${markHash}`} target="_blank" rel="noopener noreferrer"
                  className="block text-gray-600 hover:text-green-400 font-mono transition-colors">
                  markStep: {markHash.slice(0, 14)}… ↗
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Done badge */}
      {isDone && (
        <div className="mt-2 text-xs text-green-600 font-mono">step {step.specId} complete</div>
      )}
    </div>
  );
}
