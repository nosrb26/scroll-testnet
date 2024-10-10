const main = async () => {
  try {
    // 4. Display all liquidity sources on Scroll
    await getLiquiditySources();

    // Specify the amount of WETH to sell
    const decimals = (await weth.read.decimals()) as number;
    const sellAmount = parseUnits("0.1", decimals); // 0.1 WETH

    // 2. Add parameters for affiliate fees and surplus collection
    const affiliateFeeBps = "100"; // 1%
    const surplusCollection = "true";

    // 1. Fetch price with monetization parameters
    const priceParams = new URLSearchParams({
      chainId: client.chain.id.toString(),
      sellToken: weth.address,
      buyToken: wsteth.address,
      sellAmount: sellAmount.toString(),
      taker: client.account.address,
      affiliateFee: affiliateFeeBps, // Parameter for affiliate fees
      surplusCollection: surplusCollection, // Parameter for surplus collection
    });

    const priceResponse = await fetch(
      `https://api.0x.org/swap/permit2/price?${priceParams.toString()}`,
      {
        headers,
      }
    );

    if (!priceResponse.ok) {
      throw new Error(`Error fetching price: ${priceResponse.statusText}`);
    }

    const price = await priceResponse.json();
    console.log("Fetching price to swap 0.1 WETH for wstETH");
    console.log(`Request URL: https://api.0x.org/swap/permit2/price?${priceParams.toString()}`);
    console.log("Price Response:", price);

    // 2. Check if taker needs to set an allowance for Permit2
    if (price.issues && price.issues.allowance) {
      try {
        const { request } = await weth.simulate.approve([
          price.issues.allowance.spender,
          maxUint256,
        ]);
        console.log("Approving Permit2 to spend WETH...", request);
        // Set approval
        const hash = await weth.write.approve(request.args);
        console.log("Approved Permit2 to spend WETH.", await client.waitForTransactionReceipt({ hash }));
      } catch (error) {
        console.error("Error approving Permit2:", error);
        return; // Exit if approval fails
      }
    } else {
      console.log("WETH already approved for Permit2");
    }

    // 3. Fetch quote with monetization parameters
    const quoteParams = new URLSearchParams(priceParams.toString()); // Clone priceParams
    const quoteResponse = await fetch(
      `https://api.0x.org/swap/permit2/quote?${quoteParams.toString()}`,
      {
        headers,
      }
    );

    if (!quoteResponse.ok) {
      throw new Error(`Error fetching quote: ${quoteResponse.statusText}`);
    }

    const quote = await quoteResponse.json();
    console.log("Fetching quote to swap 0.1 WETH for wstETH");
    console.log("Quote Response:", quote);

    // 1. Display the percentage breakdown of liquidity sources
    if (quote.route) {
      displayLiquiditySources(quote.route);
    }

    // 3. Display the buy/sell taxes for tokens
    if (quote.tokenMetadata) {
      displayTokenTaxes(quote.tokenMetadata);
    }

    // 2. Display monetization information
    if (quote.affiliateFeeBps) {
      const affiliateFee = (parseInt(quote.affiliateFeeBps) / 100).toFixed(2);
      console.log(`Affiliate Fee: ${affiliateFee}%`);
    }

    if (quote.tradeSurplus && parseFloat(quote.tradeSurplus) > 0) {
      console.log(`Trade Surplus Collected: ${quote.tradeSurplus}`);
    }

    // 4. Sign permit2.eip712 returned from quote
    let signature: Hex | undefined;
    if (quote.permit2?.eip712) {
      try {
        signature = await client.signTypedData(quote.permit2.eip712);
        console.log("Signed permit2 message from quote response");
      } catch (error) {
        console.error("Error signing permit2 coupon:", error);
        return; // Exit if signing fails
      }

      // 5. Append signature length and signature data to transaction.data
      if (signature && quote.transaction?.data) {
        const signatureLengthInHex = numberToHex(size(signature), {
          signed: false,
          size: 32,
        });

        const transactionData = quote.transaction.data as Hex;
        const sigLengthHex = signatureLengthInHex as Hex;
        const sig = signature as Hex;

        quote.transaction.data = concat([transactionData, sigLengthHex, sig]);
      } else {
        throw new Error("Failed to obtain signature or transaction data");
      }
    }

    // 6. Submit transaction with permit2 signature
    if (signature && quote.transaction?.data) {
      const nonce = await client.getTransactionCount({
        address: client.account.address,
      });

      const signedTransaction = await client.signTransaction({
        account: client.account,
        chain: client.chain,
        gas: quote.transaction.gas ? BigInt(quote.transaction.gas) : undefined,
        to: quote.transaction.to,
        data: quote.transaction.data,
        value: quote.transaction.value ? BigInt(quote.transaction.value) : undefined, // value is used for native tokens
        gasPrice: quote.transaction.gasPrice ? BigInt(quote.transaction.gasPrice) : undefined,
        nonce: nonce,
      });

      const hash = await client.sendRawTransaction({
        serializedTransaction: signedTransaction,
      });

      console.log("Transaction hash:", hash);
      console.log(`See tx details at https://scrollscan.com/tx/${hash}`);
    } else {
      console.error("Failed to obtain a signature, transaction not sent.");
    }
  } catch (error) {
    console.error("An error occurred in the main function:", error);
  }
};

// Execute the main function
main();
