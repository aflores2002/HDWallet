export const signBtcTransaction = (transaction, privateKey) => {
        // Implement BTC transaction signing logic here
        console.log('Signing BTC transaction');
};

const transfer = async (
        privateKey,
        value,
        receiver,
        env,
        address,
        ecc,
) => {
        try {
                const createTxResponse = await createBTCTx(receiver, value, env, address);
                // console.log(createTxResponse, "createTxResponsecreateTxResponse");
                if (createTxResponse?.code != 1) return createTxResponse;
                const tx = createTxResponse.result.tx;
                const toSign = createTxResponse.result.tosign;
                // // console.log(tx, toSign);
                const generateSignaturesResponse = generateSignatures(privateKey, env, toSign, ecc);
                if (generateSignaturesResponse?.code != 1) return generateSignaturesResponse;
                const signatures = generateSignaturesResponse.signatures;
                const pubkeys = generateSignaturesResponse.pubkeys;
                // console.log("signature",signatures);
                // console.log(pubkeys);
                if (!signatures || !pubkeys) {
                        return {
                                code: 0,
                                error: ERROR_BTC_SIGNATURES,
                        };
                }
                return {
                        tx, toSign, signatures, pubkeys, env
                };
        } catch (error) {
                return {
                        code: 0,
                        error,
                };
        }
};

//This Function must be used in Client side.
const createBTCTx = async (toAddress, value, env, fromAddress) => {
        try {
                // const { toAddress, value, env, fromAddress } = data;
                const valueInSatoshi = value * 100000000;
                // console.log(valueInSatoshi);
                // console.log("Vivek bhai ",toAddress, value, env, fromAddress);
                if (!fromAddress || !toAddress || !value || !env) {
                        return {
                                code: 0,
                                message: "invalid/insufficient parameters"
                        }
                }
                let url;
                if (env == 'testnet') {
                        url = 'https://api.blockcypher.com/v1/btc/test3/txs/new'
                }
                else if (env == 'mainnet') {
                        url = 'https://api.blockcypher.com/v1/btc/main/txs/new'
                }
                else {
                        return {
                                code: 0,
                                message: 'Invalid env'
                        }
                }
                let data = JSON.stringify({
                        "inputs": [
                                {
                                        "addresses": [
                                                `${fromAddress}`  /* "n1TKu4ZX7vkyjfvo7RCbjeUZB6Zub8N3fN" */
                                        ]
                                }
                        ],
                        "outputs": [
                                {
                                        "addresses": [
                                                `${toAddress}` /* "2NCY42y4mbvJCxhd7gcCroBEvVh1dXkbPzA"
     */                    ],
                                        "value": valueInSatoshi
                                }
                        ]
                });

                let config = {
                        method: 'post',
                        maxBodyLength: Infinity,
                        url: 'https://api.blockcypher.com/v1/btc/test3/txs/new',
                        headers: {
                                'Content-Type': 'application/json'
                        },
                        data: data
                };

                const response = await axios.request(config)
                        .then((response) => {
                                // console.log("Tushar",JSON.stringify(response.data));
                                return response;
                        })
                        .catch((error) => {
                                console.log(error);
                        });
                // console.log(response.status);
                if (response.status != 201) {
                        return {
                                code: 0,
                                message: response.data.error
                        }
                }
                return {
                        code: 1,
                        result: response.data
                }

        } catch (error) {
                console.log('error generating btc tx', error);
                return {
                        code: 0,
                        message: error,
                };
        }

}

//This Function must be used in Client side.
const generateSignatures = (privateKey, env, toSign, ecc) => {
        try {
                const ECPair = ecfacory.ECPairFactory(ecc);
                // console.log(ECPair);
                let keys;
                if (env == 'testnet') {
                        keys = ECPair.fromWIF(privateKey, bitcoin.networks.testnet);
                        //   console.log(keys);
                } else if (env == 'mainnet') {
                        keys = ECPair.fromWIF(privateKey, bitcoin.networks.bitcoin);
                        //   console.log(keys);
                } else {
                        return {
                                code: 0,
                                error: INVALID_ENV,
                        };
                }
                const signatures = [];
                const pubkeys = [];
                for (let i = 0; i < toSign.length; i++) {
                        // console.log(i,"Data");
                        signatures.push(
                                bitcoin.script.signature
                                        .encode(keys.sign(Buffer.from(toSign[i], 'hex')), 0x01)
                                        .toString('hex')
                                        .slice(0, -2),
                        );
                        pubkeys.push(keys.publicKey.toString('hex'));
                }
                // console.log("Signature", signatures, "Pubkeys", pubkeys);
                return {
                        code: 1,
                        signatures,
                        pubkeys,
                };
        } catch (error/* : any */) {
                return {
                        code: 0,
                        error,
                };
        }
};

//This function must be used in server side
const sendBTCTx = async (tx, toSign, signatures, pubkeys, env) => {
        try {
                if (!tx || !toSign || !signatures || !pubkeys || !env) {
                        return {
                                code: 0,
                                message: "invalid/insufficient parameters"
                        }
                }
                let url;
                if (env == 'testnet') {
                        url = 'https://api.blockcypher.com/v1/btc/test3/txs/send?token=YOUR_API_KEY';
                }
                else if (env == 'mainnet') {
                        url = 'https://api.blockcypher.com/v1/btc/main/txs/send?token=YOUR_API_KEY';
                }
                else {
                        return {
                                code: 0,
                                message: 'Invalid env'
                        }
                }
                const sendTx = {
                        tx,
                        signatures,
                        pubkeys,
                        tosign: toSign
                }
                // console.log("Data 123",JSON.stringify(sendTx));
                const response = await axios({
                        url,
                        method: 'post',
                        data: sendTx
                })
                // console.log(response, "Response...");
                if (response.status != 201) {
                        return {
                                code: 0,
                                message: response?.data
                        }
                }
                // console.log(response.data);
                return {
                        code: 1,
                        result: response.data
                }

        }
        catch (error) {
                console.log('error sending btc txs', error);
                return {
                        code: 0,
                        error,
                };
        }
}