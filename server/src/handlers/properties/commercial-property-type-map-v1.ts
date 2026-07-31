const CATEGORY_KEYWORDS = [
    [
        "Retail & Financial Services",
        [
            "retail",
            // Expanded for practicality; SQL had "financial/professional services"
            "financial/professional services",
            "financial",
            "professional services",
        ],
    ],
    ["Office & Workshop", ["offices", "workshop"]],
    [
        "Food & Beverage",
        [
            "restaurant",
            "cafes",
            "drinking establishments",
            "hot food takeaways",
            "public house",
        ],
    ],
    [
        "Industrial & Storage",
        ["storage", "distribution", "warehouse", "industrial"],
    ],
    ["Hotel", ["hotel"]],
    [
        "Residential Institutions",
        [
            "residential institutions",
            "hospitals",
            "care homes",
            "residential schools",
            "universities and colleges",
            "secure residential institutions",
            "nursing residential homes",
            "hostels",
        ],
    ],
    [
        "Public & Community Services",
        [
            "non-residential institutions",
            "education",
            "primary health care",
            "community/day centre",
            "libraries museums and galleries",
            "crown and county courts",
        ],
    ],
    [
        "Leisure & Entertainment",
        [
            "assembly and leisure",
            "night clubs",
            "theatres",
            "sports centre",
            "social clubs",
            "sports ground arena",
        ],
    ],
    [
        "Transportation",
        [
            "passenger terminals",
            "airport terminals",
            "bus station",
            "train station",
            "seaport terminal",
            "car parks",
        ],
    ],
] as const;

export function commercialPropertyTypeMapV1(input: string): string | null {
    const haystack = (input ?? "").toLowerCase();

    for (const [category, needles] of CATEGORY_KEYWORDS) {
        if (needles.some((needle) => haystack.includes(needle))) {
            return category;
        }
    }

    return null;
}
