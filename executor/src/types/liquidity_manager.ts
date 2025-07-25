/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/liquidity_manager.json`.
 */
export type LiquidityManager = {
  address: "FB2bC1eV24WNFyJUziFHgfvCNFeReDtuvqpkuY457tAW";
  metadata: {
    name: "liquidityManager";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Created with Anchor";
  };
  instructions: [
    {
      name: "addLiquidity";
      discriminator: [181, 157, 89, 67, 143, 182, 52, 72];
      accounts: [
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "tokenProgram2022";
        },
        {
          name: "manager";
          writable: true;
        },
        {
          name: "executor";
          signer: true;
          relations: ["manager"];
        },
        {
          name: "nftOwner";
          signer: true;
        },
        {
          name: "poolState";
          writable: true;
        },
        {
          name: "protocolPosition";
          writable: true;
        },
        {
          name: "personalPosition";
          writable: true;
        },
        {
          name: "nftAccount";
          writable: true;
        },
        {
          name: "tickArrayLower";
          writable: true;
        },
        {
          name: "tickArrayUpper";
          writable: true;
        },
        {
          name: "tokenAccount0";
          writable: true;
        },
        {
          name: "tokenAccount1";
          writable: true;
        },
        {
          name: "tokenVault0";
          writable: true;
        },
        {
          name: "tokenVault1";
          writable: true;
        },
        {
          name: "vault0Mint";
        },
        {
          name: "vault1Mint";
        },
        {
          name: "raydiumProgram";
        }
      ];
      args: [];
    },
    {
      name: "fundVaults";
      discriminator: [89, 235, 50, 135, 225, 109, 144, 154];
      accounts: [
        {
          name: "vaultA";
          writable: true;
        },
        {
          name: "vaultB";
          writable: true;
        },
        {
          name: "payerTokenA";
          writable: true;
        },
        {
          name: "payerTokenB";
          writable: true;
        },
        {
          name: "mintA";
          writable: true;
        },
        {
          name: "mintB";
          writable: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        }
      ];
      args: [
        {
          name: "amountA";
          type: "u64";
        },
        {
          name: "amountB";
          type: "u64";
        }
      ];
    },
    {
      name: "initialize";
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237];
      accounts: [
        {
          name: "manager";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [109, 97, 110, 97, 103, 101, 114, 45, 118, 50];
              },
              {
                kind: "account";
                path: "pool";
              }
            ];
          };
        },
        {
          name: "tokenVaultA";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "manager";
              },
              {
                kind: "const";
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ];
              },
              {
                kind: "account";
                path: "tokenMintA";
              }
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ];
            };
          };
        },
        {
          name: "tokenVaultB";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "manager";
              },
              {
                kind: "const";
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ];
              },
              {
                kind: "account";
                path: "tokenMintB";
              }
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ];
            };
          };
        },
        {
          name: "pool";
          writable: true;
        },
        {
          name: "tokenMintA";
        },
        {
          name: "tokenMintB";
        },
        {
          name: "authority";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "associatedTokenProgram";
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        }
      ];
      args: [
        {
          name: "lowerTick";
          type: "i32";
        },
        {
          name: "upperTick";
          type: "i32";
        },
        {
          name: "executor";
          type: "pubkey";
        }
      ];
    },
    {
      name: "removeLiquidity";
      discriminator: [80, 85, 209, 72, 24, 206, 177, 108];
      accounts: [
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "tokenProgram2022";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "manager";
          writable: true;
        },
        {
          name: "executor";
          signer: true;
          relations: ["manager"];
        },
        {
          name: "nftOwner";
          signer: true;
        },
        {
          name: "poolState";
          writable: true;
        },
        {
          name: "protocolPosition";
          writable: true;
        },
        {
          name: "personalPosition";
          writable: true;
        },
        {
          name: "nftAccount";
          writable: true;
        },
        {
          name: "tickArrayLower";
          writable: true;
        },
        {
          name: "tickArrayUpper";
          writable: true;
        },
        {
          name: "tokenAccount0";
          writable: true;
        },
        {
          name: "tokenAccount1";
          writable: true;
        },
        {
          name: "tokenVault0";
          writable: true;
        },
        {
          name: "tokenVault1";
          writable: true;
        },
        {
          name: "vault0Mint";
        },
        {
          name: "vault1Mint";
        },
        {
          name: "raydiumProgram";
        }
      ];
      args: [];
    },
    {
      name: "storeNewPosition";
      discriminator: [128, 220, 77, 193, 175, 82, 22, 174];
      accounts: [
        {
          name: "manager";
          writable: true;
        },
        {
          name: "authority";
          signer: true;
        }
      ];
      args: [
        {
          name: "nftMint";
          type: "pubkey";
        },
        {
          name: "lower";
          type: "i32";
        },
        {
          name: "upper";
          type: "i32";
        }
      ];
    },
    {
      name: "swap";
      discriminator: [248, 198, 158, 145, 225, 117, 135, 200];
      accounts: [
        {
          name: "payer";
          signer: true;
        },
        {
          name: "ammConfig";
          writable: true;
        },
        {
          name: "poolState";
          writable: true;
        },
        {
          name: "inputTokenAccount";
          writable: true;
        },
        {
          name: "outputTokenAccount";
          writable: true;
        },
        {
          name: "inputVault";
          writable: true;
        },
        {
          name: "outputVault";
          writable: true;
        },
        {
          name: "observationState";
          writable: true;
        },
        {
          name: "tokenProgram";
        },
        {
          name: "tokenProgram2022";
        },
        {
          name: "memoProgram";
        },
        {
          name: "inputVaultMint";
        },
        {
          name: "outputVaultMint";
        },
        {
          name: "raydiumProgram";
          address: "devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH";
        }
      ];
      args: [
        {
          name: "amountIn";
          type: "u64";
        }
      ];
    }
  ];
  accounts: [
    {
      name: "liquidityManager";
      discriminator: [47, 103, 35, 104, 90, 247, 127, 83];
    }
  ];
  errors: [
    {
      code: 6000;
      name: "noRebalanceNeeded";
      msg: "Current tick is within range - no rebalance needed";
    },
    {
      code: 6001;
      name: "invalidExecutor";
      msg: "Invalid executor";
    },
    {
      code: 6002;
      name: "invalidPoolData";
      msg: "The Pool Data is invalid";
    },
    {
      code: 6003;
      name: "calculationOverflow";
      msg: "";
    },
    {
      code: 6004;
      name: "accountNotFound";
      msg: "No Account Found";
    },
    {
      code: 6005;
      name: "invalidTickRange";
      msg: "Tick is in invalid Range";
    },
    {
      code: 6006;
      name: "invalidAccountData";
      msg: "Account Data is wrong";
    }
  ];
  types: [
    {
      name: "liquidityManager";
      type: {
        kind: "struct";
        fields: [
          {
            name: "authority";
            type: "pubkey";
          },
          {
            name: "executor";
            type: "pubkey";
          },
          {
            name: "pool";
            type: "pubkey";
          },
          {
            name: "tokenMintA";
            type: "pubkey";
          },
          {
            name: "tokenMintB";
            type: "pubkey";
          },
          {
            name: "tokenVaultA";
            type: "pubkey";
          },
          {
            name: "tokenVaultB";
            type: "pubkey";
          },
          {
            name: "lowerTick";
            type: "i32";
          },
          {
            name: "upperTick";
            type: "i32";
          },
          {
            name: "currentLiquidity";
            type: "u128";
          },
          {
            name: "positionNftMint";
            type: "pubkey";
          }
        ];
      };
    }
  ];
};
