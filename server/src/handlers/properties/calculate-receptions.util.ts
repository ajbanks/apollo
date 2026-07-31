export function calculateReceptions(bedrooms: number, habitableRooms?: number) {
    if (!habitableRooms) return 0;

    let rest = habitableRooms - 1 - bedrooms;

    return rest < 0 ? 0 : rest;
}
