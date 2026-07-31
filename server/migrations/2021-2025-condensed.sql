

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;



COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';



CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;



COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';



CREATE TYPE public.location_types_enum AS ENUM (
    'outcode',
    'district',
    'county',
    'region',
    'country',
    'state',
    'city',
    'ward'
);


SET default_tablespace = '';

SET default_table_access_method = heap;


CREATE TABLE public.api_clients (
    id character varying(255) NOT NULL,
    name character varying(255) NOT NULL
);



CREATE TABLE public.api_keys (
    key character varying(255) NOT NULL,
    client_id character varying(255),
    enabled boolean DEFAULT true NOT NULL
);



CREATE TABLE public.census_2021_data (
    location_code character varying(255) NOT NULL,
    location_type character varying(255) NOT NULL,
    file_code character varying(255) NOT NULL,
    key character varying(255) NOT NULL,
    display_name character varying(255) NOT NULL,
    value integer NOT NULL
);



CREATE TABLE public.epc_data_england (
    id character varying(255) NOT NULL,
    address character varying(255),
    postcode character varying(255),
    building_reference_number character varying(255),
    current_epc_rating character varying(255),
    potential_epc_rating character varying(255),
    current_energy_efficiency integer,
    potential_energy_efficiency integer,
    property_type character varying(255),
    built_form character varying(255),
    inspection_date date,
    lodgement_date date,
    transaction_type character varying(255),
    environment_impact_current double precision,
    environment_impact_potential double precision,
    energy_consumption_current double precision,
    energy_consumption_potential double precision,
    co2_emissions_current double precision,
    co2_emiss_curr_per_floor_area double precision,
    co2_emissions_potential double precision,
    lighting_cost_current double precision,
    lighting_cost_potential double precision,
    heating_cost_current double precision,
    heating_cost_potential double precision,
    hot_water_cost_current double precision,
    hot_water_cost_potential double precision,
    total_floor_area double precision,
    energy_tariff character varying(255),
    mains_gas_flag character varying(255),
    floor_level character varying(255),
    flat_top_storey character varying(255),
    flat_storey_count character varying(255),
    main_heating_controls character varying(255),
    multi_glaze_proportion character varying(255),
    glazed_type character varying(255),
    glazed_area character varying(255),
    extension_count character varying(255),
    number_habitable_rooms integer,
    number_heated_rooms integer,
    low_energy_lighting character varying(255),
    number_open_fireplaces character varying(255),
    hotwater_description character varying(255),
    hot_water_energy_eff character varying(255),
    hot_water_env_eff character varying(255),
    floor_description character varying(255),
    floor_energy_eff character varying(255),
    floor_env_eff character varying(255),
    windows_description character varying(255),
    windows_energy_eff character varying(255),
    windows_env_eff character varying(255),
    walls_description character varying(255),
    walls_energy_eff character varying(255),
    walls_env_eff character varying(255),
    secondheat_description character varying(255),
    sheating_energy_eff character varying(255),
    sheating_env_eff character varying(255),
    roof_description character varying(255),
    roof_energy_eff character varying(255),
    roof_env_eff character varying(255),
    mainheat_description character varying(255),
    mainheat_energy_eff character varying(255),
    mainheat_env_eff character varying(255),
    mainheatcont_description character varying(255),
    mainheatc_energy_eff character varying(255),
    mainheatc_env_eff character varying(255),
    lighting_description character varying(255),
    lighting_energy_eff character varying(255),
    lighting_env_eff character varying(255),
    main_fuel character varying(255),
    wind_turbine_count character varying(255),
    heat_loss_corridor character varying(255),
    unheated_corridor_length character varying(255),
    floor_height character varying(255),
    photo_supply character varying(255),
    solar_water_heating_flag character varying(255),
    mechanical_ventilation character varying(255),
    construction_age_band character varying(255),
    lodgement_datetime timestamp with time zone,
    tenure character varying(255),
    fixed_lighting_outlets_count character varying(255),
    low_energy_fixed_light_count character varying(255),
    uprn character varying(255),
    uprn_source character varying(255),
    publish_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    epc_type character varying(255) NOT NULL
);



CREATE TABLE public.epc_recommendations_england (
    certificate_id character varying(255) NOT NULL,
    item integer NOT NULL,
    recommendation text,
    indicative_cost character varying(255),
    indicative_roi character varying(255),
    co2_impact character varying(255)
);



