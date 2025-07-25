import * as anchor from "@coral-xyz/anchor";
import {
  ApiV3PoolInfoConcentratedItem,
  //CLMM_PROGRAM_ID,
  ClmmKeys,
  ComputeClmmPoolInfo,
  getPdaProtocolPositionAddress,
  PoolUtils,
  PositionInfoLayout,
  PositionUtils,
  Raydium,
  TickUtils,
} from "@raydium-io/raydium-sdk-v2";
import {
  createAssociatedTokenAccount,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import dotenv from "dotenv";
import { initSdk, txVersion } from "./config";
import idl from "./idl/liquidity_manager.json";
import type { LiquidityManager } from "./types/liquidity_manager";

dotenv.config();

// CONFIG VALUES
const url = process.env.ANCHOR_PROVIDER_URL!;

let currentNftMint: PublicKey | null = null;
let currentNftAccount: PublicKey | null = null;

// Load the private key from env
const keypairArray = JSON.parse(process.env.KEY_PAIR_JSON!);
const keypair = Keypair.fromSecretKey(new Uint8Array(keypairArray));

const wallet = new anchor.Wallet(keypair);

const poolId = new PublicKey(process.env.POOL_ID!);
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey(
  "devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH"
);

// How often to run the bot loop (ms)
const LOOP_INTERVAL_MS = 600000;

async function main() {
  const connection = new Connection(url, "confirmed");

  const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
  });

  anchor.setProvider(provider);

  const raydium = await initSdk(connection, wallet, {
    loadToken: true,
  });

  const program = new anchor.Program<LiquidityManager>(
    idl as anchor.Idl,
    provider
  );

  const data = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
  const poolInfo = data.poolInfo;
  const poolKeys = data.poolKeys;
  const clmmPoolInfo = data.computePoolInfo;

  // Load vaults
  const mintA = new PublicKey(poolInfo.mintA.address);
  const mintB = new PublicKey(poolInfo.mintB.address);

  const [managerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("manager-v6"), poolId.toBuffer()],
    program.programId
  );

  console.log("Loaded manager PDA:", managerPda.toBase58());

  while (true) {
    try {
      console.log("\n=== BOT LOOP START ===");

      await runBot({
        provider,
        raydium,
        program,
        poolInfo,
        poolKeys,
        clmmPoolInfo,
        managerPda,
        mintA,
        mintB,
      });
    } catch (e) {
      console.error("Error in bot loop:", e);
    }

    console.log(`Sleeping for ${LOOP_INTERVAL_MS / 1000} seconds...`);
    await new Promise((r) => setTimeout(r, LOOP_INTERVAL_MS));
  }
}

async function ensureAtaExists(
  mint: PublicKey,
  owner: PublicKey,
  connection: Connection
) {
  const ata = await getAssociatedTokenAddress(mint, owner);
  try {
    await getAccount(connection, ata); // Check if ATA exists
    console.log(`ATA for ${mint.toBase58()} already exists: ${ata.toBase58()}`);
  } catch {
    console.log(`Creating ATA for ${mint.toBase58()}`);
    await createAssociatedTokenAccount(connection, wallet.payer, mint, owner);
  }
  return ata;
}

