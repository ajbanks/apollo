#!/bin/bash

clickhouse-client -q "
	DROP TABLE IF EXISTS uprn_garden_area;
	CREATE TABLE IF NOT EXISTS uprn_garden_area
	ENGINE = MergeTree
	ORDER BY uprn
	AS
	SELECT
		uprn,
		plot_area_sqm - (total_floor_area / 2) AS garden_area_sqm
	FROM
	(
		SELECT
			uprn,
			total_floor_area
		FROM properties_simon
		WHERE (type = 'domestic') AND (total_floor_area > 0)
	) AS epc
	INNER JOIN
	(
		SELECT
			any(uprn) AS uprn,
			any(plot_area_sqm) AS plot_area_sqm
		FROM inspire_uprn_clean AS iuc
		GROUP BY INSPIREID
		HAVING count(*) = 1
	) AS iuc ON epc.uprn = iuc.uprn;

	-- must run after uprn_garden_area and properties_simon
	DROP TABLE IF EXISTS properties_area;
	CREATE TABLE IF NOT EXISTS properties_area
	ENGINE = MergeTree
	ORDER BY (type, h3_11, property_type, uprn, num_habitable_rooms, bedrooms, ownership_type, council_tax_band, year_built_normalised, total_floor_area, garden_area_sqm, plot_area_sqm)
	SETTINGS allow_nullable_key = 1
	AS SELECT
		ps.uprn uprn,
		ps.*,
        if(uprn in (select distinct uprn from vw_rm_listing_events_with_uprns vrlewu where indexOf(features, 'garden') > 0), 1, NULL) has_garden,
        if(uprn in (select distinct uprn from vw_rm_listing_events_with_uprns vrlewu where indexOf(features, 'parking') > 0), 1 NULL) has_parking,
		ga.garden_area_sqm,
	    iu.plot_area_sqm
	FROM properties_simon AS ps
	LEFT JOIN uprn_garden_area AS ga ON ps.uprn = ga.uprn
	LEFT JOIN inspire_uprn_clean AS iu ON ps.uprn = iu.uprn
	WHERE type = 'domestic'
"