CREATE TABLE public.flood_risk_areas (
    id character varying(255) NOT NULL,
    date date,
    flood_risk character varying(255),
    suitability character varying(255),
    geometry json,
    h3_11 text[],
    h3_9 text[]
);



CREATE TABLE public.hmo_registry_log (
    location_code character varying(255) NOT NULL,
    process_date timestamp with time zone NOT NULL
);



CREATE TABLE public.hmo_registry_properties (
    id character varying(255) NOT NULL,
    date_start timestamp with time zone,
    date_end timestamp with time zone,
    postcode character varying(255),
    address character varying(255),
    uprn character varying(255),
    license_holder character varying(255),
    license_holder_address character varying(255),
    max_households integer,
    max_occupiers integer,
    storyes integer,
    bedrooms integer,
    bathrooms integer,
    living_rooms integer
);



CREATE TABLE public.hometrack_address_lookup (
    postcode character varying(255) NOT NULL,
    "timestamp" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    data json
);



CREATE TABLE public.idp_addresses (
    id character varying(255) NOT NULL,
    "timestamp" timestamp with time zone,
    postcode character varying(255),
    uprn character varying(255),
    udprn character varying(255),
    data json
);



CREATE TABLE public.image_map (
    id character varying(255),
    original_url character varying(255) NOT NULL,
    content_type character varying(255)
);



CREATE TABLE public.land_registry_england (
    transaction_id character varying(255) NOT NULL,
    price numeric,
    date timestamp with time zone,
    new_build boolean,
    property_type character varying(255),
    duration character varying(255),
    ppd character varying(255),
    record_status character varying(255),
    paon character varying(255),
    saon character varying(255),
    street character varying(255),
    postcode character varying(255),
    locality character varying(255),
    town_or_city character varying(255),
    district character varying(255),
    county character varying(255),
    uprn character varying(255),
    publish_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);



CREATE TABLE public.lha_rates (
    location_name character varying(255) NOT NULL,
    year character varying(255) NOT NULL,
    location_code character varying(255),
    cat_a numeric(8,2),
    cat_b numeric(8,2),
    cat_c numeric(8,2),
    cat_d numeric(8,2),
    cat_e numeric(8,2)
);



CREATE TABLE public.listing_uprn_map (
    listing_id character varying(255) NOT NULL,
    uprn character varying(255),
    inspire_id character varying(255)
);



CREATE TABLE public.location_statistics_v3 (
    location_code character varying(255) NOT NULL,
    location_type character varying(255) NOT NULL,
    display_name character varying(255),
    date_calculated timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    resolution character varying(255) NOT NULL,
    property_type character varying(255) NOT NULL,
    bedrooms character varying(255) NOT NULL,
    data jsonb
);



CREATE TABLE public.locations (
    code character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    display_name character varying(255),
    meta jsonb,
    geometry jsonb,
    h3_9 text[],
    h3_7 text[],
    h3_11 text[],
    h3_13 text[]
);



CREATE TABLE public.mercurios_events (
    topic character varying(255) NOT NULL,
    seq integer NOT NULL,
    "timestamp" character varying(255),
    key character varying(255),
    data text
);



CREATE TABLE public.mercurios_topics (
    topic character varying(255) NOT NULL,
    seq integer
);



CREATE TABLE public.osm_places (
    id uuid NOT NULL,
    data jsonb,
    lat character varying(255),
    lon character varying(255),
    osm_type character varying(255),
    type character varying(255),
    category character varying(255)
);



CREATE TABLE public.population_projections (
    code character varying(255) NOT NULL,
    prediction_2018 integer,
    prediction_2023 integer,
    prediction_2028 integer,
    prediction_2033 integer,
    prediction_2038 integer,
    prediction_2043 integer,
    total_change integer,
    total_percentage_change numeric(8,2),
    average_annual_change integer
);