async function runBot({
  provider,
  raydium,
  program,
  poolInfo,
  poolKeys,
  clmmPoolInfo,
  managerPda,
  mintA,
  mintB,
}: {
  provider: anchor.AnchorProvider;
  raydium: Raydium;
  program: anchor.Program<LiquidityManager>;
  poolInfo: ApiV3PoolInfoConcentratedItem;
  poolKeys: ClmmKeys;
  clmmPoolInfo: ComputeClmmPoolInfo;
  managerPda: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
}) {
  // Retrieve your stored position NFT mint from DB, env, or file
  const positionNftMintAccount =
    currentNftAccount ?? new PublicKey(process.env.POSITION_NFT_ACCOUNT!);
  if (!positionNftMintAccount) {
    throw new Error("Position NFT account not found in environment variables");
  }

  const nftMint =
    currentNftMint ?? new PublicKey(process.env.POSITION_NFT_MINT!);
  if (!nftMint) {
    throw new Error("NFT mint not found in environment variables");
  }
  const nftOwnerSecret = JSON.parse(process.env.NFT_OWNER_KEY_PAIR_JSON!);
  const nftOwnerKeypair = Keypair.fromSecretKey(new Uint8Array(nftOwnerSecret));
  const nftOwner = nftOwnerKeypair.publicKey;

  console.log(
    "Current position NFT mint account:",
    positionNftMintAccount.toBase58()
  );

  // Get the position address (PDA)
  const [personalPositionAddr] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), nftMint.toBuffer()],
    RAYDIUM_CLMM_PROGRAM_ID
  );

  // Derive the NFT token account that Raydium will expect
  const positionNftAta = getAssociatedTokenAddressSync(
    nftMint,
    nftOwner,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log("personalPositionAddr:", personalPositionAddr.toBase58());
  console.log("NFT Mint:", nftMint.toBase58());
  console.log("NFT Owner:", nftOwner.toBase58());
  console.log("Derived NFT ATA:", positionNftAta.toBase58());

  // Verify and initialize the NFT account if needed
  const nftAtaInfo = await provider.connection.getAccountInfo(positionNftAta);
  if (!nftAtaInfo || nftAtaInfo.data[0] !== 1) {
    if (!nftAtaInfo) {
      console.log(
        `NFT ATA not found. Creating at: ${positionNftAta.toBase58()}`
      );
    } else {
      console.log(
        `NFT ATA exists but uninitialized. Reinitializing: ${positionNftAta.toBase58()}`
      );
    }

    const ix = createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      positionNftAta,
      nftOwner,
      nftMint,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new anchor.web3.Transaction().add(ix);
    const sig = await provider.sendAndConfirm(tx, []);
    console.log("NFT ATA initialized with tx:", sig);
  } else {
    console.log(`NFT ATA already initialized at: ${positionNftAta.toBase58()}`);

    // Verify the NFT is actually in this account
    const tokenBalance = await provider.connection.getTokenAccountBalance(
      positionNftAta
    );
    if (tokenBalance.value.amount !== "1") {
      console.log("NFT not found in expected ATA, searching for it...");

      // Alternative method to find where the NFT is
      const tokenAccounts = await provider.connection.getTokenAccountsByOwner(
        nftOwner,
        {
          mint: nftMint,
          programId: TOKEN_2022_PROGRAM_ID,
        }
      );

      if (tokenAccounts.value.length > 0) {
        const actualNftAta = tokenAccounts.value[0].pubkey;
        console.log(`Found NFT in different ATA: ${actualNftAta.toBase58()}`);

        // Transfer to the correct ATA
        const transferIx = createTransferInstruction(
          actualNftAta,
          positionNftAta,
          nftOwner,
          1,
          [],
          TOKEN_2022_PROGRAM_ID
        );

        const transferTx = new anchor.web3.Transaction().add(transferIx);
        await provider.sendAndConfirm(transferTx, [nftOwnerKeypair]);
        console.log("NFT transferred to correct ATA");
      } else {
        throw new Error("NFT not found in any token account");
      }
    }
  }

  // Fetch position data
  const pos = await provider.connection.getAccountInfo(personalPositionAddr);
  if (!pos) {
    console.log("No position found. Skipping rebalance check.");
    return;
  }

  const position = PositionInfoLayout.decode(pos.data);
  console.log("Position data:", position);

  const tickLower = position.tickLower;
  const tickUpper = position.tickUpper;

  console.log("Position range:", tickLower, "-", tickUpper);

  const epochInfo = await raydium.fetchEpochInfo();
  //console.log("epochInfo:", epochInfo);

  const { amountA, amountB } = PositionUtils.getAmountsFromLiquidity({
    poolInfo,
    ownerPosition: position,
    liquidity: position.liquidity,
    slippage: 0,
    add: true,
    epochInfo,
  });

  console.log(
    "amountA and amountB before removing liquidity",
    amountA.amount,
    amountB.amount
  );

  const protocolPositionAddr = getPdaProtocolPositionAddress(
    //CLMM_PROGRAM_ID,
    RAYDIUM_CLMM_PROGRAM_ID,
    poolId,
    tickLower,
    tickUpper
  ).publicKey;

  const prot = await provider.connection.getAccountInfo(protocolPositionAddr);
  if (!prot) {
    console.log("No position found. Skipping rebalance check.");
    return;
  }
  // Fetch current tick
  const poolState = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
  const currentTick = poolState.computePoolInfo.tickCurrent;

  console.log("Current tick:", currentTick);

  const rebalanceNeeded = currentTick < tickLower || currentTick > tickUpper;

  if (!rebalanceNeeded) {
    console.log("No rebalance needed.");
    return;
  }

  console.log("Rebalance needed!");

  const poolVault0 = new PublicKey(poolKeys.vault.A);
  const poolVault1 = new PublicKey(poolKeys.vault.B);

  // Find tick arrays
  const tickSpacing = poolInfo.config.tickSpacing;
  const [tickArrayLower, tickArrayUpper] = [
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
  ];

  const startingUserTokenAccountA = await ensureAtaExists(
    mintA,
    provider.wallet.publicKey,
    provider.connection
  );

  const startingUserTokenAccountB = await ensureAtaExists(
    mintB,
    provider.wallet.publicKey,
    provider.connection
  );

  console.log(
    "provieder.wallet.publicKey:",
    provider.wallet.publicKey.toBase58()
  );
  console.log("NFT Mint:", nftMint.toBase58());
  console.log("NFT Owner:", nftOwner.toBase58());
  console.log("Derived NFT ATA:", positionNftAta.toBase58());
  console.log("Personal Position PDA:", personalPositionAddr.toBase58());
  console.log("Protocol Position PDA:", protocolPositionAddr.toBase58());

  // 1. Remove liquidity
  const removeLiquidityTx = await program.methods
    .removeLiquidity()
    .accounts({
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      memoProgram: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      manager: managerPda,
      executor: provider.wallet.publicKey,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      nftOwner: nftOwner, //provider.wallet.publicKey,
      poolState: poolId,
      protocolPosition: protocolPositionAddr,
      personalPosition: personalPositionAddr,
      nftAccount: positionNftMintAccount, //positionNftAta, // positionNftMintAccount,
      tickArrayLower,
      tickArrayUpper,
      tokenAccount0: startingUserTokenAccountA,
      tokenAccount1: startingUserTokenAccountB,
      tokenVault0: poolVault0,
      tokenVault1: poolVault1,
      vault0Mint: mintA,
      vault1Mint: mintB,
      raydiumProgram: RAYDIUM_CLMM_PROGRAM_ID,
    } as any)
    .signers([nftOwnerKeypair /*, wallet.payer*/]) // Sign with the NFT owner keypair
    .transaction();
  // .rpc({ skipPreflight: true });

  await provider.sendAndConfirm(removeLiquidityTx, [nftOwnerKeypair]);

  console.log("Remove liquidity tx:", removeLiquidityTx);
  console.log("Removed liquidity correctly!");

  // 2. Close position
  const ata = new PublicKey(process.env.POSITION_NFT_ACCOUNT!);
  const accountInfo = await raydium.connection.getAccountInfo(ata);
  console.log("ATA Account Info:", accountInfo);

  const newPos = await provider.connection.getAccountInfo(personalPositionAddr);
  if (!newPos) {
    console.log("No position found. Skipping rebalance check.");
    return;
  }

  const posit = PositionInfoLayout.decode(newPos.data);
  if (!posit.liquidity.isZero()) {
    throw new Error("Position still has liquidity, cannot close");
  }

  //console.log("position.liquidity:", posit.liquidity.toString());
  //console.log("poolInfo:", poolInfo);
  //console.log("poolKeys:", poolKeys);

  const { execute: closeExecute } = await raydium.clmm.closePosition({
    poolInfo,
    poolKeys,
    ownerPosition: posit,
    txVersion,
  });

  console.log("Executing closePosition...");

  const { txId: closeTxId } = await closeExecute({
    sendAndConfirm: true,
  });

  console.log("Position closed:", closeTxId);

  // 3. Check wallet balances
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
  const balB = await provider.connection.getTokenAccountBalance(
    userTokenAccountB
  );

  // console.log("Wallet token A balance:", balA.value.uiAmount);
  // console.log("Wallet token B balance:", balB.value.uiAmount);

  // 4. Optionally swap tokens
  // Determine swap direction
  let newBaseIn: boolean;
  if (currentTick > tickUpper) {
    newBaseIn = true; // A → B
    console.log("Need to swap token A into token B");
  } else {
    newBaseIn = false; // B → A
    console.log("Need to swap token B into token A");
  }

  console.log("Amount A:", amountA);
  console.log("Amount B:", amountB);

  const pooledAmountA = amountA.amount;
  const pooledAmountB = amountB.amount;

  console.log("Pooled Amount A:", pooledAmountA.toString());
  console.log("Pooled Amount B:", pooledAmountB.toString());

  const amountInRaw = pooledAmountA; //For test only //newBaseIn ? pooledAmountA : pooledAmountB;

  if (amountInRaw.isZero()) {
    console.log("Skip swap: no balance to swap.");
  } else {
    const tickSpacing = poolInfo.config.tickSpacing;

    // Find all tick arrays
    const numArraysOnEachSide = 10;
    const currentStartTick = Math.floor(currentTick / 64) * 64;

    const desiredStarts = [];
    for (let i = -numArraysOnEachSide; i <= numArraysOnEachSide; i++) {
      desiredStarts.push(currentStartTick + i * 64);
    }

    const tickArraysWithTicks = [];

    for (const startTick of desiredStarts) {
      const pda = TickUtils.getTickArrayAddressByTick(
        new PublicKey(poolInfo.programId),
        new PublicKey(poolInfo.id),
        startTick,
        tickSpacing
      );
      const info = await provider.connection.getAccountInfo(pda);
      if (info) {
        tickArraysWithTicks.push({
          pda,
          startTick,
        });
      }
    }

    const sortedTickArrayPDAs = tickArraysWithTicks
      .sort((a, b) => a.startTick - b.startTick)
      .map((item) => item.pda);

    console.log(
      "Final tick arrays for swap:",
      sortedTickArrayPDAs.map((x) => x.toBase58())
    );

    const tickArrayBitmapExtensionAccount = new PublicKey(
      poolKeys.exBitmapAccount
    );

    const data = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
    const tickCache = data.tickData;

    console.log(
      "Actual amount A and B from pool:",
      data.poolInfo.mintAmountA,
      data.poolInfo.mintAmountB
    );

    const modifyComputeUnitsIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 800_000,
    });

    const modifyComputePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 10_000,
    });

    const accounts = {
      payer: provider.wallet.publicKey,
      ammConfig: clmmPoolInfo.ammConfig.id,
      poolState: poolId,
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

    console.log("Ready to execute swap");

    // Execute swap via anchor program
    const swapTx = await program.methods
      .swap(
        amountInRaw /*amountInBn*/ /*new anchor.BN(amountInRaw.toString())*/
      )
      .accounts({
        payer: provider.wallet.publicKey,
        ammConfig: clmmPoolInfo.ammConfig.id,
        poolState: poolId,
        inputTokenAccount: userTokenAccountA, // ? userTokenAccountA : userTokenAccountB,
        outputTokenAccount: userTokenAccountB, //newBaseIn ? userTokenAccountB : userTokenAccountA,
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
      } as any)
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
      .transaction();
    // .rpc({ skipPreflight: true });

    console.log("Swap executed:", swapTx);

    const sig = await provider.sendAndConfirm(swapTx, []);
    console.log("Swap tx signature:", sig);
  }

  // 5. Open new position with a fraction of the balance, just for testing
  const fraction = new Decimal(0.01);
  const inputAmountA = new anchor.BN(
    new Decimal(balA.value.amount).mul(fraction).floor().toString()
  );
  const inputAmountB = new anchor.BN(
    new Decimal(balB.value.amount).mul(fraction).floor().toString()
  );

  console.log("New inputAmountA:", inputAmountA.toString());
  console.log("New inputAmountB:", inputAmountB.toString());

  const newLowerTick = tickLower - 250;
  const newUpperTick = tickUpper + 250;

  const newResA = await PoolUtils.getLiquidityAmountOutFromAmountIn({
    poolInfo,
    slippage: 0.005,
    inputA: true,
    tickUpper: newUpperTick,
    tickLower: newLowerTick,
    amount: inputAmountA,
    add: true,
    amountHasFee: true,
    epochInfo,
  });

  const newResB = await PoolUtils.getLiquidityAmountOutFromAmountIn({
    poolInfo,
    slippage: 0.005,
    inputA: false,
    tickUpper: newUpperTick,
    tickLower: newLowerTick,
    amount: inputAmountB,
    add: true,
    amountHasFee: true,
    epochInfo,
  });

  const chosen = newResA.liquidity.lt(newResB.liquidity) ? newResA : newResB;

  console.log(
    "chosen amounts:",
    chosen.amountA.amount.toString(),
    chosen.amountB.amount.toString()
  );

  const {
    execute: executeThird,
    extInfo: { address: newAddress },
  } = await raydium.clmm.openPositionFromLiquidity({
    poolInfo,
    poolKeys,
    tickUpper: newUpperTick,
    tickLower: newLowerTick,
    liquidity: chosen.liquidity,
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

  currentNftMint = newNftMint;
  currentNftAccount = getAssociatedTokenAddressSync(
    newNftMint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log("New position NFT mint:", newNftMint.toBase58());

  // Store new NFT mint
  await program.methods
    .storeNewPosition(newNftMint, newLowerTick, newUpperTick)
    .accounts({
      manager: managerPda,
      authority: provider.wallet.publicKey,
    })
    .rpc();

  console.log("Rebalance complete!");
}

main();
