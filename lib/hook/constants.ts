/** A token quick-pick offered when defining a pair. */
export type TokenOption = { symbol: string; address: string }

/** A chain the hook can be deployed to, with its v4 addresses and explorer. */
export type DeployNetwork = {
  chainId: number
  name: string
  /** Canonical v4 PoolManager. Empty when not yet known for a chain; the user supplies it. */
  poolManager: string
  /** Canonical v4 PositionManager, through which liquidity is added, removed and collected. */
  positionManager: string
  /** Canonical v4 StateView, a read-only lens over pool state (slot0, liquidity). */
  stateView: string
  /** Explorer base for a transaction hash, ending in `/tx/`. */
  explorerTx: string
  tokens: TokenOption[]
}

const NATIVE = '0x0000000000000000000000000000000000000000'

/** Networks offered in the deploy console. Add a chain here and to `lib/wagmi.ts` to support it. */
export const DEPLOY_NETWORKS: DeployNetwork[] = [
  {
    chainId: 56,
    name: 'BNB Smart Chain',
    poolManager: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF',
    positionManager: '0x7A4a5c919aE2541AeD11041A1AEeE68f1287f95b',
    stateView: '0xd13Dd3D6E93f276FAfc9Db9E6BB47C1180aeE0c4',
    explorerTx: 'https://bscscan.com/tx/',
    tokens: [
      { symbol: 'BNB', address: NATIVE },
      { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955' },
      { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
      { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
    ],
  },
  {
    chainId: 8453,
    name: 'Base',
    poolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
    positionManager: '0x7C5f5A4bBd8fD63184577525326123B519429bDc',
    stateView: '0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71',
    explorerTx: 'https://basescan.org/tx/',
    tokens: [
      { symbol: 'ETH', address: NATIVE },
      { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
      { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006' },
    ],
  },
  {
    chainId: 4663,
    name: 'Robinhood Chain',
    poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
    positionManager: '0x58daec3116aae6D93017bAAea7749052E8a04fA7',
    stateView: '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b',
    explorerTx: 'https://robinhoodchain.blockscout.com/tx/',
    tokens: [{ symbol: 'ETH', address: NATIVE }],
  },
]

/** Look up a network by chain id. */
export const networkById = (chainId: number): DeployNetwork | undefined =>
  DEPLOY_NETWORKS.find((n) => n.chainId === chainId)

/** Deterministic CREATE2 proxy, present on every EVM chain. */
export const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as const

/** PoolKey.fee sentinel that marks a dynamic-fee pool (the hook sets the fee). */
export const DYNAMIC_FEE_FLAG = 0x800000

/** Fee in hundredths of a bip (1_000_000 = 100%); 3000 = 0.30%. */
export const feeToPercent = (hundredthsOfBip: number): string =>
  `${(hundredthsOfBip / 10_000).toFixed(2)}%`
