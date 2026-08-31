// Auto-generated from hook/out/VolumeTierFeeHook.sol/VolumeTierFeeHook.json
// Contains the ABI, creation bytecode, and a CREATE2 hook-address miner
// for deploying VolumeTierFeeHook from a browser wallet with viem.

import { concatHex, encodeAbiParameters, getAddress, keccak256, toHex } from "viem";

export const VOLUME_TIER_FEE_HOOK_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_poolManager",
        "type": "address",
        "internalType": "contract IPoolManager"
      },
      {
        "name": "_owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "afterAddLiquidity",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct ModifyLiquidityParams",
        "components": [
          {
            "name": "tickLower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "tickUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "liquidityDelta",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "delta",
        "type": "int256",
        "internalType": "BalanceDelta"
      },
      {
        "name": "feesAccrued",
        "type": "int256",
        "internalType": "BalanceDelta"
      },
      {
        "name": "hookData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "BalanceDelta"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "afterDonate",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "amount0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hookData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "afterInitialize",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "sqrtPriceX96",
        "type": "uint160",
        "internalType": "uint160"
      },
      {
        "name": "tick",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "afterRemoveLiquidity",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct ModifyLiquidityParams",
        "components": [
          {
            "name": "tickLower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "tickUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "liquidityDelta",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "delta",
        "type": "int256",
        "internalType": "BalanceDelta"
      },
      {
        "name": "feesAccrued",
        "type": "int256",
        "internalType": "BalanceDelta"
      },
      {
        "name": "hookData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "BalanceDelta"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "afterSwap",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct SwapParams",
        "components": [
          {
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "amountSpecified",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "sqrtPriceLimitX96",
            "type": "uint160",
            "internalType": "uint160"
          }
        ]
      },
      {
        "name": "delta",
        "type": "int256",
        "internalType": "BalanceDelta"
      },
      {
        "name": "hookData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      },
      {
        "name": "",
        "type": "int128",
        "internalType": "int128"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "beforeAddLiquidity",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct ModifyLiquidityParams",
        "components": [
          {
            "name": "tickLower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "tickUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "liquidityDelta",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "hookData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "beforeDonate",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "amount0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hookData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "beforeInitialize",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "sqrtPriceX96",
        "type": "uint160",
        "internalType": "uint160"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "beforeRemoveLiquidity",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct ModifyLiquidityParams",
        "components": [
          {
            "name": "tickLower",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "tickUpper",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "liquidityDelta",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "hookData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "beforeSwap",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct SwapParams",
        "components": [
          {
            "name": "zeroForOne",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "amountSpecified",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "sqrtPriceLimitX96",
            "type": "uint160",
            "internalType": "uint160"
          }
        ]
      },
      {
        "name": "hookData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes4",
        "internalType": "bytes4"
      },
      {
        "name": "",
        "type": "int256",
        "internalType": "BeforeSwapDelta"
      },
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "feeConfig",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "baseFee",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "tier1Fee",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "tier2Fee",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "tier3Fee",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "tier1Threshold",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "tier2Threshold",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "tier3Threshold",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "windowSeconds",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getHookPermissions",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Hooks.Permissions",
        "components": [
          {
            "name": "beforeInitialize",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "afterInitialize",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "beforeAddLiquidity",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "afterAddLiquidity",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "beforeRemoveLiquidity",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "afterRemoveLiquidity",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "beforeSwap",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "afterSwap",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "beforeDonate",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "afterDonate",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "beforeSwapReturnDelta",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "afterSwapReturnDelta",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "afterAddLiquidityReturnDelta",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "afterRemoveLiquidityReturnDelta",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "isLiquidityProvider",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "poolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IPoolManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteCurrentFee",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setFeeConfig",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          }
        ]
      },
      {
        "name": "config",
        "type": "tuple",
        "internalType": "struct VolumeTierFeeHook.FeeConfig",
        "components": [
          {
            "name": "baseFee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tier1Fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tier2Fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tier3Fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tier1Threshold",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "tier2Threshold",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "tier3Threshold",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "windowSeconds",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setLiquidityProvider",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "window",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "startedAt",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "swaps",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "FeeConfigSet",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "config",
        "type": "tuple",
        "indexed": false,
        "internalType": "struct VolumeTierFeeHook.FeeConfig",
        "components": [
          {
            "name": "baseFee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tier1Fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tier2Fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tier3Fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "tier1Threshold",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "tier2Threshold",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "tier3Threshold",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "windowSeconds",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LiquidityProviderSet",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "FeeConfigMissing",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ]
  },
  {
    "type": "error",
    "name": "HookNotImplemented",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidFee",
    "inputs": [
      {
        "name": "fee",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotDynamicFeePool",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotPoolManager",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotWhitelisted",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  }
] as const;

export const VOLUME_TIER_FEE_HOOK_BYTECODE = "0x60a0604052346102f157604051601f611d1a38819003918201601f19168301916001600160401b038311848410176102f55780849260409485528339810103126102f1578051906001600160a01b03821682036102f157602001516001600160a01b03811691908290036102f1576080525f6101a061007c610309565b8281528260208201528260408201528260608201528260808201528260a08201528260c08201528260e0820152826101008201528261012082015282610140820152826101608201528261018082015201525f6101a06100da610309565b60018152826020820152600160408201528260608201528260808201528260a0820152600160c08201528260e082015282610100820152826101208201528261014082015282610160820152826101808201520152612000301615156001148015906102e4575b80156102d3575b80156102c6575b80156102b9575b80156102ac575b801561029c575b8015610290575b8015610284575b8015610278575b801561026c575b8015610260575b8015610254575b8015610248575b610235578015610226575f80546001600160a01b0319168217815560405191907f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e08180a36119f0908161032a823960805181818161031a01528181610412015281816104ef01528181610857015281816108d101528181610f03015281816110180152818161129801526113850152f35b63d92e233d60e01b5f5260045ffd5b630732d7b560e51b5f523060045260245ffd5b50600130161515610195565b5060023016151561018e565b50600430161515610187565b50600830161515610180565b50601030161515610179565b50602030161515610172565b5060403016151561016b565b5060803016151560011415610164565b506101003016151561015d565b5061020030161515610156565b506104003016151561014f565b506108003016151560011415610148565b5061100030161515610141565b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b604051906101c082016001600160401b038111838210176102f55760405256fe60806040526004361015610011575f80fd5b5f3560e01c806321d0ee701461135b578063259982e51461126f578063575e24b414610f515780636c2bbe7e146108a55780636fe7e6eb14610e7757806374bf46fc14610b1b5780638878be34146109d75780638da5cb5b1461098757806399f7854a1461091f5780639f063efc146108a5578063b47b2fb114610790578063b6a8b0fa146102ef578063b9629a41146106e8578063c4e833ce1461056a578063d8a251f214610513578063dc4c90d3146104a5578063dc98354e14610390578063e1b4af69146102ef578063e8f6ae291461020c5763f2fde38b146100f5575f80fd5b346102085760207ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126102085761012c6113d3565b5f549073ffffffffffffffffffffffffffffffffffffffff8216908133036101e05773ffffffffffffffffffffffffffffffffffffffff169182156101b857827fffffffffffffffffffffffff0000000000000000000000000000000000000000927f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e05f80a316175f55005b7fd92e233d000000000000000000000000000000000000000000000000000000005f5260045ffd5b7f30cd7471000000000000000000000000000000000000000000000000000000005f5260045ffd5b5f80fd5b346102085760407ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610208576102436113d3565b602435908115158092036102085773ffffffffffffffffffffffffffffffffffffffff5f541633036101e05773ffffffffffffffffffffffffffffffffffffffff169081156101b85760207fc63b2cd57d159035214234fce2c910c2e679c9647b0afc09960d6e8cb1574f0791835f526001825260405f207fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0081541660ff8316179055604051908152a2005b34610208576102fd366115f3565b50505050505073ffffffffffffffffffffffffffffffffffffffff7f0000000000000000000000000000000000000000000000000000000000000000163303610368577f0a85dc29000000000000000000000000000000000000000000000000000000005f5260045ffd5b7fae18210a000000000000000000000000000000000000000000000000000000005f5260045ffd5b346102085760e07ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610208576103c76113d3565b5060a07fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc360112610208576103fa6115c0565b5073ffffffffffffffffffffffffffffffffffffffff7f00000000000000000000000000000000000000000000000000000000000000001633036103685760643562ffffff8116808203610208576280000091500361047d5760206040517fdc98354e000000000000000000000000000000000000000000000000000000008152f35b7f09a90e81000000000000000000000000000000000000000000000000000000005f5260045ffd5b34610208575f7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36011261020857602060405173ffffffffffffffffffffffffffffffffffffffff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b346102085760207ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610208576004355f5260036020526040805f205463ffffffff825191818116835260201c166020820152f35b34610208575f7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610208575f6101a06105a461172b565b8281528260208201528260408201528260608201528260808201528260a08201528260c08201528260e0820152826101008201528261012082015282610140820152826101608201528261018082015201526101c0602061060361172b565b60018152818101905f82526040810160018152606082015f8152608083015f815260a084015f815260c085016001815260e08601905f82526101008701925f84526101208801945f86526101408901965f88526101608a01985f8a526101a06101808c019b5f8d52019b5f8d526040519d8e916001835251151591015251151560408d015251151560608c015251151560808b015251151560a08a015251151560c089015251151560e08801525115156101008701525115156101208601525115156101408501525115156101608401525115156101808301525115156101a0820152f35b346102085760207ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610208576004355f52600260205261010060405f205463ffffffff6040519162ffffff8116835262ffffff8160181c16602084015262ffffff8160301c16604084015262ffffff8160481c166060840152818160601c166080840152818160801c1660a0840152818160a01c1660c084015260c01c1660e0820152f35b34610208576101607ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc360112610208576107c86113d3565b5060a07fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc3601126102085760607fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff3c360112610208576101443567ffffffffffffffff81116102085761083e9036906004016113f6565b505073ffffffffffffffffffffffffffffffffffffffff7f0000000000000000000000000000000000000000000000000000000000000000163303610368577f0a85dc29000000000000000000000000000000000000000000000000000000005f5260045ffd5b34610208576108b3366114ef565b5050505050505073ffffffffffffffffffffffffffffffffffffffff7f0000000000000000000000000000000000000000000000000000000000000000163303610368577f0a85dc29000000000000000000000000000000000000000000000000000000005f5260045ffd5b346102085760207ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126102085773ffffffffffffffffffffffffffffffffffffffff61096b6113d3565b165f526001602052602060ff60405f2054166040519015158152f35b34610208575f7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36011261020857602073ffffffffffffffffffffffffffffffffffffffff5f5416604051908152f35b346102085760a07ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc3601126102085760a0610a113661176c565b20805f52600260205260405f2063ffffffff610a2b6116dd565b915462ffffff8116835262ffffff8160181c16602084015262ffffff8160301c16604084015262ffffff8160481c166060840152818160601c166080840152818160801c1660a0840152818160a01c1660c084015260c01c1660e082019080825215610aef5790610ad9916020935f5260038452610abc63ffffffff610ab360405f20611833565b925116826118ea565b15610ae65763ffffffff84610ad392015116611868565b90611914565b62ffffff60405191168152f35b50600190611914565b827fdf5a4d6a000000000000000000000000000000000000000000000000000000005f5260045260245ffd5b34610208577ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36016101a081126102085760a013610208576101007fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff5c3601126102085773ffffffffffffffffffffffffffffffffffffffff5f541633036101e057610bac610ba7611694565b6118ad565b610bb7610ba76116a6565b610bc2610ba76116b8565b610bcd610ba76116ca565b60a0610bd83661176c565b205f52600260205260405f2062ffffff610bf0611694565b1681549165ffffff000000610c036116a6565b60181b169068ffffff000000000000610c1a6116b8565b60301b16916bffffff000000000000000000610c346116ca565b60481b16610124359463ffffffff86169485870361020857610144359463ffffffff86169889870361020857610164359263ffffffff84169485850361020857610184359663ffffffff881698898903610208577fffffffff00000000ffffffffffffffffffffffffffffffffffffffffffffffff937fffffffffffffffffffffffffffffffff00000000ffffffffffffffffffffffff7fffffffffffffffffffffffff00000000ffffffffffffffffffffffffffffffff927fffffffffffffffffffffffffffffffffffffffff000000ffffffffffffffffff7fffffffffffffffff00000000ffffffffffffffffffffffffffffffffffffffff967fffffffffffffffffffffffffffffffffffffffffffffff0000000000000000007bffffffff0000000000000000000000000000000000000000000000008f60c01b169a1617161716171617166fffffffff0000000000000000000000008b60601b16171673ffffffff000000000000000000000000000000008860801b161777ffffffff00000000000000000000000000000000000000008460a01b161717905560a0610ddd3661176c565b20976040519560a43562ffffff811680910361020857875260c43562ffffff811680910361020857602088015260e43562ffffff8116809103610208576040880152610104359762ffffff8916809903610208577f0ef62b1224c893be3467257c91dfa6cce9ef0950e38989233fe46e30470bacd3996101009960608a01525060808801525060a08601525060c08401525060e0820152a2005b34610208576101007ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36011261020857610eaf6113d3565b5060a07fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc36011261020857610ee26115c0565b50610eeb6115e3565b5073ffffffffffffffffffffffffffffffffffffffff7f0000000000000000000000000000000000000000000000000000000000000000163303610368577f0a85dc29000000000000000000000000000000000000000000000000000000005f5260045ffd5b34610208576101407ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc36011261020857610f896113d3565b5060a07fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc3601126102085760607fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff3c360112610208576101243567ffffffffffffffff811161020857610fff9036906004016113f6565b505073ffffffffffffffffffffffffffffffffffffffff7f00000000000000000000000000000000000000000000000000000000000000001633036103685761104661174c565b60243573ffffffffffffffffffffffffffffffffffffffff8116810361020857815260443573ffffffffffffffffffffffffffffffffffffffff8116810361020857602082015260643562ffffff811681036102085760408201526084358060020b810361020857606082015260a4359073ffffffffffffffffffffffffffffffffffffffff821682036102085760a091608082015220805f52600260205260405f2063ffffffff6110f66116dd565b915462ffffff8116835262ffffff8160181c16602084015262ffffff8160301c16604084015262ffffff8160481c166060840152818160601c166080840152818160801c1660a0840152818160a01c1660c084015260c01c1660e082019080825215610aef57624000009163ffffffff606094816111e4945116905f52600360205261118e60405f209161118983611833565b6118ea565b1561121e575b6111a382825460201c16611868565b7fffffffffffffffffffffffffffffffffffffffffffffffff00000000ffffffff67ffffffff0000000083549260201b1691161781555460201c1690611914565b1762ffffff604051917f575e24b40000000000000000000000000000000000000000000000000000000083525f6020840152166040820152f35b80547fffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000164283167fffffffffffffffffffffffffffffffffffffffffffffffff00000000ffffffff16178155611194565b346102085761127d36611424565b5050505073ffffffffffffffffffffffffffffffffffffffff7f00000000000000000000000000000000000000000000000000000000000000001633036103685773ffffffffffffffffffffffffffffffffffffffff16805f52600160205260ff60405f2054161580611344575b6113195760206040517f259982e5000000000000000000000000000000000000000000000000000000008152f35b7fdf17e316000000000000000000000000000000000000000000000000000000005f5260045260245ffd5b50325f52600160205260ff60405f205416156112eb565b346102085761136936611424565b505050505073ffffffffffffffffffffffffffffffffffffffff7f0000000000000000000000000000000000000000000000000000000000000000163303610368577f0a85dc29000000000000000000000000000000000000000000000000000000005f5260045ffd5b6004359073ffffffffffffffffffffffffffffffffffffffff8216820361020857565b9181601f840112156102085782359167ffffffffffffffff8311610208576020838186019501011161020857565b906101607ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc8301126102085760043573ffffffffffffffffffffffffffffffffffffffff81168103610208579160a07fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc8201126102085760249160807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff3c8301126102085760c491610144359067ffffffffffffffff8211610208576114eb916004016113f6565b9091565b906101a07ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc8301126102085760043573ffffffffffffffffffffffffffffffffffffffff81168103610208579160a07fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc8201126102085760249160807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff3c8301126102085760c49161014435916101643591610184359067ffffffffffffffff8211610208576114eb916004016113f6565b60c4359073ffffffffffffffffffffffffffffffffffffffff8216820361020857565b60e435908160020b820361020857565b6101207ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc8201126102085760043573ffffffffffffffffffffffffffffffffffffffff81168103610208579160a07fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc8301126102085760249160c4359160e43591610104359067ffffffffffffffff8211610208576114eb916004016113f6565b60a43562ffffff811681036102085790565b60c43562ffffff811681036102085790565b60e43562ffffff811681036102085790565b6101043562ffffff811681036102085790565b60405190610100820182811067ffffffffffffffff8211176116fe57604052565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52604160045260245ffd5b604051906101c0820182811067ffffffffffffffff8211176116fe57604052565b6040519060a0820182811067ffffffffffffffff8211176116fe57604052565b7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc60a09101126102085761179e61174c565b9060043573ffffffffffffffffffffffffffffffffffffffff8116810361020857825260243573ffffffffffffffffffffffffffffffffffffffff8116810361020857602083015260443562ffffff811681036102085760408301526064358060020b810361020857606083015260843573ffffffffffffffffffffffffffffffffffffffff81168103610208576080830152565b906040516040810181811067ffffffffffffffff8211176116fe57604052602063ffffffff8294548181168452821c16910152565b63ffffffff60019116019063ffffffff821161188057565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52601160045260245ffd5b62ffffff16620f424081116118bf5750565b7f9ae5d65e000000000000000000000000000000000000000000000000000000005f5260045260245ffd5b5163ffffffff1680151591826118ff57505090565b63ffffffff1681019150811061188057421090565b62ffffff9163ffffffff60c08301511680151590816119a9575b506119a05763ffffffff60a083015116801515908161198f575b506119865763ffffffff6080830151168015159182611975575b505061196d57511690565b602001511690565b63ffffffff16101590505f80611962565b50604001511690565b905063ffffffff821610155f611948565b50606001511690565b905063ffffffff821610155f61192e56fea26469706673582212205d19f1799d2042aeea1e399aadd39c47e5da53156f395a77014680da00df236d64736f6c634300081a0033" as `0x${string}`;

// Uniswap v4 hook permission flag bits packed into the low 14 bits of the
// deployed hook address. The miner searches for a salt whose CREATE2 address
// carries exactly these bits.
export const BEFORE_INITIALIZE_FLAG = 1 << 13;
export const BEFORE_ADD_LIQUIDITY_FLAG = 1 << 11;
export const BEFORE_SWAP_FLAG = 1 << 7;

// Combined flags this hook requires, and the low-14-bit mask (Hooks.ALL_HOOK_MASK).
export const HOOK_FLAGS =
  BEFORE_INITIALIZE_FLAG | BEFORE_ADD_LIQUIDITY_FLAG | BEFORE_SWAP_FLAG;
const HOOK_FLAGS_MASK = 0x3fffn;

// Deterministic CREATE2 deployer proxy (same address on BSC and mainnet).
export const CREATE2_DEPLOYER =
  "0x4e59b44847b379578588920cA78FbF26c0B4956C" as `0x${string}`;

// Mine a CREATE2 salt so the resulting hook address encodes the required
// permission flag bits. Loops salt = 0, 1, 2, ... until the low 14 bits of the
// candidate address equal HOOK_FLAGS, then returns that salt and address.
export function mineHookSalt(
  poolManager: `0x${string}`,
  owner: `0x${string}`,
): { salt: `0x${string}`; hookAddress: `0x${string}` } {
  const encodedArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [poolManager, owner],
  );
  const initcode = concatHex([VOLUME_TIER_FEE_HOOK_BYTECODE, encodedArgs]);
  // Hash the init code once; the CREATE2 address depends on it and the salt, so
  // only the salt varies across the loop. Re-hashing 7KB each iteration would be
  // far too slow in the browser.
  const initcodeHash = keccak256(initcode);
  const flags = BigInt(HOOK_FLAGS);

  for (let i = 0; ; i++) {
    const salt = toHex(i, { size: 32 });
    // CREATE2: address = last 20 bytes of keccak256(0xff ++ deployer ++ salt ++ keccak256(initcode)).
    const digest = keccak256(concatHex([
      "0xff",
      CREATE2_DEPLOYER,
      salt,
      initcodeHash,
    ]));
    const hookAddress = getAddress(`0x${digest.slice(-40)}`);

    if ((BigInt(hookAddress) & HOOK_FLAGS_MASK) === flags) {
      return { salt, hookAddress };
    }
  }
}
