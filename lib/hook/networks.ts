import { robinhoodRpcUrl } from '../rpc'
/** A chain with a canonical Uniswap v4 deployment. */
export type V4Network = {
  chainId: number
  name: string
  poolManager: string
  stateView: string
  positionManager: string
  /** A public RPC used for read-only safety checks. */
  rpc: string
  /** Average seconds per block, used to turn a log window into a time window. */
  blockSeconds: number
  explorer: string
}

/** Every chain with a canonical Uniswap v4 deployment, from Uniswap's deployments.json. */
export const V4_NETWORKS: V4Network[] = [
  { chainId: 1, name: 'Ethereum', poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90', stateView: '0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227', positionManager: '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e', rpc: 'https://eth.llamarpc.com', blockSeconds: 12, explorer: 'https://etherscan.io' },
  { chainId: 10, name: 'Optimism', poolManager: '0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3', stateView: '0xc18a3169788F4F75A170290584ECA6395C75Ecdb', positionManager: '0x3C3Ea4B57a46241e54610e5f022E5c45859A1017', rpc: 'https://mainnet.optimism.io', blockSeconds: 2, explorer: 'https://optimistic.etherscan.io' },
  { chainId: 56, name: 'BNB Chain', poolManager: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF', stateView: '0xd13Dd3D6E93f276FAfc9Db9E6BB47C1180aeE0c4', positionManager: '0x7A4a5c919aE2541AeD11041A1AEeE68f1287f95b', rpc: 'https://bsc-dataseed1.bnbchain.org', blockSeconds: 0.75, explorer: 'https://bscscan.com' },
  { chainId: 130, name: 'Unichain', poolManager: '0x1F98400000000000000000000000000000000004', stateView: '0x86e8631A016F9068C3f085fAF484Ee3F5fDee8f2', positionManager: '0x4529A01c7A0410167c5740C487A8DE60232617bf', rpc: 'https://mainnet.unichain.org', blockSeconds: 1, explorer: 'https://uniscan.xyz' },
  { chainId: 137, name: 'Polygon', poolManager: '0x67366782805870060151383F4BbFF9daB53e5cD6', stateView: '0x5eA1bD7974c8A611cBAB0bDCAFcB1D9CC9b3BA5a', positionManager: '0x1Ec2eBf4F37E7363FDfe3551602425af0B3ceef9', rpc: 'https://polygon-rpc.com', blockSeconds: 2, explorer: 'https://polygonscan.com' },
  { chainId: 143, name: 'Monad', poolManager: '0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e', stateView: '0x77395F3b2E73aE90843717371294fa97cC419D64', positionManager: '0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016', rpc: 'https://rpc.monad.xyz', blockSeconds: 1, explorer: 'https://explorer.monad.xyz' },
  { chainId: 196, name: 'X Layer', poolManager: '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', stateView: '0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990', positionManager: '0xcF1EAFC6928dC385A342E7C6491d371d2871458b', rpc: 'https://rpc.xlayer.tech', blockSeconds: 3, explorer: 'https://www.oklink.com/xlayer' },
  { chainId: 480, name: 'World Chain', poolManager: '0xb1860D529182ac3BC1F51Fa2ABd56662b7D13f33', stateView: '0x51D394718bc09297262e368c1A481217FdEB71eb', positionManager: '0xC585E0f504613b5fBf874F21Af14c65260fB41fA', rpc: 'https://worldchain-mainnet.g.alchemy.com/public', blockSeconds: 2, explorer: 'https://worldscan.org' },
  { chainId: 1868, name: 'Soneium', poolManager: '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', stateView: '0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990', positionManager: '0x1b35d13a2E2528f192637F14B05f0Dc0e7dEB566', rpc: 'https://rpc.soneium.org', blockSeconds: 2, explorer: 'https://soneium.blockscout.com' },
  { chainId: 4663, name: 'Robinhood Chain', poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951', stateView: '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b', positionManager: '0x58daec3116aae6D93017bAAea7749052E8a04fA7', rpc: robinhoodRpcUrl(), blockSeconds: 2, explorer: 'https://robinhoodchain.blockscout.com' },
  { chainId: 8453, name: 'Base', poolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b', stateView: '0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71', positionManager: '0x7C5f5A4bBd8fD63184577525326123B519429bDc', rpc: 'https://lb.drpc.live/base/AvJ-GZs3dkmVmwwWmNHQdbpATTURoFsR8ajMHuPn-b5m', blockSeconds: 2, explorer: 'https://basescan.org' },
  { chainId: 42161, name: 'Arbitrum', poolManager: '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', stateView: '0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990', positionManager: '0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869', rpc: 'https://arb1.arbitrum.io/rpc', blockSeconds: 0.25, explorer: 'https://arbiscan.io' },
  { chainId: 42220, name: 'Celo', poolManager: '0x288dc841A52FCA2707c6947B3A777c5E56cd87BC', stateView: '0xbc21f8720BABf4b20d195eE5C6e99c52b76F2bfb', positionManager: '0xf7965f3981e4D5BC383BfBCb61501763e9068CA9', rpc: 'https://forno.celo.org', blockSeconds: 5, explorer: 'https://celoscan.io' },
  { chainId: 43114, name: 'Avalanche', poolManager: '0x06380C0e0912312B5150364B9DC4542BA0DbBc85', stateView: '0xc3c9e198C735a4b97e3e683f391cCBDD60B69286', positionManager: '0xB74b1F14d2754AcfcbBe1a221023a5cf50Ab8ACD', rpc: 'https://api.avax.network/ext/bc/C/rpc', blockSeconds: 2, explorer: 'https://snowscan.xyz' },
  { chainId: 57073, name: 'Ink', poolManager: '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32', stateView: '0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990', positionManager: '0x1b35d13a2E2528f192637F14B05f0Dc0e7dEB566', rpc: 'https://rpc-gel.inkonchain.com', blockSeconds: 1, explorer: 'https://explorer.inkonchain.com' },
  { chainId: 59144, name: 'Linea', poolManager: '0x248083Fb965359d82b06C1F5322480Dcfc1AD857', stateView: '0xE861de206E460A8b936b05ad3816520B58ccDf9b', positionManager: '0xdDCAD5775B2816a87495f207731b3571D7EE3c76', rpc: 'https://rpc.linea.build', blockSeconds: 3, explorer: 'https://lineascan.build' },
  { chainId: 7777777, name: 'Zora', poolManager: '0x0575338e4C17006aE181B47900A84404247CA30f', stateView: '0x385785Af07d63b50d0a0ea57C4FF89D06adf7328', positionManager: '0xf66C7b99e2040f0D9b326B3b7c152E9663543D63', rpc: 'https://rpc.zora.energy', blockSeconds: 2, explorer: 'https://explorer.zora.energy' },
]

/**
 * Look up a v4 network by chain id.
 *
 * `V4_RPC_<chainId>` overrides the built-in endpoint, so an operator can point a chain at a
 * provider that serves wide `eth_getLogs` ranges without editing the registry. The public
 * defaults work but several rate-limit or cap ranges at 10,000 blocks.
 */
export const v4NetworkById = (chainId: number): V4Network | undefined => {
  const network = V4_NETWORKS.find((n) => n.chainId === chainId)
  if (!network) return undefined
  const override = process.env[`V4_RPC_${chainId}`]
  return override ? { ...network, rpc: override } : network
}
