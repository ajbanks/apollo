import {
    $propertyListings,
    PropertyListing,
    PropertyListingSchema,
} from "../../models/db/property-listings";
import { $logger } from "../../utils/logger";
import moment from "moment";
import { chunk, groupBy, omit } from "lodash";
import { Decimal } from "../../utils/number-helpers";
import { $locations } from "../../models/db/locations";
import { Confidence, calculateConfidence } from "./calculate-confidence.util";
import { $redis } from "../../services/redis";
import { HMO_SUBTYPES } from "../rightmove/rm-property.value";
import { StopWatch } from "../../utils/stop-watch";
import { $slack } from "../../services/slack";

export interface HmoStats {
    location_code: string;
    location_name: string;
    mean_hmo_per_room: number;
    mean_gross_hmo_price: number;
    mean_gross_rent_price: number;
    n_active_hmo_listings: number;
    n_active_rent_listings: number;
    expected_gross_roi: number;
    hmo_confidence: Confidence;
    rent_confidence: Confidence;
}

/** @deprecated */
export async function calculateHMOStatistics(): Promise<
    Record<string, HmoStats>
> {
    let timer = StopWatch({ units: "seconds" });
    let date = moment().subtract(100, "days").startOf("day").toDate();
    let fields = Object.keys(omit(PropertyListingSchema.properties, "data"));

    let [locations, rawHmoListings, rawRentListings] = await Promise.all([
        $locations
            .knex()
            .select("code", "display_name")
            .where({ type: "lad23" }),

        $propertyListings
            .knex()
            .select(...fields)
            .where({
                channel: "RES_LET",
            })
            .where("last_added_at", ">=", date)
            .whereNotNull("price")
            .whereNotNull("bedrooms")
            .whereBetween("price", [100, 3500])
            .whereIn("property_subtype", HMO_SUBTYPES),

        $propertyListings
            .knex()
            .select(...fields)
            .where({
                channel: "RES_LET",
            })
            .where("bedrooms", ">=", 3)
            .where("last_added_at", ">=", date)
            .whereNotNull("price")
            .whereNotNull("bedrooms")
            .whereBetween("price", [100, 3500])
            .whereNotIn("property_subtype", HMO_SUBTYPES),
    ]);

    timer.lap("db data");
    $logger.debug(`data fetched`);

    let groupedHmoListings = groupBy(
        rawHmoListings as PropertyListing[],
        "district_code"
    );

    let groupedRentListings = groupBy(
        rawRentListings as PropertyListing[],
        "district_code"
    );

    timer.lap(`grouping`);

    $logger.debug(`calculating hmo stats...`);

    let stats = locations.reduce((stats, district) => {
        let hmoListings = groupedHmoListings[district.code] || [];
        let rentListings = groupedRentListings[district.code] || [];

        let mean_rent_per_room = calculateAverage(
            rentListings.map(calculatePricePerRoom).filter(Boolean)
        );

        let mean_hmo_per_room = calculateAverage(
            hmoListings.map((listing) => Number(listing.price!))
        );

        let mean_gross_hmo_price = calculateAverage(
            hmoListings
                .map(({ price, bedrooms }) => {
                    return Number(price! * bedrooms!);
                })
                .filter(Boolean)
        );

        let item = {
            location_code: district.code,
            location_name: district.display_name,
            mean_gross_hmo_price,
            mean_gross_rent_price: calculateAverage(
                rentListings.map(({ price }) => price!).filter(Boolean)
            ),
            mean_hmo_per_room,
            n_active_hmo_listings: hmoListings.filter((item) => {
                return !item.display_status && item.active;
            }).length,
            n_active_rent_listings: rentListings.length,
            expected_gross_roi:
                Number((mean_hmo_per_room / mean_rent_per_room).toFixed(2)) ||
                0,
            hmo_confidence: calculateConfidence(hmoListings.length),
            rent_confidence: calculateConfidence(rentListings.length),
        } as const;

        if (![Infinity, null, 0].includes(item.expected_gross_roi)) {
            stats[district.code] = item;
        }

        return stats;
    }, {} as Record<string, HmoStats>);

    timer.lap("stats_completed");

    $logger.info(
        { time: timer.getResults() },
        `calculating hmo stats... complete`
    );

    return stats;
}

function calculateAverage(items: number[]) {
    if (!items.length) return 0;
    let subtotal = items.reduce((subtotal, item) => subtotal + item, 0);
    return Number((subtotal / items.length).toFixed(2));
}

function calculatePricePerRoom({ price, bedrooms }) {
    let bedroomsParsed = Number(bedrooms) || 1;
    let priceParsed = Number(price);
    let result = Decimal(priceParsed / bedroomsParsed);
    return result;
}
