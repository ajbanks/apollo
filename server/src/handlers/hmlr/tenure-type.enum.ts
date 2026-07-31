export const enum HmlrTenureType {
    "FREEHOLD" = "Freehold",
    "LEASEHOLD" = "Leasehold",
    "COMMONHOLD" = "Commonhold",
    "FEUHOLD" = "Feuhold",
    "MIXED" = "Mixed",
    "UNKOWN" = "Unknown",
    "UNAVAILABLE" = "Unavailable",
    "CAUTION_AGAINST_FIRST_REGISTRATION" = "Caution Against First Registration",
    "RENT_CHARGE" = "Rent Charge",
    "FRANCHISE" = "Franchise",
    "PROFIT_PRENDRE_IN_GROSS" = "Profit A Prendre In Gross",
    "MANOR" = "Manor",
}

export const TenureTypeMap: Record<string, HmlrTenureType> = {
    "10": HmlrTenureType.FREEHOLD,
    "20": HmlrTenureType.LEASEHOLD,
    "30": HmlrTenureType.COMMONHOLD,
    "40": HmlrTenureType.FEUHOLD,
    "100": HmlrTenureType.MIXED,
    "110": HmlrTenureType.UNKOWN,
    "120": HmlrTenureType.UNAVAILABLE,
    "130": HmlrTenureType.CAUTION_AGAINST_FIRST_REGISTRATION,
    "140": HmlrTenureType.RENT_CHARGE,
    "150": HmlrTenureType.FRANCHISE,
    "160": HmlrTenureType.PROFIT_PRENDRE_IN_GROSS,
    "170": HmlrTenureType.MANOR,
};

type Enum<T> = { readonly [K in keyof T]: T[K] };
export function Enum<T extends Record<PropertyKey, unknown>>(obj: T): Enum<T> {
    return obj as Enum<T>;
}

export const HmlrTenureTypeEnum = Enum({
    FREEHOLD: "Freehold",
});
