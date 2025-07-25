import { Wallet } from "@coral-xyz/anchor";
import { DEVNET_PROGRAM_ID } from "@raydium-io/raydium-sdk-v2";
import { Keypair, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { connection, initSdk, txVersion } from "./config";
import { devConfigs } from "./utils";
dotenv.config();

const walletPath = process.env.ANCHOR_WALLET!;
const walletKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf-8")))
);
const wallet = new Wallet(walletKeypair);

export const createPool = async () => {
  try {
    const raydium = await initSdk(connection, wallet, { loadToken: true });

    const mint1 = await raydium.token.getTokenInfo(
      "CnyYF9m9qvzkRd2r6inbk2rJqZ96cUAvgSt9mgo2SRyG"
    );
    const mint2 = await raydium.token.getTokenInfo(
      "2PHq92eDkKEDRNZnzmXk7xWB1kmQJiyAhC986i6cvp1Y"
    );

    //const clmmConfigs = await raydium.api.getClmmConfigs();
    const clmmConfigs = devConfigs; // devnet configs

    const { execute, extInfo } = await raydium.clmm.createPool({
      //programId: CLMM_PROGRAM_ID,
      programId: DEVNET_PROGRAM_ID.CLMM,
      mint1,
      mint2,
      ammConfig: {
        ...clmmConfigs[0],
        id: new PublicKey(clmmConfigs[0].id),
        fundOwner: "",
        description: "",
      },
      initialPrice: new Decimal(1),
      txVersion,
      // optional: set up priority fee here
      // computeBudgetConfig: {
      //   units: 600000,
      //   microLamports: 46591500,
      // },
    });
    // don't want to wait confirm, set sendAndConfirm to false or don't pass any params to execute

    const { txId } = await execute({ sendAndConfirm: true });

    console.log("CLMM pool created:");
    console.log({
      txId: `https://explorer.solana.com/tx/${txId}?cluster=devnet`,
    });

    console.log("New pool address:", extInfo.address);

    /*
    console.log("clmm pool created:", {
    txId: `https://explorer.solana.com/tx/${txId}`,
  });*/
  } catch (error) {
    console.error("createAmmPool failed:", error);
  }
  process.exit(); // if you don't want to end up node execution, comment this line
};
createPool();
