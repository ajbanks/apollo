import { LandRegistryRecord } from "../../models/db/land-registry-england";

export enum PropertyTypes {
    DETACHED = "detached",
    SEMI_DETACHED = "semi_detached",
    TERRACED = "terraced",
    END_OF_TERRACE = "end_of_terrace",
    MAISONETTE = "maisonette",
    BUNGALOW = "bungalow",
    TERRACED_BUNGALOW = "terraced_bungalow",
    SEMI_DETACHED_BUNGALOW = "semi_detached_bungalow",
    FLAT = "flat",
    CARAVAN = "caravan",
    OTHER = "other",
}

export const PropertyTypeNeighbors: Record<PropertyTypes, PropertyTypes[]> = {
    [PropertyTypes.DETACHED]: [PropertyTypes.DETACHED],

    [PropertyTypes.MAISONETTE]: [PropertyTypes.MAISONETTE, PropertyTypes.FLAT],
    [PropertyTypes.FLAT]: [PropertyTypes.FLAT, PropertyTypes.MAISONETTE],

    [PropertyTypes.CARAVAN]: [PropertyTypes.CARAVAN, PropertyTypes.OTHER],
    [PropertyTypes.OTHER]: [PropertyTypes.OTHER, PropertyTypes.CARAVAN],

    [PropertyTypes.SEMI_DETACHED]: [
        PropertyTypes.SEMI_DETACHED,
        PropertyTypes.SEMI_DETACHED_BUNGALOW,
    ],

    [PropertyTypes.TERRACED]: [
        PropertyTypes.TERRACED,
        PropertyTypes.END_OF_TERRACE,
        PropertyTypes.TERRACED_BUNGALOW,
    ],

    [PropertyTypes.END_OF_TERRACE]: [
        PropertyTypes.TERRACED,
        PropertyTypes.END_OF_TERRACE,
    ],

    [PropertyTypes.BUNGALOW]: [
        PropertyTypes.BUNGALOW,
        PropertyTypes.TERRACED_BUNGALOW,
        PropertyTypes.SEMI_DETACHED_BUNGALOW,
    ],

    [PropertyTypes.TERRACED_BUNGALOW]: [
        PropertyTypes.BUNGALOW,
        PropertyTypes.TERRACED,
        PropertyTypes.END_OF_TERRACE,
        PropertyTypes.TERRACED_BUNGALOW,
        PropertyTypes.SEMI_DETACHED_BUNGALOW,
    ],

    [PropertyTypes.SEMI_DETACHED_BUNGALOW]: [
        PropertyTypes.BUNGALOW,
        PropertyTypes.SEMI_DETACHED,
        PropertyTypes.SEMI_DETACHED_BUNGALOW,
    ],
};

export const EpcToPropertyTypeMap = {
    Bungalow: {
        Detached: PropertyTypes.BUNGALOW,
        "NO DATA!": PropertyTypes.BUNGALOW,
        "Semi-Detached": PropertyTypes.SEMI_DETACHED_BUNGALOW,
        "Enclosed End-Terrace": PropertyTypes.TERRACED_BUNGALOW,
        "End-Terrace": PropertyTypes.TERRACED_BUNGALOW,
        "Enclosed Mid-Terrace": PropertyTypes.TERRACED_BUNGALOW,
        "Mid-Terrace": PropertyTypes.TERRACED_BUNGALOW,
    },
    Maisonette: {
        "End-Terrace": PropertyTypes.MAISONETTE,
        "Semi-Detached": PropertyTypes.MAISONETTE,
        "Enclosed Mid-Terrace": PropertyTypes.MAISONETTE,
        "NO DATA!": PropertyTypes.MAISONETTE,
        "": PropertyTypes.MAISONETTE,
        "Mid-Terrace": PropertyTypes.MAISONETTE,
        "Enclosed End-Terrace": PropertyTypes.MAISONETTE,
        Detached: PropertyTypes.MAISONETTE,
    },
    House: {
        Detached: PropertyTypes.DETACHED,
        "Semi-Detached": PropertyTypes.SEMI_DETACHED,
        "NO DATA!": PropertyTypes.DETACHED,
        "Enclosed End-Terrace": PropertyTypes.END_OF_TERRACE,
        "End-Terrace": PropertyTypes.END_OF_TERRACE,
        "Enclosed Mid-Terrace": PropertyTypes.TERRACED,
        "Mid-Terrace": PropertyTypes.TERRACED,
    },
    "Park home": {
        "Mid-Terrace": PropertyTypes.CARAVAN,
        Detached: PropertyTypes.CARAVAN,
        "Semi-Detached": PropertyTypes.CARAVAN,
    },
    Flat: {
        "Enclosed Mid-Terrace": PropertyTypes.FLAT,
        "Mid-Terrace": PropertyTypes.FLAT,
        "NO DATA!": PropertyTypes.FLAT,
        Detached: PropertyTypes.FLAT,
        "": PropertyTypes.FLAT,
        "Enclosed End-Terrace": PropertyTypes.FLAT,
        "Semi-Detached": PropertyTypes.FLAT,
        "End-Terrace": PropertyTypes.FLAT,
    },
};

export const LandRegistryToPropertyTypeMap: Record<
    LandRegistryRecord["property_type"],
    (typeof PropertyTypes)[keyof typeof PropertyTypes] | null
> = {
    DETACHED: PropertyTypes.DETACHED,
    SEMI_DETACHED: PropertyTypes.SEMI_DETACHED,
    TERRACED: PropertyTypes.TERRACED,
    FLAT: PropertyTypes.FLAT,
    OTHER: PropertyTypes.OTHER,
};