CREATE TABLE public.postcode_map (
    postcode character varying(255) NOT NULL,
    lat numeric(12,8),
    lon numeric(12,8),
    slug character varying(255),
    h3_9 character varying(255),
    country character varying(255),
    country_name character varying(255),
    region character varying(255),
    region_name character varying(255),
    county character varying(255),
    county_name character varying(255),
    district character varying(255),
    district_name character varying(255),
    msoa21 character varying(255),
    msoa21_name character varying(255),
    ttwa character varying(255),
    ttwa_name character varying(255),
    urban_type_code character varying(255),
    urban_type_description character varying(255),
    area_type_code character varying(255),
    area_type_group character varying(255),
    area_type_subgroup character varying(255),
    area_type_supergroup character varying(255),
    ward character varying(255),
    ward_name character varying(255)
);



CREATE TABLE public.postcode_meta (
    postcode character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    metadata jsonb
);



CREATE TABLE public.probate_gazette (
    id character varying(255) NOT NULL,
    published_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    feed jsonb NOT NULL,
    data jsonb NOT NULL
);



CREATE TABLE public.properties (
    uprn character varying(255) NOT NULL,
    lat numeric(12,8),
    lon numeric(12,8),
    postcode character varying(255),
    epc character varying(255),
    total_floor_area double precision,
    num_habitable_rooms integer,
    property_type character varying(255),
    bedrooms integer,
    bathrooms integer,
    last_epc_certificate_date timestamp with time zone,
    last_transaction_date timestamp with time zone,
    last_transaction_price integer,
    ownership_type character varying(255),
    address character varying(255),
    h3_7 character varying(255),
    h3_9 character varying(255),
    h3_11 character varying(255),
    h3_13 character varying(255),
    h3_15 character varying(255),
    extensions integer,
    potential_epc character varying(255),
    type character varying(255),
    flood_risk character varying(255),
    new_build boolean,
    floor_level character varying(255),
    flat_storey_count character varying(255),
    occupation_type character varying(255),
    year_built_normalised integer,
    last_transaction_id character varying(255),
    last_epc_certificate_id character varying(255),
    floor_height double precision,
    council_tax_band character varying(255),
    epc_rating integer,
    epc_potential_rating integer,
    inspire_id character varying(255)
);



CREATE TABLE public.property_listings (
    id character varying(255) NOT NULL,
    data jsonb,
    active boolean DEFAULT false,
    udprn character varying(255),
    postcode character varying(255),
    channel character varying(255),
    price integer,
    display_status character varying(255),
    first_visible_at timestamp with time zone,
    first_crawled_at timestamp with time zone,
    last_crawled_at timestamp with time zone,
    exit_at timestamp with time zone,
    property_subtype character varying(255),
    commercial boolean,
    development boolean,
    residential boolean,
    students boolean,
    auction boolean,
    bedrooms integer,
    bathrooms integer,
    lat numeric(12,8),
    lon numeric(12,8),
    display_size character varying(255),
    property_type character varying(255),
    ownership character varying(255),
    epc_rating character varying(255),
    uprn character varying(255),
    furnish_type character varying(255),
    council_tax_band character varying(255),
    url character varying(255),
    last_added_at timestamp with time zone,
    last_price_update_at timestamp with time zone,
    agent_id integer,
    let_type character varying(255),
    let_available_date date,
    h3_9 character varying(255),
    agent_branch_name character varying(255),
    h3_11 character varying(255),
    h3_7 character varying(255),
    events jsonb,
    description text,
    features jsonb,
    images jsonb
);



CREATE TABLE public.property_type_map (
    uprn character varying(255) NOT NULL,
    property_types_raw text[] NOT NULL,
    property_types_clean character varying(255) NOT NULL,
    hash character varying(255) NOT NULL
);



CREATE TABLE public.rm_api_crawl_runs (
    id integer NOT NULL,
    "timestamp" character varying(255),
    result json
);



CREATE SEQUENCE public.rm_api_crawl_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.rm_api_crawl_runs_id_seq OWNED BY public.rm_api_crawl_runs.id;



CREATE TABLE public.rm_code_map (
    code character varying(255) NOT NULL
);



CREATE TABLE public.title_metadata (
    id character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    postcode character varying(255) NOT NULL,
    tenure character varying(255) NOT NULL,
    date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    meta jsonb NOT NULL,
    availability jsonb NOT NULL
);



CREATE TABLE public.title_uprn_map (
    uprn character varying(255) NOT NULL,
    title character varying(255) NOT NULL
);



