// src/constants.js
import * as bitcoin from 'bitcoinjs-lib';

export const NETWORK = bitcoin.networks.testnet; // Use bitcoin.networks.bitcoin for mainnet
export const MEMPOOL_API = 'https://mempool.space/testnet/api'; // Use 'https://mempool.space/api' for mainnet