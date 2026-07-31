type SearchType = "buy" | "rent" | "commercial_buy" | "commercial_rent";

export interface RmUrlGenerator {
    (index: number): {
        url: string;
        locationCode: string;
    };
}

export function buildGenerators({
    minBedrooms,
    maxBedrooms,
    locationCode,
}: {
    locationCode: string;
    minBedrooms: number;
    maxBedrooms: number;
}) {
    let bedroomCombinations = generateBedroomCombinations(
        minBedrooms,
        maxBedrooms
    );
    if (locationCode.includes("OUTCODE")) {
        return [
            ...bedroomCombinations.map(({ minBedrooms, maxBedrooms }) => {
                return bedroomSearch({
                    locationCode,
                    type: "rent",
                    minBedrooms: minBedrooms,
                    maxBedrooms: maxBedrooms,
                });
            }),

            ...bedroomCombinations.map(({ minBedrooms, maxBedrooms }) => {
                return bedroomSearch({
                    locationCode,
                    type: "buy",
                    minBedrooms: minBedrooms,
                    maxBedrooms: maxBedrooms,
                });
            }),

            ...[
                bedroomSearch({
                    locationCode,
                    type: "rent",
                    minBedrooms: maxBedrooms + 1,
                }),
                bedroomSearch({
                    locationCode,
                    type: "buy",
                    minBedrooms: maxBedrooms + 1,
                }),
            ],

            locationSearch({ locationCode, type: "commercial_rent" }),
            locationSearch({ locationCode, type: "commercial_buy" }),
        ];
    } else {
        return [
            locationSearch({ locationCode, type: "rent" }),
            locationSearch({ locationCode, type: "buy" }),
            locationSearch({ locationCode, type: "commercial_rent" }),
            locationSearch({ locationCode, type: "commercial_buy" }),
        ];
    }
}

function generateBedroomCombinations(
    min: number,
    max: number
): { minBedrooms: number; maxBedrooms: number }[] {
    let tuples: { minBedrooms: number; maxBedrooms: number }[] = [];

    for (let i = min; i <= max; i++) {
        tuples.push({
            minBedrooms: i,
            maxBedrooms: i,
        });
    }

    return tuples;
}

function resolveSearchType(type: SearchType) {
    let gone: string, channel: string;

    switch (type) {
        case "buy":
            gone = "includeSSTC";
            channel = "BUY";
            break;

        case "commercial_buy":
            gone = "includeSSTC";
            channel = "COMMERCIAL_BUY";
            break;

        case "rent":
            gone = "includeLetAgreed";
            channel = "RENT";
            break;

        case "commercial_rent":
            gone = "includeLetAgreed";
            channel = "COMMERCIAL_RENT";
            break;

        default:
            throw new Error("Invalid type");
    }

    return {
        gone,
        channel,
    };
}

function bedroomSearch({
    locationCode,
    minBedrooms,
    maxBedrooms,
    type,
}: {
    locationCode: string;
    minBedrooms: number;
    maxBedrooms?: number;
    type: SearchType;
}): RmUrlGenerator {
    let { gone, channel } = resolveSearchType(type);

    return (index: number) => {
        return {
            url: `https://www.rightmove.co.uk/api/_search?locationIdentifier=${locationCode}&minBedrooms=${minBedrooms}${
                maxBedrooms ? `&maxBedrooms=${maxBedrooms}` : ""
            }&numberOfPropertiesPerPage=24&radius=0.0&sortType=2&index=${index}&${gone}=true&viewType=LIST&channel=${channel}&areaSizeUnit=sqft&currencyCode=GBP&isFetching=false`,
            locationCode,
        };
    };
}

// https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=OUTCODE^1
export function locationSearch({
    locationCode,
    type,
}: {
    locationCode: string;
    type: SearchType;
}): RmUrlGenerator {
    let { gone, channel } = resolveSearchType(type);

    return (index: number) => {
        return {
            url: `https://www.rightmove.co.uk/api/_search?locationIdentifier=${locationCode}&numberOfPropertiesPerPage=24&radius=0.0&sortType=2&index=${index}&${gone}=true&viewType=LIST&channel=${channel}&areaSizeUnit=sqft&currencyCode=GBP&isFetching=false`,
            locationCode,
        };
    };
}