CREATE TABLE public.uprn_metadata (
    uprn character varying(255) NOT NULL,
    lat numeric(15,12),
    lon numeric(15,12),
    parent_uprn character varying(255),
    osm jsonb
);



CREATE TABLE public.uprn_nsul (
    uprn character varying(255) NOT NULL,
    easting integer,
    northing integer,
    lat numeric(12,8),
    lon numeric(12,8),
    postcode character varying(255),
    oa21 character varying(255),
    lsoa21 character varying(255),
    msoa21 character varying(255),
    wd23 character varying(255),
    pcon23 character varying(255),
    lad23 character varying(255),
    ttwa15 character varying(255),
    rgn23 character varying(255),
    ctry23 character varying(255)
);



ALTER TABLE ONLY public.rm_api_crawl_runs ALTER COLUMN id SET DEFAULT nextval('public.rm_api_crawl_runs_id_seq'::regclass);



ALTER TABLE ONLY public.api_clients
    ADD CONSTRAINT api_clients_name_unique UNIQUE (name);



ALTER TABLE ONLY public.api_clients
    ADD CONSTRAINT api_clients_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (key);



ALTER TABLE ONLY public.census_2021_data
    ADD CONSTRAINT census_2021_data_pkey PRIMARY KEY (location_code, key);



ALTER TABLE ONLY public.epc_data_england
    ADD CONSTRAINT epc_data_england_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.epc_recommendations_england
    ADD CONSTRAINT epc_recommendations_england_pkey PRIMARY KEY (certificate_id, item);



ALTER TABLE ONLY public.flood_risk_areas
    ADD CONSTRAINT flood_risk_areas_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hmo_registry_log
    ADD CONSTRAINT hmo_registry_log_pkey PRIMARY KEY (location_code, process_date);



ALTER TABLE ONLY public.hmo_registry_properties
    ADD CONSTRAINT hmo_registry_properties_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hometrack_address_lookup
    ADD CONSTRAINT hometrack_address_lookup_pkey PRIMARY KEY (postcode);



ALTER TABLE ONLY public.idp_addresses
    ADD CONSTRAINT idp_addresses_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.image_map
    ADD CONSTRAINT image_map_id_unique UNIQUE (id);



ALTER TABLE ONLY public.image_map
    ADD CONSTRAINT image_map_pkey PRIMARY KEY (original_url);



ALTER TABLE ONLY public.land_registry_england
    ADD CONSTRAINT land_registry_pkey PRIMARY KEY (transaction_id);



ALTER TABLE ONLY public.lha_rates
    ADD CONSTRAINT lha_rates_pkey PRIMARY KEY (location_name, year);



ALTER TABLE ONLY public.listing_uprn_map
    ADD CONSTRAINT listing_uprn_map_pkey PRIMARY KEY (listing_id);



ALTER TABLE ONLY public.location_statistics_v3
    ADD CONSTRAINT location_statistics_v3_pkey PRIMARY KEY (location_code, location_type, resolution, property_type, bedrooms);



ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (code, type);



ALTER TABLE ONLY public.mercurios_events
    ADD CONSTRAINT mercurios_events_pkey PRIMARY KEY (topic, seq);



ALTER TABLE ONLY public.mercurios_topics
    ADD CONSTRAINT mercurios_topics_pkey PRIMARY KEY (topic);



ALTER TABLE ONLY public.osm_places
    ADD CONSTRAINT osm_places_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.population_projections
    ADD CONSTRAINT population_projections_pkey PRIMARY KEY (code);



ALTER TABLE ONLY public.postcode_map
    ADD CONSTRAINT postcode_map_pkey PRIMARY KEY (postcode);



ALTER TABLE ONLY public.postcode_map
    ADD CONSTRAINT postcode_map_slug_unique UNIQUE (slug);



ALTER TABLE ONLY public.postcode_meta
    ADD CONSTRAINT postcode_meta_pkey PRIMARY KEY (postcode);



ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (uprn);



ALTER TABLE ONLY public.property_listings
    ADD CONSTRAINT property_listings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.property_type_map
    ADD CONSTRAINT property_type_map_pkey PRIMARY KEY (uprn);



ALTER TABLE ONLY public.rm_api_crawl_runs
    ADD CONSTRAINT rm_api_crawl_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.rm_code_map
    ADD CONSTRAINT rm_code_map_pkey PRIMARY KEY (code);



