// utils/feeValidation.js

import BigNumber from 'bignumber.js';

export function validateFee(estimatedFee, totalInput, minFeeRate = 1, maxFeeRate = 1000) {
        const minFee = new BigNumber(totalInput).multipliedBy(minFeeRate).dividedBy(100000000); // 1 sat/vB minimum
        const maxFee = new BigNumber(totalInput).multipliedBy(maxFeeRate).dividedBy(100000000); // 1000 sat/vB maximum

        if (estimatedFee.isLessThan(minFee)) {
                return "Fee is too low. Please increase the fee rate.";
        }
        if (estimatedFee.isGreaterThan(maxFee)) {
                return "Fee is unusually high. Please double-check the fee rate.";
        }
        return null; // No error
}