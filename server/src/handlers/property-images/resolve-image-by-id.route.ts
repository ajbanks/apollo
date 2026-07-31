// import { ExpectationFailed, Gone } from "@bahatron/utils/lib/error";
// import { Route } from "../../app/route";
// import {
//     $propertyListings,
//     PropertyListing,
//     PropertyListingSchema,
// } from "../../models/db/property-listings";
// import { channel } from "diagnostics_channel";
// import { $imageMap } from "../../models/db/image-map";
// import { $imageBucket } from "../../services/image-bucket";
// import { $logger } from "../../utils/logger";
// import { $schema } from "../../utils/json-schema";

// export const ResolveImageByIdRoute = Route({
//     method: "get",
//     route: "/images/resolve",
//     docs: {
//         parameters: [
//             {
//                 name: "uprn",
//                 in: "query",
//                 description: "The UPRN of the image to resolve",
//                 schema: {
//                     type: "string",
//                 },
//             },
//             {
//                 name: "listing_id",
//                 in: "query",
//                 description: "The ID of the listing to resolve",
//                 schema: {
//                     type: "string",
//                 },
//             },
//             {
//                 name: "type",
//                 in: "query",
//                 description: "Type of image",
//                 schema: PropertyListingSchema.properties.images.items.properties
//                     .type,
//             },
//         ],
//     },
//     handler: async (req, res) => {
//         let { uprn, listing_id, type } = req.query;

//         let imageId = await findImageByIdentifier({ uprn, listing_id, type });

//         res.json(imageId);
//     },
// });

// export async function findImageByIdentifier({
//     uprn,
//     listing_id,
//     type = "property",
// }: any = {}) {
//     $logger.debug({ uprn, listing_id, type }, `finding image by identifier`);

//     if (!uprn && !listing_id) throw ExpectationFailed("missing identifier");

//     let listingImages: PropertyListing["images"] | undefined;

//     if (listing_id) {
//         $logger.debug(`checking by listing id...`);

//         let listing = await $propertyListings
//             .knex()
//             .select("images")
//             .where({ id: listing_id })
//             .first();

//         listingImages = listing?.images;
//     } else if (uprn) {
//         $logger.debug(`checking by uprn...`);

//         let listings = await $propertyListings
//             .knex()
//             .select("active", "images")
//             .where({ uprn })
//             .orderBy("last_added_at", "desc")
//             .limit(10);

//         // prioritise active listings
//         listingImages =
//             listings.find((val) => val.active)?.images || listings[0]?.images;
//     }

//     if (!listingImages?.length) throw Gone("image not found");

//     let originalUrl = (
//         listingImages.find((img) => img.type === type) ?? listingImages[0]
//     ).original_url;

//     let image = await $imageMap
//         .knex()
//         .where({ original_url: originalUrl })
//         .first();

//     if (!image) throw Gone("image not found");

//     return image.id;
// }
