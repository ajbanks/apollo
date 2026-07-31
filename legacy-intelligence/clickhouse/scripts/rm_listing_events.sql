-- wip
-- DROP TABLE IF EXISTS oliver_rm_listing_test;
-- CREATE TABLE IF NOT EXISTS oliver_rm_listing_test
-- ENGINE = MergeTree()
-- ORDER BY (id)
-- SETTINGS allow_nullable_key = 1
-- AS
SELECT topic, timestamp, data.id, data.^location.latitude lat, data.^location.longitude lon from ( -- magic .^ syntax means "this is a horrible nested json, sorry"
    SELECT topic, timestamp, data::JSON as data
    FROM postgresql(
        {POSTGRES_HOST:String},
        {POSTGRES_DB:String},
        'mercurios_events',
        {POSTGRES_USER:String},
        {POSTGRES_PASSWORD:String}
    )
    -- WHERE timestamp > '2025-01-01' -- in theory this should be quick, it will run on postgres not clickhouse, but it seems that the postgres table is using a varchar??
    LIMIT 10
)
SETTINGS allow_experimental_json_type = 1 -- becomes enable_json_type in newer versions of clickhouse

-- relevant bits copied from handlers/....../parse-rm-simplified-events.ts
-- data.details is data in mercurios, dunno what data.api is
        /* id: RmListingId(data.details.id), */ -- rm.{id}
        /* url: RmListingUrl(data.details.id), */ -- https://www.rightmove.co.uk/properties/{id}
        /* udprn: data.details.address?.deliveryPointId, */
        /* channel: data.details?.channel, */
    /* function postcode() { */
    /*     return data.details?.address */
    /*         ? `${data.details.address.outcode} ${data.details.address.incode}` */
    /*         : ""; */
    /* } */
        /* agent_name: data.details.customer?.branchDisplayName, */
        /* commercial: data.api.commercial, */
        /* development: data.api.development, */
        /* residential: data.api.residential, */
        /* students: data.api.students, */
        /* auction: data.api.auction, */
        /* display_status: data.api.displayStatus, */
        /* price: parseCrawledPrice(data) ?? 0, */
        /* lat: data.details.location?.latitude, */
        /* lon: data.details.location?.longitude, */
        /* point_type: data.details.location?.pinType, */
        /* council_tax_band: data.details.livingCosts?.councilTaxBand, */
        /* furnish_type: data.details.lettings?.furnishType, */
        /* let_type: data.details.lettings?.letType, */
        /* first_visible_date, */
        /* listing_update_time, */
        /* listing_update_reason: data.api.listingUpdate?.listingUpdateReason, */
        /* bedrooms: data.details.bedrooms, */
        /* bathrooms: data.details.bathrooms, */
        /* property_subtype: data.details.propertySubType, */
        /* property_type: RmToPropertyTypeMap[data.details.propertySubType], */
        /* ownership: data.details.tenure?.tenureType, */
        /* summary: data.api.summary, */
        /* description: data.details.text?.description, */
        /* features: parseRmFeatures(data), */
        /* rooms: (data.details.rooms ?? []).map((item) => item?.name), */
--SELECT
--    toUInt64(uprn) as uprn,
--    reinterpretAsUInt64(reverse(unhex(h3_11))) h3_11,
--    lat, lon, type,
--    total_floor_area,
--    num_habitable_rooms,
--    property_type,
--    bedrooms,
--    bathrooms,
--    ownership_type,
--    extensions,
--    floor_level,
--    toInt32(toFloat32OrNull(flat_storey_count)) flat_storey_count,
--    occupation_type,
--    year_built_normalised,
--    floor_height,
--    reinterpretAsUInt8(if(council_tax_band in ('A', 'B', 'C', 'D', 'E', 'F', 'G'), council_tax_band, null))-64 council_tax_band,
--    new_build,
--    epc_rating,
--    epc_potential_rating,
--    postcode,
--    if(lower(floor_level) IN ('nodata!', 'no data!'),
--        NULL, -- Handle \"NODATA!\" and \"NO DATA!\" as NULL
--        if(lower(floor_level) = 'ground' OR lower(floor_level) = 'ground floor' OR floor_level = '00' OR floor_level = '0',
--            0, -- Ground floor is 0
--            if(lower(floor_level) = 'basement' OR floor_level = '-1',
--                -1, -- Basement is -1
--                if(lower(floor_level) = 'mid floor',
--                    floor(flat_storey_count / 2), -- Mid floor approximation
--                    if(lower(floor_level) = 'top floor',
--                        flat_storey_count, -- Top floor is the total storey count
--                        if(floor_level = '20+' OR floor_level = '20+', -- Handle '20+' explicitly
--                            20,
--                            if(match(floor_level, '^\\d+(?:st|nd|rd|th)?(?: or above)?$'), -- Regex for ordinal numbers and \" or above\"
--                                toInt32OrNull(extract(floor_level, '^(\\d+)')), -- Extract number from ordinal and convert to Int
--                                if(match(floor_level, '^\\d+$'), -- Regex for simple numbers
--                                    toInt32OrNull(floor_level), -- Convert simple number strings to Int
--                                    if(match(floor_level, '^0\\d$'), -- Regex for numbers with leading zero e.g. 01, 02
--                                        toInt32OrNull(substring(floor_level, 2)), -- Remove leading zero and convert to Int
--                                        NULL -- Default to NULL for anything not matched
--                                    )
--                                )
--                            )
--                        )
--                    )
--                )
--            )
--        )) AS floor_level_int
--FROM postgresql(
--    {POSTGRES_HOST:String},
--    {POSTGRES_DB:String},
--    'properties',
--    {POSTGRES_USER:String},
--    {POSTGRES_PASSWORD:String}
--)
