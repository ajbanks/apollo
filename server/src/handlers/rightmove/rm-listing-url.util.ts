export function RmListingUrl(id: string) {
    return `https://www.rightmove.co.uk/properties/${id
        .toString()
        .replace(`rm.`, ``)}`;
}
