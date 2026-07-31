export function parseRmFeatures(data) {
    return Array.from(
        new Set<string>([
            ...(data?.details.dfpAdInfo?.targeting?.find(
                (item) => item?.key === "F"
            )?.value || []),
            ...(data?.details?.keyFeatures?.map((i) => i.trim()) || []),
        ])
    );
}