ALTER TABLE ONLY public.title_metadata
    ADD CONSTRAINT title_metadata_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.title_uprn_map
    ADD CONSTRAINT title_uprn_map_pkey PRIMARY KEY (uprn, title);



ALTER TABLE ONLY public.probate_gazette
    ADD CONSTRAINT uk_probate_gazette_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.uprn_nsul
    ADD CONSTRAINT uprn_map_pkey PRIMARY KEY (uprn);



ALTER TABLE ONLY public.uprn_metadata
    ADD CONSTRAINT uprn_metadata_pkey PRIMARY KEY (uprn);



CREATE INDEX api_keys_client_id_index ON public.api_keys USING btree (client_id);



CREATE INDEX epc_data_england_building_reference_number_index ON public.epc_data_england USING btree (building_reference_number);



CREATE INDEX epc_data_england_current_epc_rating_index ON public.epc_data_england USING btree (current_epc_rating);



CREATE INDEX epc_data_england_epc_type_index ON public.epc_data_england USING btree (epc_type);



CREATE INDEX epc_data_england_lodgement_date_index ON public.epc_data_england USING btree (lodgement_date);



CREATE INDEX epc_data_england_postcode_index ON public.epc_data_england USING btree (postcode);



CREATE INDEX epc_data_england_uprn_index ON public.epc_data_england USING btree (uprn);



CREATE INDEX flood_risk_areas_h3_11_gin_idx ON public.flood_risk_areas USING gin (h3_11);



CREATE INDEX flood_risk_areas_h3_9_gin_idx ON public.flood_risk_areas USING gin (h3_9);



CREATE INDEX hmo_registry_properties_address_index ON public.hmo_registry_properties USING btree (address);



CREATE INDEX hmo_registry_properties_date_end_index ON public.hmo_registry_properties USING btree (date_end);



CREATE INDEX hmo_registry_properties_date_start_index ON public.hmo_registry_properties USING btree (date_start);



CREATE INDEX hmo_registry_properties_postcode_index ON public.hmo_registry_properties USING btree (postcode);



CREATE INDEX hmo_registry_properties_uprn_index ON public.hmo_registry_properties USING btree (uprn);



CREATE INDEX idp_addresses_postcode_index ON public.idp_addresses USING btree (postcode);



CREATE INDEX idp_addresses_timestamp_index ON public.idp_addresses USING btree ("timestamp");



CREATE INDEX idp_addresses_udprn_index ON public.idp_addresses USING btree (udprn);



CREATE INDEX idp_addresses_uprn_index ON public.idp_addresses USING btree (uprn);



CREATE INDEX image_map_id_index ON public.image_map USING btree (id);



CREATE INDEX land_registry_england_county_index ON public.land_registry_england USING btree (county);



CREATE INDEX land_registry_england_date_index ON public.land_registry_england USING btree (date);



CREATE INDEX land_registry_england_district_index ON public.land_registry_england USING btree (district);



CREATE INDEX land_registry_england_locality_index ON public.land_registry_england USING btree (locality);



CREATE INDEX land_registry_england_new_build_index ON public.land_registry_england USING btree (new_build);



CREATE INDEX land_registry_england_paon_index ON public.land_registry_england USING btree (paon);



CREATE INDEX land_registry_england_postcode_index ON public.land_registry_england USING btree (postcode);



CREATE INDEX land_registry_england_property_type_index ON public.land_registry_england USING btree (property_type);



CREATE INDEX land_registry_england_saon_index ON public.land_registry_england USING btree (saon);



CREATE INDEX land_registry_england_street_index ON public.land_registry_england USING btree (street);



CREATE INDEX land_registry_england_town_or_city_index ON public.land_registry_england USING btree (town_or_city);



CREATE INDEX land_registry_england_uprn_index ON public.land_registry_england USING btree (uprn);



CREATE INDEX lha_rates_location_code_index ON public.lha_rates USING btree (location_code);



CREATE INDEX listing_uprn_map_inspire_id_index ON public.listing_uprn_map USING btree (inspire_id);



CREATE INDEX listing_uprn_map_uprn_index ON public.listing_uprn_map USING btree (uprn);



CREATE INDEX locations_display_name_gin_trgm ON public.locations USING gin (display_name public.gin_trgm_ops);



