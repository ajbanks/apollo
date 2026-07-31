import { isNumber } from "lodash";
import { Property } from "../../models/db/properties";
import { EpcCertificate } from "../../models/db/epc-england";

const propertyTypeCoefficients = {
    detached: 0.1599,
    semi_detached: 0.0533,
    terraced: -0.0049,
    end_of_terrace: -0.041,
    bungalow: 0.2049,
    semi_detached_bungalow: 0.1296,
    terraced_bungalow: -0.0729,
    maisonette: -0.0011,
    flat: -0.3925,
    hmo: -0.6271,
    block_of_flats: 2.0574,
    caravan: -1.1173,
    house_boat: 0.1017,
    retirement: -0.4499,
};

const bedroomCoefficients = {
    totalFloorArea: 0.0017,
    numHabitableRooms: 0.3326,
    extensions: 0.4689,
    intercept: 0.9261,
};

const bathroomCoefficients = {
    totalFloorArea: 0.0073,
    numHabitableRooms: -0.049,
    extensions: 0.4459,
    intercept: 0.8819,
};

export function inferPropertyBedAndBaths(
    property: Property,
    epcCertificate?: EpcCertificate
): {
    bedrooms: number;
    bathrooms: number;
} | null {
    let { bedrooms, bathrooms } = property;
    let propertyType = property.property_type!;

    if (isNumber(bedrooms) && isNumber(bathrooms)) {
        return {
            bedrooms,
            bathrooms,
        };
    }

    if (
        !epcCertificate ||
        !epcCertificate?.total_floor_area ||
        !isNumber(epcCertificate?.number_habitable_rooms)
    ) {
        return null;
    }

    let totalFloorArea = epcCertificate.total_floor_area;
    let numHabitableRooms = epcCertificate.number_habitable_rooms;
    let extensions = Number(epcCertificate.extension_count);
    let propertyTypeContribution = propertyTypeCoefficients[propertyType] || 0;

    // Predict bedrooms
    let bedroomsRaw =
        bedroomCoefficients.totalFloorArea * totalFloorArea +
        bedroomCoefficients.numHabitableRooms * numHabitableRooms +
        bedroomCoefficients.extensions * extensions +
        propertyTypeContribution +
        bedroomCoefficients.intercept;

    // Predict bathrooms
    let bathroomsRaw =
        bathroomCoefficients.totalFloorArea * totalFloorArea +
        bathroomCoefficients.numHabitableRooms * numHabitableRooms +
        bathroomCoefficients.extensions * extensions +
        propertyTypeContribution +
        bathroomCoefficients.intercept;

    return {
        bedrooms: Math.floor(bedroomsRaw),
        bathrooms: Math.round(bathroomsRaw),
    };
}
