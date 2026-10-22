/**
 * known-tokens.ts
 *
 * Known SEP-41 token metadata per network, sourced from:
 *   - Circle developer docs (USDC, EURC): https://developers.circle.com/stablecoins/usdc-contract-addresses
 *   - StellarExpert API (contract addresses & decimals): https://stellar.expert/explorer
 *
 * The `contract` field is the Soroban C-address of the wrapped SEP-41 token
 * contract.  The `issuer` is the classic Stellar G-address of the token issuer
 * (provided for reference and deep-link construction only).
 *
 * When NETWORK_NAME === 'Mainnet' consume MAINNET_TOKENS; otherwise TESTNET_TOKENS.
 *
 * IMPORTANT: Do NOT use these values for financial decisions. Always verify
 * contract addresses before sending funds.
 */

// ─── Token metadata type ──────────────────────────────────────────────────────

export interface KnownToken {
  /** Short ticker symbol, e.g. "USDC". */
  symbol: string;
  /** Human-readable name, e.g. "USD Coin". */
  name: string;
  /** Soroban contract C-address (56 chars, starts with C). */
  contract: string;
  /** Classic Stellar G-address of the asset issuer. */
  issuer: string;
  /** Number of decimal places (always 7 for Stellar assets). */
  decimals: number;
  /** Optional short description shown in the dropdown. */
  description?: string;
}

// ─── Testnet tokens ───────────────────────────────────────────────────────────
// Sources:
//   USDC:  https://developers.circle.com/stablecoins/usdc-contract-addresses (Stellar Testnet)
//          https://stellar.expert/explorer/testnet/asset/USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
//   EURC:  https://developers.circle.com/stablecoins/eurc-contract-addresses (Stellar Testnet)
//          https://stellar.expert/explorer/testnet/asset/EURC-GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO
//   XLM:   https://stellar.expert/explorer/testnet/asset/XLM
//   AQUA:  https://stellar.expert/explorer/testnet/asset/AQUA-GAHPYWLK6YRN7CVYZOO4H3VDRZ7PVF5UJGLZCSPAEIKJE2XSWF5LAGER

export const TESTNET_TOKENS: KnownToken[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    contract: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
    issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    decimals: 7,
    description: 'Circle testnet USDC — no real value',
  },
  {
    symbol: 'EURC',
    name: 'Euro Coin',
    contract: 'CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ',
    issuer: 'GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO',
    decimals: 7,
    description: 'Circle testnet EURC — no real value',
  },
  {
    symbol: 'XLM',
    name: 'Stellar Lumens (wrapped)',
    contract: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    issuer: 'native',
    decimals: 7,
    description: 'Wrapped native XLM SEP-41 contract',
  },
  {
    symbol: 'AQUA',
    name: 'Aquarius',
    contract: 'CDNVQW44C3HALYNVQ4SOBXY5EWYTGVYXX6JPESOLQDABJI5FC5LTRRUE',
    issuer: 'GAHPYWLK6YRN7CVYZOO4H3VDRZ7PVF5UJGLZCSPAEIKJE2XSWF5LAGER',
    decimals: 7,
    description: 'Aquarius AMM governance token',
  },
];

// ─── Mainnet tokens ───────────────────────────────────────────────────────────
// Sources:
//   USDC:  https://developers.circle.com/stablecoins/usdc-contract-addresses (Stellar)
//          https://stellar.expert/explorer/public/asset/USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
//   EURC:  https://developers.circle.com/stablecoins/eurc-contract-addresses (Stellar)
//          https://stellar.expert/explorer/public/asset/EURC-GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2
//   XLM:   https://stellar.expert/explorer/public/asset/XLM
//   AQUA:  https://stellar.expert/explorer/public/asset/AQUA-GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA

export const MAINNET_TOKENS: KnownToken[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    contract: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    decimals: 7,
    description: 'Circle USDC — US Dollar–backed stablecoin',
  },
  {
    symbol: 'EURC',
    name: 'Euro Coin',
    contract: 'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV',
    issuer: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2',
    decimals: 7,
    description: 'Circle EURC — Euro–backed stablecoin',
  },
  {
    symbol: 'XLM',
    name: 'Stellar Lumens (wrapped)',
    contract: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
    issuer: 'native',
    decimals: 7,
    description: 'Wrapped native XLM SEP-41 contract',
  },
  {
    symbol: 'AQUA',
    name: 'Aquarius',
    contract: 'CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK',
    issuer: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA',
    decimals: 7,
    description: 'Aquarius AMM governance token',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the token list for the given network name.
 *
 * @param networkName  'Mainnet' | 'Testnet' (value of NETWORK_NAME constant)
 */
export function getKnownTokens(networkName: string): KnownToken[] {
  return networkName === 'Mainnet' ? MAINNET_TOKENS : TESTNET_TOKENS;
}

/**
 * Look up a token by its Soroban contract address (case-insensitive).
 *
 * @param contract     C-address to find
 * @param networkName  'Mainnet' | 'Testnet'
 * @returns            Matching KnownToken or undefined
 */
export function findTokenByContract(
  contract: string,
  networkName: string,
): KnownToken | undefined {
  return getKnownTokens(networkName).find(
    (t) => t.contract.toUpperCase() === contract.trim().toUpperCase(),
  );
}