CREATE INDEX locations_h3_9_gin_idx ON public.locations USING gin (h3_9);



CREATE INDEX mercurios_events_key_index ON public.mercurios_events USING btree (key);



CREATE INDEX mercurios_events_published_at_index ON public.mercurios_events USING btree ("timestamp");



CREATE INDEX osm_places_category_index ON public.osm_places USING btree (category);



CREATE INDEX osm_places_lat_lon_index ON public.osm_places USING btree (lat, lon);



CREATE INDEX osm_places_osm_type_index ON public.osm_places USING btree (osm_type);



CREATE INDEX osm_places_type_index ON public.osm_places USING btree (type);



CREATE INDEX postcode_map_area_type_code_index ON public.postcode_map USING btree (area_type_code);



CREATE INDEX postcode_map_area_type_group_index ON public.postcode_map USING btree (area_type_group);



CREATE INDEX postcode_map_area_type_subgroup_index ON public.postcode_map USING btree (area_type_subgroup);



CREATE INDEX postcode_map_area_type_supergroup_index ON public.postcode_map USING btree (area_type_supergroup);



CREATE INDEX postcode_map_country_index ON public.postcode_map USING btree (country);



CREATE INDEX postcode_map_county_index ON public.postcode_map USING btree (county);



CREATE INDEX postcode_map_district_index ON public.postcode_map USING btree (district);



CREATE INDEX postcode_map_h3_9_index ON public.postcode_map USING btree (h3_9);



CREATE INDEX postcode_map_msoa21_index ON public.postcode_map USING btree (msoa21);



CREATE INDEX postcode_map_postcode_gin_trgm ON public.postcode_map USING gin (postcode public.gin_trgm_ops);



CREATE INDEX postcode_map_region_index ON public.postcode_map USING btree (region);



CREATE INDEX postcode_map_slug_index ON public.postcode_map USING btree (slug);



CREATE INDEX postcode_map_ttwa_index ON public.postcode_map USING btree (ttwa);



CREATE INDEX postcode_map_urban_type_code_index ON public.postcode_map USING btree (urban_type_code);



CREATE INDEX postcode_map_urban_type_description_index ON public.postcode_map USING btree (urban_type_description);



CREATE INDEX properties_bathrooms_index ON public.properties USING btree (bathrooms);



CREATE INDEX properties_bedrooms_index ON public.properties USING btree (bedrooms);



CREATE INDEX properties_epc_index ON public.properties USING btree (epc);



CREATE INDEX properties_h3_11_index ON public.properties USING btree (h3_11);



CREATE INDEX properties_h3_13_index ON public.properties USING btree (h3_13);



CREATE INDEX properties_h3_15_index ON public.properties USING btree (h3_15);



CREATE INDEX properties_h3_7_index ON public.properties USING btree (h3_7);



CREATE INDEX properties_h3_9_index ON public.properties USING btree (h3_9);



CREATE INDEX properties_last_epc_certificate_date_index ON public.properties USING btree (last_epc_certificate_date);



CREATE INDEX properties_last_transaction_date_index ON public.properties USING btree (last_transaction_date);



CREATE INDEX properties_last_transaction_price_index ON public.properties USING btree (last_transaction_price);



CREATE INDEX properties_lat_index ON public.properties USING btree (lat);



CREATE INDEX properties_lon_index ON public.properties USING btree (lon);



CREATE INDEX properties_num_habitable_rooms_index ON public.properties USING btree (num_habitable_rooms);



CREATE INDEX properties_postcode_index ON public.properties USING btree (postcode);



CREATE INDEX properties_property_type_index ON public.properties USING btree (property_type);



CREATE INDEX properties_type_index ON public.properties USING btree (type);



CREATE INDEX property_listings_active_index ON public.property_listings USING btree (active);



CREATE INDEX property_listings_agent_branch_name_index ON public.property_listings USING btree (agent_branch_name);



CREATE INDEX property_listings_auction_index ON public.property_listings USING btree (auction);



CREATE INDEX property_listings_bathrooms_index ON public.property_listings USING btree (bathrooms);



CREATE INDEX property_listings_bedrooms_index ON public.property_listings USING btree (bedrooms);



CREATE INDEX property_listings_channel_index ON public.property_listings USING btree (channel);



