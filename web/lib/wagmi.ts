import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base, baseSepolia } from 'wagmi/chains';
import { Attribution } from 'ox/erc8021';

const DATA_SUFFIX = Attribution.toDataSuffix({ codes: ['bc_8aubniym'] });

export const wagmiConfig = getDefaultConfig({
  appName: 'B20 Speedrun',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'b20speedrun',
  chains: [baseSepolia, base],
  ssr: true,
  dataSuffix: DATA_SUFFIX,
});

export { base, baseSepolia };
