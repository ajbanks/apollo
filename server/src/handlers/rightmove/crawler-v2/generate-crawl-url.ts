const BEDROOM_CONFIG = 5;

export function generateCrawlV2Urls({ locationCode }) {
    let generators = [resSale, resLet, comSale, comLet];

    return generators.flatMap((gen) => {
        return gen({ locationCode });
    });
}

function enrichWithBedrooms(url: URL): string[] {
    let urls = Array.from({ length: BEDROOM_CONFIG }).map((_, index) => {
        let newUrl = new URL(url.toString());
        newUrl.searchParams.set("minBedrooms", index.toString());
        newUrl.searchParams.set("maxBedrooms", index.toString());
        return newUrl.toString();
    });

    let last = new URL(url.toString());
    last.searchParams.set("minBedrooms", BEDROOM_CONFIG.toString());
    urls.push(last.toString());

    return urls;
}

function resSale(params: { locationCode: string }): string[] {
    const url = new URL(
        "https://www.rightmove.co.uk/property-for-sale/find.html",
    );

    const searchParams: Record<string, string> = {
        useLocationIdentifier: "true",
        locationIdentifier: params.locationCode,
        radius: "0.0",
        _includeSSTC: "on",
        includeSSTC: "true",
    };

    Object.entries(searchParams).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });

    return params.locationCode.includes("OUTCODE")
        ? enrichWithBedrooms(url)
        : [url.toString()];
}

function resLet(params: { locationCode: string }): string[] {
    const url = new URL(
        "https://www.rightmove.co.uk/property-to-rent/find.html",
    );

    const searchParams: Record<string, string> = {
        useLocationIdentifier: "true",
        locationIdentifier: params.locationCode,
        radius: "0.0",
        _includeLetAgreed: "on",
        includeLetAgreed: "true",
    };

    Object.entries(searchParams).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });

    return params.locationCode.includes("OUTCODE")
        ? enrichWithBedrooms(url)
        : [url.toString()];
}

function comLet(params: { locationCode: string }): string {
    const url = new URL(
        "https://www.rightmove.co.uk/commercial-property-to-let/find.html",
    );

    const searchParams: Record<string, string> = {
        locationIdentifier: params.locationCode,
        radius: "0.0",
        displayPropertyType: "commercial",
        // "rent.x": "RENT",
        search: "To Rent",
        includeLetAgreed: "true",
    };

    Object.entries(searchParams).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });

    return url.toString();
}

function comSale(params: { locationCode: string }): string {
    const url = new URL(
        "https://www.rightmove.co.uk/commercial-property-for-sale/find.html",
    );

    const searchParams: Record<string, string> = {
        locationIdentifier: params.locationCode,
        radius: "0.0",
        includeSSTC: "true",
        displayPropertyType: "commercial",
        // "rent.x": "Sale",
        search: "For Sale",
    };

    Object.entries(searchParams).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });

    return url.toString();
}