CREATE INDEX property_listings_commercial_index ON public.property_listings USING btree (commercial);



CREATE INDEX property_listings_council_tax_band_index ON public.property_listings USING btree (council_tax_band);



CREATE INDEX property_listings_development_index ON public.property_listings USING btree (development);



CREATE INDEX property_listings_display_size_index ON public.property_listings USING btree (display_size);



CREATE INDEX property_listings_display_status_index ON public.property_listings USING btree (display_status);



CREATE INDEX property_listings_epc_rating_index ON public.property_listings USING btree (epc_rating);



CREATE INDEX property_listings_exit_at_index ON public.property_listings USING btree (exit_at);



CREATE INDEX property_listings_first_crawled_at_index ON public.property_listings USING btree (first_crawled_at);



CREATE INDEX property_listings_first_visible_at_index ON public.property_listings USING btree (first_visible_at);



CREATE INDEX property_listings_furnish_type_index ON public.property_listings USING btree (furnish_type);



CREATE INDEX property_listings_h3_11_index ON public.property_listings USING btree (h3_11);



CREATE INDEX property_listings_h3_7_index ON public.property_listings USING btree (h3_7);



CREATE INDEX property_listings_h3_9_index ON public.property_listings USING btree (h3_9);



CREATE INDEX property_listings_last_added_at_index ON public.property_listings USING btree (last_added_at);



CREATE INDEX property_listings_last_crawled_at_index ON public.property_listings USING btree (last_crawled_at);



CREATE INDEX property_listings_last_price_update_at_index ON public.property_listings USING btree (last_price_update_at);



CREATE INDEX property_listings_lat_lon_index ON public.property_listings USING btree (lat, lon);



CREATE INDEX property_listings_postcode_gin_idx ON public.property_listings USING gin (postcode public.gin_trgm_ops);



CREATE INDEX property_listings_postcode_index ON public.property_listings USING btree (postcode);



CREATE INDEX property_listings_property_subtype_index ON public.property_listings USING btree (property_subtype);



CREATE INDEX property_listings_property_type_index ON public.property_listings USING btree (property_type);



CREATE INDEX property_listings_residential_index ON public.property_listings USING btree (residential);



CREATE INDEX property_listings_students_index ON public.property_listings USING btree (students);



CREATE INDEX property_listings_udprn_index ON public.property_listings USING btree (udprn);



CREATE INDEX property_listings_uprn_index ON public.property_listings USING btree (uprn);



CREATE INDEX property_type_map_hash_index ON public.property_type_map USING btree (hash);



CREATE INDEX title_metadata_postcode_gin_idx ON public.title_metadata USING gin (postcode public.gin_trgm_ops);



CREATE INDEX title_metadata_postcode_index ON public.title_metadata USING btree (postcode);



CREATE INDEX title_metadata_tenure_index ON public.title_metadata USING btree (tenure);



CREATE INDEX title_metadata_title_index ON public.title_metadata USING btree (title);



CREATE INDEX title_uprn_map_title_index ON public.title_uprn_map USING btree (title);



CREATE INDEX title_uprn_map_uprn_index ON public.title_uprn_map USING btree (uprn);



CREATE INDEX uprn_nsul_ctry23_index ON public.uprn_nsul USING btree (ctry23);



CREATE INDEX uprn_nsul_lad23_index ON public.uprn_nsul USING btree (lad23);



CREATE INDEX uprn_nsul_lsoa21_index ON public.uprn_nsul USING btree (lsoa21);



CREATE INDEX uprn_nsul_msoa21_index ON public.uprn_nsul USING btree (msoa21);



CREATE INDEX uprn_nsul_oa21_index ON public.uprn_nsul USING btree (oa21);



CREATE INDEX uprn_nsul_pcon23_index ON public.uprn_nsul USING btree (pcon23);



CREATE INDEX uprn_nsul_postcode_index ON public.uprn_nsul USING btree (postcode);



CREATE INDEX uprn_nsul_rgn23_index ON public.uprn_nsul USING btree (rgn23);



CREATE INDEX uprn_nsul_ttwa15_index ON public.uprn_nsul USING btree (ttwa15);



CREATE INDEX uprn_nsul_wd23_index ON public.uprn_nsul USING btree (wd23);



