import { Decimal } from "../../../utils/number-helpers";
import { mortgageCalculator } from "./mortgage-calculator";
import { stampDutyCalculator } from "./stamp-duty-calculator";

export function calculateBuyDeal({
    purchasePrice,
    closingCosts,
    refurbCosts,
    cashInvestment,
    mortgageInterest,
    mortgageDuration,
    monthlyHoldingCosts,
    monthlyMaxAchievableRent,
    occupancyRate,
    monthlyOperationalCosts,
    holdingPeriod,
    saleValue,
    saleCosts,
    country,
}) {
    let stampDuty = stampDutyCalculator(purchasePrice, country);

    let totalPurchasePrice = purchasePrice + stampDuty + closingCosts;
    let mortgageAmount = totalPurchasePrice - cashInvestment;

    let mortgageInterestOnly = mortgageCalculator({
        amount: mortgageAmount,
        interest: mortgageInterest,
        duration: mortgageDuration,
        interestOnly: true,
    });

    let mortgageCapitalIncluded = mortgageCalculator({
        amount: mortgageAmount,
        interest: mortgageInterest,
        duration: mortgageDuration,
    });

    let totalHoldingCosts =
        (mortgageInterestOnly + monthlyHoldingCosts) * holdingPeriod;

    let totalSaleCosts = totalHoldingCosts + saleCosts;

    let totalFlipProjectCost =
        totalPurchasePrice + refurbCosts + totalSaleCosts;

    let totalCapitalEmployed =
        totalPurchasePrice - mortgageAmount + refurbCosts;

    // FLIP
    let totalFlipCapitalEmployed = totalCapitalEmployed + totalSaleCosts;
    let netSaleProfit = saleValue - totalFlipProjectCost;
    let grossSaleROI = Decimal(
        (netSaleProfit * 100) /
            (totalPurchasePrice + refurbCosts + totalSaleCosts),
        1
    );
    let saleROCE = Decimal((netSaleProfit * 100) / totalFlipCapitalEmployed);

    // BTL
    let totalMonthlyRentalCosts =
        mortgageCapitalIncluded + monthlyOperationalCosts;
    let netMonthlyRentalProfit =
        monthlyMaxAchievableRent * occupancyRate - totalMonthlyRentalCosts;
    let grossRentalYield = Decimal(
        (monthlyMaxAchievableRent * 1200) / purchasePrice,
        1
    );
    let netRentalYield = Decimal(
        (netMonthlyRentalProfit * 1200) / purchasePrice,
        1
    );
    let rentalROCE = Decimal(
        (netMonthlyRentalProfit * 1200) / totalCapitalEmployed
    );

    return {
        purchase: {
            stamp_duty: stampDuty,
            total_purchase_price: totalPurchasePrice,
            monthly_mortgage_interest_only: Decimal(mortgageInterestOnly, 1),
            monthly_mortgage_capital_included: Decimal(
                mortgageCapitalIncluded,
                1
            ),
        },
        flip: {
            total_capital_invested: totalFlipCapitalEmployed,
            net_profit: netSaleProfit,
            sale_roi: grossSaleROI,
            roce: saleROCE,
        },
        btl: {
            net_monthly_profit: netMonthlyRentalProfit,
            gross_rental_yield: grossRentalYield,
            net_rental_yield: netRentalYield,
            roce: rentalROCE,
        },
    };
}
