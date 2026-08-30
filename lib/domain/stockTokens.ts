/**
 * The tokenized equities and ETFs Robinhood has issued on Robinhood Chain, by contract address.
 *
 * Identification is by address rather than by symbol because ticker-shaped symbols are the house
 * style on this chain and they collide: `HOOD` resolves to six unrelated memecoin contracts and
 * none of them is Robinhood stock, while `COIN`, `GME`, `NET`, `MU`, `SNDK` and `AMC` each exist
 * as both an issued equity and a memecoin. A symbol match would be wrong in both directions.
 *
 * The list was derived once from Krystal's logo slugs, where an issued equity's filename ends in
 * `robinhood-tokenized-stock` or `robinhood-token`, and confirmed against Uniswap's transaction
 * feed, which names the same 47 contracts `... • Robinhood Token`. The derivation is deliberately
 * not shipped: a CDN filename is not a contract and can change, whereas these addresses cannot.
 * A newly listed ticker is added here by hand.
 */
const STOCK_TOKENS = new Map<string, string>([
  ['0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', 'AAPL'], // Apple
  ['0x05a3d1cd21d0c88145e82600e62e7e496e0f222b', 'AMC'], // AMC Entertainment Holdings
  ['0x86923f96303d656e4aa86d9d42d1e57ad2023fdc', 'AMD'], // AMD
  ['0x12f190a9f9d7d37a250758b26824b97ce941bf54', 'AMZN'], // Amazon
  ['0x47f93d52cbec7c6d2cfc080e154002370a60daea', 'ASML'], // ASML Holding NV
  ['0xad25ac6c84d497db898fa1e8387bf6af3532a1c4', 'BABA'], // Alibaba
  ['0x48e39e56acdba37b09020c0b734a613c9a2f100a', 'BB'], // BlackBerry
  ['0x6330d8c3178a418788df01a47479c0ce7ccf450b', 'COIN'], // Coinbase
  ['0x4ea005168d7f09a7a0ba9d1def21a479950e44c2', 'COST'], // Costco
  ['0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5', 'CRCL'], // Circle Internet Group
  ['0x5f10a1c971b69e47e059e1dc91901b59b3fb49c3', 'CRWV'], // CoreWeave
  ['0x1d11f0496982706c5e14a514d4e79f2e6bde4516', 'DJT'], // Trump Media and Technology Group
  ['0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e', 'GLD'], // SPDR Gold Shares
  ['0x2d427692e928fa156ec22acfabafa0447c5805b7', 'GLXY'], // Galaxy Digital
  ['0x1b0e319c6a659f002271b69db8a7df2f911c153e', 'GME'], // GameStop
  ['0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3', 'GOOGL'], // Alphabet Class A
  ['0xccee82fe024c36fa15e1005ede3e9e4787e23d09', 'HIMS'], // Hims and Hers Health
  ['0xc72b96e0e48ecd4dc75e1e45396e26300bc39681', 'INTC'], // Intel
  ['0xc0d6457c16cc70d6790dd43521c899c87ce02f35', 'META'], // Meta Platforms
  ['0x43b07d15ce533bec5476d70c22a78a1b2b662155', 'MRNA'], // Moderna
  ['0xe93237c50d904957cf27e7b1133b510c669c2e74', 'MSFT'], // Microsoft
  ['0xec262a75e413fafd0df80480274532c79d42da09', 'MSTR'], // Strategy
  ['0xff080c8ce2e5feadaca0da81314ae59d232d4afd', 'MU'], // Micron Technology
  ['0x116f00968269b7bfbad4109ce591d6e74c0601d4', 'NET'], // Cloudflare
  ['0xe0444ef8bf4ed74f74fd73686e2ddf4c1c5591e8', 'NFLX'], // Netflix
  ['0x408c14038a04f7bd235329e26d2bf569ee20e250', 'NU'], // Nu Holdings
  ['0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', 'NVDA'], // Nvidia
  ['0xb0992820e760d836549ba69bc7598b4af75dee03', 'ORCL'], // Oracle
  ['0x1cdad396db64bda184d5182a97dd9b3c62100b7d', 'P'], // Everpure
  ['0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a', 'PLTR'], // Palantir Technologies
  ['0xd5f3879160bc7c32ebb4dc785f8a4f505888de68', 'QQQ'], // Invesco QQQ
  ['0x59818904ab4ce163b3ce4ffb64f2d6ca02c434b4', 'QUBT'], // Quantum Computing
  ['0xf0c4bf4c582cb3836e98394b1d4e7b7281101be8', 'RBLX'], // Roblox
  ['0x05b37fb53a299a1b874a619e1c4c404d52c36f4c', 'RDDT'], // Reddit
  ['0x92fd66527192e3e61d4ddd13322aa222de86f9b5', 'SGOV'], // iShares 0-3 Month Treasury Bond ETF
  ['0x84cab63bc87912e71ad199ff14a0ba45de68fef8', 'SKHY'], // SK Hynix
  ['0x411efb0e7f985935daec3d4c3ebaea0d0ad7d89f', 'SLV'], // iShares Silver Trust
  ['0xb90a19ff0af67f7779aff50a882a9cff42446400', 'SNDK'], // SanDisk
  ['0xba0cab75495255d0cb58e22b648bfed4ecd1f47e', 'SNOW'], // Snowflake
  ['0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea', 'SPCX'], // SpaceX
  ['0x117cc2133c37b721f49de2a7a74833232b3b4c0c', 'SPY'], // SPDR S&P 500 ETF Trust
  ['0x322f0929c4625ed5bad873c95208d54e1c003b2d', 'TSLA'], // Tesla
  ['0x58ffe4a942d3885baa22d7520691f611ef09e7aa', 'TSM'], // Taiwan Semiconductor Manufacturing
  ['0x5e81213613b6b86eab4c6c50d718d34359459786', 'TTWO'], // Take-Two Interactive Software
  ['0xd917b029c761d264c6a312bbbcda868658ef86a6', 'USAR'], // USA Rare Earth
  ['0xa30fa36db767ad9ed3f7a60fc79526fb4d56d344', 'USO'], // United States Oil Fund
  ['0x9e7abd3c9139d14e4c86dce0e455aab7a0c2fb3e', 'WYFI'], // WhiteFiber
])

/** How many issued equities the allowlist covers. Shown on the stocks page. */
export const STOCK_TOKEN_COUNT = STOCK_TOKENS.size

/**
 * Whether a contract is one of the issued equities.
 *
 * Lowercased on the way in because Krystal reports addresses lowercased while Uniswap reports
 * them checksummed, and both feed this.
 */
export const isStockToken = (address: string): boolean =>
  STOCK_TOKENS.has(address.toLowerCase())

/** The ticker an issued equity trades under, or null when the contract is not one. */
export const stockTicker = (address: string): string | null =>
  STOCK_TOKENS.get(address.toLowerCase()) ?? null

/** Whether either side of a pool is an issued equity. */
export const isStockPool = (pool: { token0Address: string; token1Address: string }): boolean =>
  isStockToken(pool.token0Address) || isStockToken(pool.token1Address)
