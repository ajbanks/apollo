-- nb: must be run with --param_POSTGRES_HOST=... --param_POSTGRES_DB=... --param_POSTGRES_USER=... --param_POSTGRES_PASSWORD=...
DROP TABLE IF EXISTS properties_simon;
CREATE TABLE IF NOT EXISTS properties_simon
ENGINE = MergeTree()
ORDER BY (type, h3_11, property_type, num_habitable_rooms, bedrooms, ownership_type, council_tax_band, year_built_normalised, total_floor_area)
SETTINGS allow_nullable_key = 1
AS
SELECT
    toUInt64(uprn) as uprn,
    reinterpretAsUInt64(reverse(unhex(h3_11))) h3_11,
    lat, lon, type,
    total_floor_area,
    num_habitable_rooms,
    property_type,
    bedrooms,
    bathrooms,
    ownership_type,
    extensions,
    floor_level,
    toInt32(toFloat32OrNull(flat_storey_count)) flat_storey_count,
    occupation_type,
    year_built_normalised,
    floor_height,
    reinterpretAsUInt8(if(council_tax_band in ('A', 'B', 'C', 'D', 'E', 'F', 'G'), council_tax_band, null))-64 council_tax_band,
    new_build,
    epc_rating,
    epc_potential_rating,
    postcode,
    if(lower(floor_level) IN ('nodata!', 'no data!'),
        NULL, -- Handle \"NODATA!\" and \"NO DATA!\" as NULL
        if(lower(floor_level) = 'ground' OR lower(floor_level) = 'ground floor' OR floor_level = '00' OR floor_level = '0',
            0, -- Ground floor is 0
            if(lower(floor_level) = 'basement' OR floor_level = '-1',
                -1, -- Basement is -1
                if(lower(floor_level) = 'mid floor',
                    floor(flat_storey_count / 2), -- Mid floor approximation
                    if(lower(floor_level) = 'top floor',
                        flat_storey_count, -- Top floor is the total storey count
                        if(floor_level = '20+' OR floor_level = '20+', -- Handle '20+' explicitly
                            20,
                            if(match(floor_level, '^\\d+(?:st|nd|rd|th)?(?: or above)?$'), -- Regex for ordinal numbers and \" or above\"
                                toInt32OrNull(extract(floor_level, '^(\\d+)')), -- Extract number from ordinal and convert to Int
                                if(match(floor_level, '^\\d+$'), -- Regex for simple numbers
                                    toInt32OrNull(floor_level), -- Convert simple number strings to Int
                                    if(match(floor_level, '^0\\d$'), -- Regex for numbers with leading zero e.g. 01, 02
                                        toInt32OrNull(substring(floor_level, 2)), -- Remove leading zero and convert to Int
                                        NULL -- Default to NULL for anything not matched
                                    )
                                )
                            )
                        )
                    )
                )
            )
        )) AS floor_level_int
FROM postgresql(
    {POSTGRES_HOST:String},
    {POSTGRES_DB:String},
    'properties',
    {POSTGRES_USER:String},
    {POSTGRES_PASSWORD:String}
)
