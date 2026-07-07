'use client';

import { useEffect, useState } from 'react';
import { useChainId, usePublicClient, useReadContract } from 'wagmi';
import { PRECOMPILES, BERYL_ACTIVATION } from './addresses';
import { SPEEDRUN_ABI } from './abis/Speedrun';

// ── Activation status ──────────────────────────────────────────────────────
export type ActivationStatus = 'unknown' | 'pending' | 'active';

export function useActivationStatus(): ActivationStatus {
  const client = usePublicClient();
  const [status, setStatus] = useState<ActivationStatus>('unknown');

  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    // B20Factory is a native precompile — eth_getCode always returns 0x even when live.
    // Probe by calling isB20(address(1)) instead: returns bool if active, reverts if not.
    client
      .readContract({
        address: PRECOMPILES.B20_FACTORY,
        abi: [{ name: 'isB20', type: 'function', stateMutability: 'view', inputs: [{ name: 'addr', type: 'address' }], outputs: [{ name: '', type: 'bool' }] }],
        functionName: 'isB20',
        args: ['0x0000000000000000000000000000000000000001'],
      })
      .then(() => {
        if (!cancelled) setStatus('active');
      })
      .catch(() => {
        if (!cancelled) setStatus('pending');
      });

    return () => { cancelled = true; };
  }, [client]);

  return status;
}

// ── Beryl countdown ────────────────────────────────────────────────────────
export interface Countdown {
  days: number;
  hours: number;
  mins: number;
  secs: number;
  expired: boolean;
  targetDate: Date | null;
}

export function useBerylCountdown(): Countdown {
  const chainId = useChainId();
  const [countdown, setCountdown] = useState<Countdown>({
    days: 0, hours: 0, mins: 0, secs: 0,
    expired: false, targetDate: null,
  });

  useEffect(() => {
    const ts = BERYL_ACTIVATION[chainId];
    if (!ts) return;

    const targetDate = new Date(ts * 1000);

    const tick = () => {
      const diff = ts - Date.now() / 1000;
      if (diff <= 0) {
        setCountdown({ days: 0, hours: 0, mins: 0, secs: 0, expired: true, targetDate });
        return;
      }
      setCountdown({
        days: Math.floor(diff / 86400),
        hours: Math.floor((diff % 86400) / 3600),
        mins: Math.floor((diff % 3600) / 60),
        secs: Math.floor(diff % 60),
        expired: false,
        targetDate,
      });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [chainId]);

  return countdown;
}

// ── Speedrun contract reads ────────────────────────────────────────────────
export function useSpeedrunProgress(contractAddress: `0x${string}` | undefined) {
  const { data: progress } = useReadContract({
    address: contractAddress,
    abi: SPEEDRUN_ABI,
    functionName: 'progress',
    query: { enabled: !!contractAddress, refetchInterval: 5_000 },
  });

  const { data: initialized, refetch: refetchInitialized } = useReadContract({
    address: contractAddress,
    abi: SPEEDRUN_ABI,
    functionName: 'initialized',
    query: { enabled: !!contractAddress, refetchInterval: 3_000, refetchIntervalInBackground: true },
  });

  const { data: assetToken, refetch: refetchAsset } = useReadContract({
    address: contractAddress,
    abi: SPEEDRUN_ABI,
    functionName: 'assetToken',
    query: { enabled: !!contractAddress, refetchInterval: 3_000, refetchIntervalInBackground: true },
  });

  const { data: stablecoinToken, refetch: refetchStable } = useReadContract({
    address: contractAddress,
    abi: SPEEDRUN_ABI,
    functionName: 'stablecoinToken',
    query: { enabled: !!contractAddress, refetchInterval: 3_000, refetchIntervalInBackground: true },
  });

  const { data: completedAt } = useReadContract({
    address: contractAddress,
    abi: SPEEDRUN_ABI,
    functionName: 'completedAt',
    query: { enabled: !!contractAddress },
  });

  const { data: startedAt } = useReadContract({
    address: contractAddress,
    abi: SPEEDRUN_ABI,
    functionName: 'startedAt',
    query: { enabled: !!contractAddress },
  });

  const progressBigInt = progress ?? 0n;

  const refetch = () => Promise.all([refetchInitialized(), refetchAsset(), refetchStable()]);

  return {
    progress: progressBigInt,
    initialized: initialized ?? false,
    assetToken: assetToken as `0x${string}` | undefined,
    stablecoinToken: stablecoinToken as `0x${string}` | undefined,
    completedAt: completedAt ?? 0n,
    startedAt: startedAt ?? 0n,
    isStepDone: (id: number) => Boolean((progressBigInt >> BigInt(id)) & 1n),
    stepsCompleted: popcount(progressBigInt),
    refetch,
  };
}

function popcount(n: bigint): number {
  let count = 0;
  while (n > 0n) {
    count += Number(n & 1n);
    n >>= 1n;
  }
  return count;
}

// ── Local storage: Speedrun contract address ───────────────────────────────
const LS_KEY = 'b20speedrun:contract';

export function useSpeedrunContractAddress() {
  const [address, setAddressState] = useState<`0x${string}` | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY);
    if (stored?.startsWith('0x')) {
      setAddressState(stored as `0x${string}`);
    }
  }, []);

  const setAddress = (addr: `0x${string}` | null) => {
    if (addr) {
      localStorage.setItem(LS_KEY, addr);
    } else {
      localStorage.removeItem(LS_KEY);
    }
    setAddressState(addr);
  };

  return [address, setAddress] as const;
}
