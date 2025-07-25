import * as anchor from "@coral-xyz/anchor";
import { PoolUtils, TickUtils } from "@raydium-io/raydium-sdk-v2";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createInitializeAccount3Instruction,
  getAccount,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import dotenv from "dotenv";
import { initSdk, txVersion } from "../sdk/raydium/config";

dotenv.config();
const url = process.env.ANCHOR_PROVIDER_URL!;
const wallet = anchor.Wallet.local();
const connection = new Connection(url, "confirmed");
const provider = new anchor.AnchorProvider(connection, wallet, {});
anchor.setProvider(provider);

console.log("wallet:", provider.wallet.publicKey.toBase58());

function tickArrayStartTick(tickIndex, ticksPerArray = 64) {
  return Math.floor(tickIndex / ticksPerArray) * ticksPerArray;
}

function deriveTickArrayPDA(programId, poolId, startTick, tickSpacing) {
  return TickUtils.getTickArrayAddressByTick(
    new PublicKey(programId),
    new PublicKey(poolId),
    startTick,
    tickSpacing
  );
}

const TICKS_PER_ARRAY = 64;

describe("liquidity-manager rebalance test", () => {
  const program = anchor.workspace.LiquidityManager;
  const mintA = new PublicKey("2PHq92eDkKEDRNZnzmXk7xWB1kmQJiyAhC986i6cvp1Y");
  const mintB = new PublicKey("CnyYF9m9qvzkRd2r6inbk2rJqZ96cUAvgSt9mgo2SRyG");
  const pool = new PublicKey("owkm9TYPq1s2arx6rXQAGNxnmkWR2hsUARRf6iAe74y"); // good pool
  const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey(
    "devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH"
  );

  let managerPda: PublicKey;
  let tokenVaultA: PublicKey;
  let tokenVaultB: PublicKey;
  let positionNftMint: PublicKey;
  let positionNftAccount: PublicKey;
  let positionTokenAccount: PublicKey;
  let personalPosition: PublicKey;
  let protocolPosition: PublicKey;

  before(async () => {
    [managerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("manager-v6"), pool.toBuffer()],
      program.programId
    );

    console.log(managerPda);

    tokenVaultA = await getAssociatedTokenAddress(mintA, managerPda, true);
    tokenVaultB = await getAssociatedTokenAddress(mintB, managerPda, true);
  });

  /*
  it("Fund pool Vaults ", async () => {
    const raydium = await initSdk(provider.connection, provider.wallet, {
      loadToken: true,
    });

    const data = await raydium.clmm.getPoolInfoFromRpc(pool.toBase58());
    const poolKeys = data.poolKeys;

    const poolVault0 = new PublicKey(poolKeys.vault.A);
    const poolVault1 = new PublicKey(poolKeys.vault.B);

    const amountTokenA = BigInt(10_000_000_000_000_000); // 10B tokens with 9 decimals
    const amountTokenB = BigInt(10_000_000_000_000_000); // 10B tokens with 9 decimals

    const userTokenAccountA = await getAssociatedTokenAddress(
      mintA,
      provider.wallet.publicKey
    );
    const userTokenAccountB = await getAssociatedTokenAddress(
      mintB,
      provider.wallet.publicKey
    );

    console.log("Logging userTokenAccountA ", userTokenAccountA);
    console.log("Logging userTokenAccountB ", userTokenAccountB);

    console.log("Funding pool vault 0...");
    
    await transfer(
      provider.connection,
      provider.wallet.payer,
      userTokenAccountA,
      poolVault0,
      provider.wallet.publicKey,
      amountTokenA
    );

    console.log("Funding pool vault 1...");

    await transfer(
      provider.connection,
      provider.wallet.payer,
      userTokenAccountB,
      poolVault1,
      provider.wallet.publicKey,
      amountTokenB
    );

    console.log("Pool vaults funded successfully!");

    const vaultABalance = await provider.connection.getTokenAccountBalance(
      poolVault0
    );
    console.log("Pool vault 0 balance:", vaultABalance.value.uiAmountString);

    const vaultBBalance = await provider.connection.getTokenAccountBalance(
      poolVault1
    );
    console.log("Pool vault 1 balance:", vaultBBalance.value.uiAmountString);
  });
*/

  it("Initialize the manager (if needed)", async () => {
    const executorSecret = JSON.parse(process.env.KEY_PAIR_JSON!); // or load from file
    const executorKeypair = Keypair.fromSecretKey(
      new Uint8Array(executorSecret)
    );

    console.log("Executor pubkey:", executorKeypair.publicKey.toBase58());

    const existingAccount = await provider.connection.getAccountInfo(
      managerPda
    );

    if (!existingAccount) {
      console.log("Manager not initialized. Initializing...");
      await program.methods
        .initialize(-10, 10, executorKeypair.publicKey)
        .accounts({
          manager: managerPda,
          authority: executorKeypair.publicKey,
          pool,
          tokenMintA: mintA,
          tokenMintB: mintB,
          tokenVaultA,
          tokenVaultB,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([executorKeypair])
        .rpc();
    } else {
      console.log("Skipped initialization (already exists)");
    }
  });

  it("opens a CLMM position then rebalances", async () => {
    console.log("initSDK starting");
    const raydium = await initSdk(provider.connection, provider.wallet, {
      loadToken: true,
    });
    console.log("init finished");

    console.log("provider wallet:", provider.wallet.publicKey.toBase58());
    //console.log("Cluster:", raydium.cluster);

    const data = await raydium.clmm.getPoolInfoFromRpc(pool.toBase58());
    const poolInfo = data.poolInfo;
    const poolKeys = data.poolKeys;
    const clmmPoolInfo = data.computePoolInfo;
    const tickCache = data.tickData;
    const poolState = pool;

    console.log("tickSpacing:", poolInfo.config.tickSpacing);

    console.log("Mint A, amount in decimals:", poolInfo.mintA.decimals);
    console.log("get poolinfo Worked");
    const inputAmountUi = 0.01;
    const inputAmountA = new anchor.BN(
      new Decimal(inputAmountUi).mul(10 ** poolInfo.mintA.decimals).toFixed(0)
    );

    const inputAmountUiB = 0.02;
    const inputAmountB = new anchor.BN(
      new Decimal(inputAmountUiB).mul(10 ** poolInfo.mintB.decimals).toFixed(0)
    );
    // Too much input then makes it difficult to rebalance because there is no liquidity
    const startingCurrentTick = clmmPoolInfo.tickCurrent;
    const startingTickSpacing = poolInfo.config.tickSpacing;
    const currentArrayStartTick = Math.floor(startingCurrentTick / 64) * 64;

    const currentTick = await raydium.clmm.getPoolInfoFromRpc(pool.toBase58());
    console.log("Current Tick:", currentTick.computePoolInfo.tickCurrent);

    // Need to change to trigger open position that is inside the current tick range

    const tickLower = -1100; //currentArrayStartTick + startingTickSpacing * 2
    const tickUpper = 400; //currentArrayStartTick + startingTickSpacing * 5

    console.log("tick lower and tick upper:", tickLower, tickUpper);

    const epochInfo = await raydium.fetchEpochInfo();

    console.log("inputAmountA:", inputAmountA.toString());
    console.log("inputAmountB:", inputAmountB.toString());

    const resA = await PoolUtils.getLiquidityAmountOutFromAmountIn({
      poolInfo,
      slippage: 0.005,
      inputA: true,
      tickUpper,
      tickLower,
      amount: inputAmountA,
      add: true,
      amountHasFee: true,
      epochInfo,
    });

    const resB = await PoolUtils.getLiquidityAmountOutFromAmountIn({
      poolInfo,
      slippage: 0.005,
      inputA: false,
      tickUpper,
      tickLower,
      amount: inputAmountB,
      add: true,
      amountHasFee: true,
      epochInfo,
    });

    console.log("resA liquidity", resA.liquidity.toString());
    console.log("resB liquidity", resB.liquidity.toString());

    const chosen = resA.liquidity.lt(resB.liquidity) ? resA : resB;

    console.log(
      "chosen amounts:",
      chosen.amountA.amount.toString(),
      chosen.amountB.amount.toString()
    );

    console.log("Got liquidity:", chosen.liquidity);

    const TICKS_PER_ARRAY = 64;
    const testNumArraysOnEachSide = 10;

    const testCurrentTick = await raydium.clmm.getPoolInfoFromRpc(
      pool.toBase58()
    );

    const testCurrentTickIndex = testCurrentTick.computePoolInfo.tickCurrent;
    const testCurrentStartTick = tickArrayStartTick(
      testCurrentTickIndex,
      TICKS_PER_ARRAY
    );

    const testDesiredStarts = [];

    for (let i = -testNumArraysOnEachSide; i <= testNumArraysOnEachSide; i++) {
      testDesiredStarts.push(testCurrentStartTick + i * TICKS_PER_ARRAY);
    }

    const testTickArraysWithTicks = [];

    for (const startTick of testDesiredStarts) {
      const pda = deriveTickArrayPDA(
        poolInfo.programId,
        poolInfo.id,
        startTick,
        poolInfo.config.tickSpacing
      );

      const info = await provider.connection.getAccountInfo(pda);
      if (info) {
        testTickArraysWithTicks.push({
          startTick,
          pda,
        });
        console.log(
          `Tick array exists for start tick ${startTick}: ${pda.toBase58()}`
        );
      }
    }

    console.log("TickArray Current:", clmmPoolInfo.tickCurrent);

    const {
      execute,
      extInfo: { address },
    } = await raydium.clmm.openPositionFromLiquidity({
      poolInfo,
      poolKeys,
      tickUpper,
      tickLower,
      liquidity: chosen.liquidity,
      amountMaxA: chosen.amountA.amount,
      amountMaxB: chosen.amountB.amount, //res.amountSlippageB.amount,
      ownerInfo: { useSOLBalance: true },
      txVersion,
      nft2022: true,
      // optional: set up priority fee here
      computeBudgetConfig: {
        units: 600000,
        microLamports: 10000,
      },
    });

    const tx = await execute({ sendAndConfirm: true });
    console.log("Position opened", tx);

    // Debug the actual position data
    /*  const positionData = await provider.connection.getAccountInfo(
      address.personalPosition
    );

    const position = PositionInfoLayout.decode(positionData.data);

    const { amountA, amountB } = PositionUtils.getAmountsFromLiquidity({
      poolInfo,
      ownerPosition: position,
      liquidity: position.liquidity,
      slippage: 0,
      add: true,
      epochInfo,
    });

    console.log(
      "Position token amounts:",
      amountA.amount.toString(),
      amountB.amount.toString()
    );
*/

    // === Derive the correct ATA manually ===
    const nftMint = address.nftMint;
    const nftOwner = provider.wallet.publicKey;

    console.log("NFT Mint:", nftMint.toBase58());
    console.log("NFT Owner:", nftOwner.toBase58());

    const derivedNftAta = getAssociatedTokenAddressSync(
      nftMint,
      nftOwner,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    console.log("Derived NFT ATA:", derivedNftAta.toBase58());

    // Use only derived ATA from here on
    positionNftMint = nftMint;
    positionNftAccount = derivedNftAta;

    // 1. Check if the account exists and is initialized
    const nftAccountInfo = await provider.connection.getAccountInfo(
      positionNftAccount
    );
    if (!nftAccountInfo) {
      throw new Error("NFT ATA does not exist");
    }

    // 2. Check initialization state safely
    let needsInitialization = true;
    try {
      const tokenAccount = await getAccount(
        provider.connection,
        positionNftAccount,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      needsInitialization = false;
      console.log(" NFT ATA already initialized");
    } catch (error) {
      if (
        error instanceof TokenAccountNotFoundError ||
        error instanceof TokenInvalidAccountOwnerError
      ) {
        console.log("NFT ATA requires initialization");
      } else {
        throw error;
      }
    }

    // 3. Initialize if needed
    if (needsInitialization) {
      console.log("Initializing NFT ATA...");
      const initIx = createInitializeAccount3Instruction(
        positionNftAccount,
        positionNftMint,
        nftOwner,
        TOKEN_2022_PROGRAM_ID
      );

      await provider.sendAndConfirm(new Transaction().add(initIx));
      console.log("NFT ATA initialized successfully");
    }

    // 4. Final verification
    const tokenBalance = await provider.connection.getTokenAccountBalance(
      positionNftAccount
    );
    if (tokenBalance.value.amount !== "1") {
      throw new Error(
        `NFT ATA has incorrect balance: ${tokenBalance.value.amount}`
      );
    }

    console.log("=== Addresses from openPosition ===");
    console.log("nftMint:", address.nftMint.toBase58());
    console.log("Derived NFT ATA:", derivedNftAta.toBase58());
    console.log("NFT Balance:", tokenBalance.value.amount);
    console.log("personalPosition:", address.personalPosition.toBase58());
    console.log("protocolPosition:", address.protocolPosition.toBase58());

    // Simulate Swap for Rebalance
    positionTokenAccount = await getAssociatedTokenAddress(
      positionNftMint,
      provider.wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const mintInfo = await provider.connection.getAccountInfo(positionNftMint);
    console.log("Mint account owner:", mintInfo?.owner?.toBase58());
    await createAssociatedTokenAccountIdempotent(
      provider.connection,
      provider.wallet.payer,
      positionNftMint,
      provider.wallet.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    console.log("This is the position tokenAccount: ", positionTokenAccount);

    [personalPosition] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), positionNftMint.toBuffer()],
      RAYDIUM_CLMM_PROGRAM_ID
    );

    const personalInfo = await provider.connection.getAccountInfo(
      personalPosition
    );
    //console.log("Personal position account info:", personalInfo);
    protocolPosition = address.protocolPosition;

    const protocolInfo = await provider.connection.getAccountInfo(
      protocolPosition
    );

    // console.log("Protocol position account info:", protocolInfo);

    console.log("Obtained PDAs");

    const actualTick = await raydium.clmm.getPoolInfoFromRpc(pool.toBase58());

    const tickSpacing = poolInfo.config.tickSpacing;
    const [tickArrayLower, tickArrayUpper, tickArrayCurrent] = [
      TickUtils.getTickArrayAddressByTick(
        new PublicKey(poolInfo.programId),
        new PublicKey(poolInfo.id),
        tickLower,
        tickSpacing
      ),
      TickUtils.getTickArrayAddressByTick(
        new PublicKey(poolInfo.programId),
        new PublicKey(poolInfo.id),
        tickUpper,
        tickSpacing
      ),
      TickUtils.getTickArrayAddressByTick(
        new PublicKey(poolInfo.programId),
        new PublicKey(poolInfo.id),
        actualTick.computePoolInfo.tickCurrent,
        tickSpacing
      ),
    ];

    const tickLowerInfo = await provider.connection.getAccountInfo(
      tickArrayLower
    );
    const tickUpperInfo = await provider.connection.getAccountInfo(
      tickArrayUpper
    );

    const currentTickIndex = actualTick.computePoolInfo.tickCurrent;
    const currentStartTick = tickArrayStartTick(
      currentTickIndex,
      TICKS_PER_ARRAY
    );

    const numArraysOnEachSide = 10;

    const desiredStarts = [];
    for (let i = -numArraysOnEachSide; i <= numArraysOnEachSide; i++) {
      desiredStarts.push(currentStartTick + i * TICKS_PER_ARRAY);
    }

    const seen = new Set<string>();
    const uniqueTickArrays = [];

    for (const startTick of desiredStarts) {
      const pda = deriveTickArrayPDA(
        poolInfo.programId,
        poolInfo.id,
        startTick,
        tickSpacing
      );

      const info = await provider.connection.getAccountInfo(pda);
      if (info && !seen.has(pda.toBase58())) {
        seen.add(pda.toBase58());
        uniqueTickArrays.push({
          startTick,
          pda,
        });
      }
    }

    const sortedTickArrayPDAs = uniqueTickArrays
      .sort((a, b) => a.startTick - b.startTick)
      .map((item) => item.pda);

    console.log(
      "Final tick arrays for swap:",
      sortedTickArrayPDAs.map((x) => x.toBase58())
    );

    console.log("Tick array lower on chain?", !!tickLowerInfo);
    console.log("Tick array upper on chain?", !!tickUpperInfo);
    console.log("Executing pre-rebalance CLMM swap to shift price...");
    console.log("Tick before swap:", clmmPoolInfo.tickCurrent);

    // This swap is to shift the price so that we can test the rebalance logic
    const swapInputAmount = new anchor.BN(4_000_000); // Adjust as needed to cause enough price movement

    const baseIn = true;
    const { minAmountOut, remainingAccounts } =
      await PoolUtils.computeAmountOutFormat({
        poolInfo: clmmPoolInfo,
        tickArrayCache: tickCache[poolKeys.id],
        amountIn: swapInputAmount,
        tokenOut: poolInfo[baseIn ? "mintB" : "mintA"],
        slippage: 0.01,
        epochInfo: await raydium.fetchEpochInfo(),
      });

    const { execute: swapExecute } = await raydium.clmm.swap({
      poolInfo,
      poolKeys,
      inputMint: poolInfo[baseIn ? "mintA" : "mintB"].address,
      amountIn: swapInputAmount,
      amountOutMin: minAmountOut.amount.raw,
      observationId: clmmPoolInfo.observationId,
      ownerInfo: { useSOLBalance: true },
      remainingAccounts,
      txVersion,
    });

    await swapExecute({ sendAndConfirm: true });

    console.log("Price shifted via CLMM swap.");

    const poolInfoAfterSwap = await raydium.clmm.getPoolInfoFromRpc(
      pool.toBase58()
    );
    const newCurrentTickIndex = poolInfoAfterSwap.computePoolInfo.tickCurrent;

    console.log("Tick after swap:", newCurrentTickIndex);

    const rebalanceNeeded =
      newCurrentTickIndex < tickLower || newCurrentTickIndex > tickUpper;

    if (!rebalanceNeeded) {
      console.log("No rebalance needed. Done.");
      return;
    }

    // Comment the lower code to test the Monitor Bot
    /*
    const poolVault0 = new PublicKey(poolKeys.vault.A);
    const poolVault1 = new PublicKey(poolKeys.vault.B);

    const startingUserTokenAccountA = await getAssociatedTokenAddress(
      mintA,
      provider.wallet.publicKey
    );

    const startingUserTokenAccountB = await getAssociatedTokenAddress(
      mintB,
      provider.wallet.publicKey
    );

    const startingBalA = await provider.connection.getTokenAccountBalance(
      startingUserTokenAccountA
    );
    // console.log("Wallet token A balance:", startingBalA.value.uiAmount);

    const startingBalB = await provider.connection.getTokenAccountBalance(
      startingUserTokenAccountB
    );

    // We Fetch the current positions amount.
    const pos = await raydium.connection.getAccountInfo(personalPosition);
    if (!pos) {
      throw new Error(
        `Protocol position account does not exist at ${personalPosition.toBase58()}`
      );
    }

    const newPosition = PositionInfoLayout.decode(pos.data);

    const { amountA, amountB } = PositionUtils.getAmountsFromLiquidity({
      poolInfo,
      ownerPosition: newPosition,
      liquidity: newPosition.liquidity,
      slippage: 0,
      add: false,
      epochInfo,
    });

    console.log("Got amountA and B");

    // Convert amounts to UI decimals
    const pooledAmountA = amountA.amount;
    const pooledAmountB = amountB.amount;

    console.log("Position token amounts:");
    console.log(
      `Token A (${poolInfo.mintA.symbol}):`,
      pooledAmountA.toString()
    );
    console.log(
      `Token B (${poolInfo.mintB.symbol}):`,
      pooledAmountB.toString()
    );

    // First remove liquidity:
    const removeLiquidityTx = await program.methods
      .removeLiquidity()
      .accounts({
        manager: managerPda,
        executor: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        memoProgram: new PublicKey(
          "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        ),
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        nftOwner: provider.wallet.publicKey,
        poolState,
        protocolPosition,
        personalPosition,
        nftAccount: positionTokenAccount,
        tickArrayLower,
        tickArrayUpper,
        tokenAccount0: startingUserTokenAccountA, //tokenVaultA,  // this is actually the vault of the wallet not the pda
        tokenAccount1: startingUserTokenAccountB, //tokenVaultB,  // same
        tokenVault0: poolVault0,
        tokenVault1: poolVault1,
        vault0Mint: mintA,
        vault1Mint: mintB,
        raydiumProgram: RAYDIUM_CLMM_PROGRAM_ID,
      })
      .rpc({ skipPreflight: true });

    console.log("Remove liquidity tx:", removeLiquidityTx);

    // Then we close the position
    console.log("position.liquidity:", newPosition.liquidity.toString());

    const { execute: executeSecond } = await raydium.clmm.closePosition({
      poolInfo,
      poolKeys,
      ownerPosition: newPosition,
      txVersion,
    });

    const { txId } = await executeSecond({ sendAndConfirm: true });
    console.log("Position closed:", txId);
    console.log("Ready to Rebalance");

    // Then we swap if needed.
    // Fetch balance of your wallet's token A account
    const userTokenAccountA = await getAssociatedTokenAddress(
      mintA,
      provider.wallet.publicKey
    );

    const userTokenAccountB = await getAssociatedTokenAddress(
      mintB,
      provider.wallet.publicKey
    );

    const balA = await provider.connection.getTokenAccountBalance(
      userTokenAccountA
    );
    console.log("Wallet token A balance:", balA.value.uiAmount);

    const balB = await provider.connection.getTokenAccountBalance(
      userTokenAccountB
    );
    console.log("Wallet token B balance:", balB.value.uiAmount);

    const vaultBalanceA = await provider.connection.getTokenAccountBalance(
      tokenVaultA
    );

    console.log(TOKEN_2022_PROGRAM_ID.toBase58());

    const accounts = {
      payer: provider.wallet.publicKey,
      ammConfig: clmmPoolInfo.ammConfig.id,
      poolState: pool,
      inputTokenAccount: userTokenAccountA, // tokenVaultA,
      outputTokenAccount: userTokenAccountB, // tokenVaultB,
      inputVault: poolVault0,
      outputVault: poolVault1,
      observationState: clmmPoolInfo.observationId,
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      memoProgram: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      inputVaultMint: mintA,
      outputVaultMint: mintB,
      raydiumProgram: RAYDIUM_CLMM_PROGRAM_ID,
    };
    console.log(
      "ammConfig:",
      accounts.ammConfig?.toBase58?.() || accounts.ammConfig
    );

    // Check each account individually
    console.log("Checking each swap account:");
    for (const [key, value] of Object.entries(accounts)) {
      if (!value) {
        console.error(`${key} is undefined or null!`);
      } else {
        try {
          console.log(`${key}: ${value.toBase58()}`);
        } catch (e) {
          console.log(`${key}:`, value);
        }
      }
    }

    const seen = new Set<string>();
    const tickArraysWithTicks = [];

    for (const startTick of desiredStarts) {
      const pda = deriveTickArrayPDA(
        poolInfo.programId,
        poolInfo.id,
        startTick,
        tickSpacing
      );
      const info = await provider.connection.getAccountInfo(pda);
      if (info && !seen.has(pda.toBase58())) {
        seen.add(pda.toBase58());
        tickArraysWithTicks.push({ pda, startTick });
        console.log(
          `Unique tick array found for start tick ${startTick}: ${pda.toBase58()}`
        );
      }
    }

    const sortedTickArrayPDAs = tickArraysWithTicks
      .sort((a, b) => a.startTick - b.startTick)
      .map((item) => item.pda);

    console.log(
      "Final tick arrays for swap:",
      sortedTickArrayPDAs.map((x) => x.toBase58())
    );

    let newBaseIn: boolean;
    // let swapTokenIn: string;
    // let swapTokenOut: string;

    if (currentTickIndex > tickUpper) {
      newBaseIn = true;
      // swapTokenIn = poolInfo.mintA.address;
      // swapTokenOut = poolInfo.mintB.address;
    } else {
      newBaseIn = false;
      // swapTokenIn = poolInfo.mintB.address;
      // swapTokenOut = poolInfo.mintA.address;
    }

    console.log("new base in is: ", newBaseIn);
    // Just for test:
    newBaseIn = true;
    const amountInRaw = newBaseIn ? pooledAmountA : pooledAmountB;

    const tickArrayBitmapExtensionAccount = new PublicKey(
      poolKeys.exBitmapAccount
    );
    console.log(
      "tickArrayBitmapExtensionAccount:",
      tickArrayBitmapExtensionAccount.toBase58()
    );

    const modifyComputeUnitsIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 800_000,
    });

    const modifyComputePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 10_000,
    });

    const swapTx = await program.methods
      .swap(amountInRaw)
      .accounts({
        payer: provider.wallet.publicKey,
        ammConfig: clmmPoolInfo.ammConfig.id,
        poolState: pool,
        inputTokenAccount: newBaseIn ? userTokenAccountA : userTokenAccountB,
        outputTokenAccount: newBaseIn ? userTokenAccountB : userTokenAccountA,
        inputVault: poolVault0,
        outputVault: poolVault1,
        observationState: clmmPoolInfo.observationId,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        memoProgram: new PublicKey(
          "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        ),
        inputVaultMint: mintA,
        outputVaultMint: mintB,
        raydiumProgram: RAYDIUM_CLMM_PROGRAM_ID,
      })
      .remainingAccounts([
        {
          pubkey: tickArrayBitmapExtensionAccount,
          isWritable: false,
          isSigner: false,
        },
        ...sortedTickArrayPDAs.map((pda) => ({
          pubkey: pda,
          isWritable: true,
          isSigner: false,
        })),
      ])
      .preInstructions([modifyComputeUnitsIx, modifyComputePriceIx])
      .rpc({ skipPreflight: true });

    console.log("Swap tx:", swapTx);

    // Gotta open a new Position after the Swap:
    const newUserTokenAccountA = await getAssociatedTokenAddress(
      mintA,
      provider.wallet.publicKey
    );

    const newUserTokenAccountB = await getAssociatedTokenAddress(
      mintB,
      provider.wallet.publicKey
    );

    const newStartingBalA = await provider.connection.getTokenAccountBalance(
      newUserTokenAccountA
    );

    const newStartingBalB = await provider.connection.getTokenAccountBalance(
      newUserTokenAccountB
    );

    const fraction = new Decimal(0.01); // use 1% of balance just for test

    const newInputAmountA = new anchor.BN(
      new Decimal(newStartingBalA.value.amount).mul(fraction).floor().toString()
    );

    const newInputAmountB = new anchor.BN(
      new Decimal(newStartingBalB.value.amount).mul(fraction).floor().toString()
    );

    console.log("New inputAmountA:", inputAmountA.toString());
    console.log("New inputAmountB:", inputAmountB.toString());

    const newLowerTick = -1100;
    const newUpperTick = 850;

    const freshData = await raydium.clmm.getPoolInfoFromRpc(pool.toBase58());
    const freshPoolInfo = freshData.poolInfo;
    const freshPoolKeys = freshData.poolKeys;

    const newRes = await PoolUtils.getLiquidityAmountOutFromAmountIn({
      poolInfo: freshPoolInfo,
      slippage: 0.005,
      inputA: true,
      tickUpper: newUpperTick,
      tickLower: newLowerTick,
      amount: inputAmountA,
      add: true,
      amountHasFee: true,
      epochInfo,
    });

    const {
      execute: executeThird,
      extInfo: { address: newAddress },
    } = await raydium.clmm.openPositionFromLiquidity({
      poolInfo: freshPoolInfo,
      poolKeys: freshPoolKeys,
      tickUpper: newUpperTick,
      tickLower: newLowerTick,
      liquidity: newRes.liquidity,
      amountMaxA: inputAmountA,
      amountMaxB: inputAmountB,
      ownerInfo: { useSOLBalance: true },
      txVersion,
      nft2022: true,
      computeBudgetConfig: {
        units: 600_000,
        microLamports: 10_000,
      },
    });

    await executeThird({ sendAndConfirm: true });

    const newNftMint = newAddress.nftMint;
    const newProtocolPosition = newAddress.protocolPosition;
    const newPersonalPosition = newAddress.personalPosition;

    console.log("New position NFT mint:", newNftMint.toBase58());
    console.log("Protocol PDA:", newProtocolPosition.toBase58());
    console.log("Personal PDA:", newPersonalPosition.toBase58());

    await program.methods
      .storeNewPosition(newNftMint, newLowerTick, newUpperTick)
      .accounts({
        manager: managerPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();
    */
  });
});

/*  Not needed yet
    // Adding Liquidity
    const addLiquidityTx = await program.methods
      .addLiquidity()
      .accounts({
        manager: managerPda,
        executor: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        memoProgram: new PublicKey(
          "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        ),
        nftOwner: provider.wallet.publicKey,
        poolState,
        protocolPosition: newProtocolPosition,
        personalPosition: newPersonalPosition,
        nftAccount: newNftMint,
        tickArrayLower,
        tickArrayUpper,
        tokenAccount0: tokenVaultA,
        tokenAccount1: tokenVaultB,
        tokenVault0: poolVault0,
        tokenVault1: poolVault1,
        vault0Mint: mintA,
        vault1Mint: mintB,
        raydiumProgram: RAYDIUM_CLMM_PROGRAM_ID,
      })
      .rpc({ skipPreflight: true });

    console.log("Add liquidity tx:", addLiquidityTx);

    // Validate result
    const mgr = await program.account.liquidityManager.fetch(managerPda);
    assert(mgr.lowerTick < mgr.upperTick);*/

/*
    const fundVaultsTx = await program.methods
      .fundVaults(new anchor.BN(balA.value.amount), new anchor.BN(balB.value.amount))
      .accounts({
        vaultA: tokenVaultA,
        vaultB: tokenVaultB,
        payerTokenA: userTokenAccountA,
        payerTokenB: userTokenAccountB,
        mintA: mintA,
        mintB: mintB,
        payer: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Fund vaults tx:", fundVaultsTx); 

    const vaultBalA = await provider.connection.getTokenAccountBalance(
      tokenVaultA
    );
    const vaultBalB = await provider.connection.getTokenAccountBalance(
      tokenVaultB
    );

    console.log(
      "Vault A balance after funding:",
      vaultBalA.value.uiAmountString
    );
    console.log(
      "Vault B balance after funding:",
      vaultBalB.value.uiAmountString
    );*/
