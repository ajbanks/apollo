#!/bin/julia

using DataFrames, Dates, Statistics, ThreadsX
using IterTools: subsets
include((@__DIR__) * "/../lib.jl")
include((@__DIR__) * "/../cleaning/cleaning.jl")

kpis_lock = ReentrantLock()
function update_kpis()
    trylock(kpis_lock) || return false # doesn't seem to work as expected, it looks like subsequent calls to the api return the same thing?
    try
        @info "Updating properties_collapsed (~10 mins)"
        update_properties()
        @info "Updating KPIs (~3 hours)"
        TABLE_PREFIX = "location_kpis_V3_3"

        epc_type_to_canon = """
        if(
            property_type in ('House', 'Bungalow'), 'house', if(
                property_type in ('Flat', 'Maisonette'), 'flat', 'other'
            )
        ) property_type
        """

        # Create a table of weightings for each property type from EPCs
        # TODO: expand to other geography types
        execute(con(), """
            CREATE TABLE IF NOT EXISTS PROPERTY_TYPE_WEIGHTINGS_HOMES_ENGLAND
            ENGINE = MergeTree()
            ORDER BY (type, code, property_type)
            AS
            select $epc_type_to_canon, type, code, count(*) weight from CANON_EPC_HOMES_ENGLAND EPC
            left join (select h3, type, code from location_h3 where type in ('lad23', 'ctry23') and res = 7) lh3 on h3ToParent(EPC.h3_11, 7) = lh3.h3
            group by all
        """)

        # this should probably go on the database really because it'll get used a lot
        # loc_h3_stats = select_df(con(), "select argMin(res, avg_h3_num) as optimal_h3_res, type from (select type, res, abs(log10(10000) - log10(count(*)/count(distinct(code)))) as avg_h3_num from location_h3 group by type, res order by (type, avg_h3_num)) group by type")

        # messing with CUBE for simon
        known_property_types = [
            "flat",
            "house",
            "detached",
            "semi_detached",
            "terraced",
            "bungalow",
            "end_of_terrace",
            "",
            "maisonette",
            "hmo",
            "caravan",
            "retirement",
        ]


        function gen_grouping_sets_tuple()
            columns = ["type", "channel", "code", "bedrooms", "least_of_5_or_bedrooms", "property_type", "y", "m", "q", "rolling_year"] # NB: every groupable column must appear in this at least once
            always = ["channel", "code", "type"]
            forbiddens = [["bedrooms", "least_of_5_or_bedrooms"], ["m", "q"], map(d->[d, "rolling_year"], ["y", "m", "q"])...] # each element of this list is a list of mutually exclusive columns
            to_remove = Iterators.flatten(map(forbidden -> (Iterators.product(forbidden,forbidden) .|> Set |> unique) |> x -> filter(y -> length(y) >= 2, x), forbiddens))  |> collect
            # why is this the same as
            # Set.(forbiddens)
            Tuple.(Iterators.filter(x -> all(in.(always,Ref(x))) && all(.!issubset.(to_remove, Ref(x))), subsets(columns)))
        end
        tuple2clickhouse(t) = replace(julia2clickhouse(t), "\"" => "", "\'" => "", ",)" => ")")
        gen_grouping_sets() = tuple2clickhouse(gen_grouping_sets_tuple())

        grouping_preamble(date_string = "date") = "channel, bedrooms, if(property_type in $(julia2clickhouse(known_property_types)), property_type, 'other') property_type, toInt16(ceil((toDate($date_string) - today()) / 365)) as rolling_year, toYear($date_string) AS y, toQuarter($date_string) AS q, toMonth($date_string) AS m" # approx

        # quantile stuff
        n_quantiles = 1:19 # end+1 should divide 100 nicely
        v_quantiles = n_quantiles ./ (1+length(n_quantiles))
        str_quantiles = v_quantiles |> x -> join(string.(x), ",")
        quantile_names = "quantiles($str_quantiles)(price) as percentiles," * join(["percentiles[$n] as price_percentile_$(v*100 |> round |> Int)" for (n,v) in zip(n_quantiles, v_quantiles)], ",")
        quantile_names_sqm = "quantiles($str_quantiles)(price/if(total_floor_area > 0, total_floor_area, null)) as percentiles_sqm," * join(["percentiles_sqm[$n] as price_per_sqm_percentile_$(v*100 |> round |> Int)" for (n,v) in zip(n_quantiles, v_quantiles)], ",")
        #quantile stuff ends

        kpi_main_body = """
                $(grouping_preamble("date")),
                min(date) as first_date, max(date) as last_date, any(now()) date_calculated,
                least(5,bedrooms) least_of_5_or_bedrooms,
                median(price) price_median,
                median(price/if(total_floor_area > 0, total_floor_area, null)) price_per_sqm,
                corr(price, bedrooms) price_bedroom_correlation,
                if(isNaN(price_bedroom_correlation), null, greatest(least(1 - (price_bedroom_correlation - 0.3)/(0.8 - 0.3), 1.0), 0.0)) demand_index, -- 0.8 -> low demand, 0.3 -> high demand in [0.0, 1.0]
                median(if(time_in_market > 0, time_in_market, null)) entry_to_agreed_days,
                median(if(time_to_clear > 0, time_to_clear, null)) entry_to_cleared_days,
                count(if(time_in_market > 0, 1, null)) agreed,
                sum(if(time_in_market > 0, price, null)) agreed_total_value,
                count(if(time_to_clear > 0, 1, null)) cleared,
                count(*) sample_size,
                $quantile_names,
                $quantile_names_sqm,
                sample_size - agreed live_listings -- not quite new_entries but maybe good enough?
        """

        kpi_groups_and_settings = """
            group by 
                grouping sets $(gen_grouping_sets())
            settings group_by_use_nulls = 1, max_memory_usage = 400000000000, max_bytes_before_external_group_by = 200000000000, max_bytes_before_external_sort = 200000000000
            -- use disk storage because group by is too big, fails otherwise
            -- https://clickhouse.com/docs/en/sql-reference/statements/select/group-by#group-by-in-external-memory says to set mem limit = 2x disk
        """

        execute(con(), "drop table if exists tmp_$TABLE_PREFIX settings max_table_size_to_drop = 400000000000")
        # execute(con(), "truncate table if exists $TABLE_PREFIX settings max_table_size_to_drop = 100000000000")
        # todo: look at low cardinality https://clickhouse.com/docs/en/sql-reference/data-types/lowcardinality
        # nb: weighting for h3_7 is fake for now
        # select_df(con(), """
        execute(con(), """
            CREATE TABLE tmp_$TABLE_PREFIX
            ENGINE = MergeTree()
            ORDER BY (type, channel, bedrooms, property_type, code, rolling_year, y, q, m)
            SETTINGS allow_nullable_key = 1
            AS
            select substring(lower(hex(h3_7)), 2) as code, 'h3_7' as type, price_median price_median_weighted,
            $(kpi_main_body)
            from properties_collapsed
            $(kpi_groups_and_settings)
        """) # about 25% slower on string h3 # nb cheating wrt cleared etc. means that entry_to_cleared is forward looking from agreement (while including time on market days) while entry_to_agreed is backwards looking

        # same but for locations
        # nb: don't have h3 13 (0x0d) for anything else, need to add it to properties_collapsed)
        loc_h3_stats = DataFrame(
            # optimal_h3_res = UInt8[0x0b, 0x0b, 0x09, 0x09, 0x07, 0x0d, 0x07, 0x09, 0x0b, 0x09, 0x07],
            # type = ["lsoa21", "msoa21", "fuas", "lad23", "ctry23", "oa21", "national", "fuasc", "wd23", "lad21", "rgn23"],
            optimal_h3_res = UInt8[0x09, 0x09, 0x07, 0x07, 0x09, 0x09, 0x09, 0x09, 0x07], # all oas removed due to disk space
            type = ["fuas", "lad23", "ctry23", "national", "fuasc", "wd23", "lad21", "brma25", "rgn23"], # wd23 reduced to resolution 9 from 11 for disk space
        )
        sensible_geographies = ["lad23","fuas","fuasc","rgn23","ctry23","national"] # geographies that aren't tiny

        loc2h3 = Dict(zip(loc_h3_stats.type, loc_h3_stats.optimal_h3_res))

        rm_type_to_canon = """
        if(
            pct.property_type in ('bungalow', 'terraced', 'detached', 'end_of_terrace', 'semi_detached', 'terraced_bungalow'), 'house', if(
                pct.property_type in ('flat', 'maisonette'), 'flat', 'other'
            )
        )
        """

        for type in loc_h3_stats.type # loc_h3_stats.type # rather than a loop try to group by these
        #for type in ["lad23"]
            # execute(con(), """
            #     CREATE TABLE pristine.location_kpis_V3_test_wtf
            #     ENGINE = MergeTree()
            #     ORDER BY (type, channel, bedrooms, property_type, code, rolling_year, y, q, m)
            #     SETTINGS allow_nullable_key = 1
            #     AS
            #
            #
            # NB: weighted is sometimes different to median even when there are no real weights because it's a slightly different algorithm
            #     default weight is zero -> greatest(weight,1) ensures that if there's no weight we still count it, albeit in a tiny way if there are any real weights
            # weighting feels like a fundamentally bad idea - obviously e.g. rental and buying markets will be different properties
            # could add rental (social) -> RES_LET from epc, i guess
            try
                execute(con(), """
                    insert into tmp_$TABLE_PREFIX
                    select code, type, medianExactWeighted(price, greatest(weight,1)) price_median_weighted, 
                    $(kpi_main_body)
                    from (select code, type, h3 from location_h3 where res = $(loc2h3[type]) and type = '$type') lhi inner join properties_collapsed pct on lhi.h3 = pct.h3_$(loc2h3[type])
                    left join (select type type_t, code code_t, weight, property_type property_type_t from PROPERTY_TYPE_WEIGHTINGS_HOMES_ENGLAND) w on lhi.type = w.type_t and lhi.code = w.code_t and w.property_type_t = $rm_type_to_canon
                    $(kpi_groups_and_settings)
                """)
                @info "$type done"
            catch (e)
                @warn "$type failed with $e"
            end
        end

        # todo:
        # - sanity check, do not exchange if check fails
        execute(con(), "exchange TABLES $TABLE_PREFIX and tmp_$TABLE_PREFIX")
        # execute(con(), "drop table if exists tmp_$TABLE_PREFIX settings max_table_size_to_drop = 400000000000") # if we're ok keeping the old one alive this isn't needed


        # new_listings only. annoying that we have to do a separate pass but i don't think there's any other way
        execute(con(), """drop table if exists tmp_$(TABLE_PREFIX)_new_listings settings max_table_size_to_drop = 100000000000""")
        execute(con(), """
            CREATE TABLE tmp_$(TABLE_PREFIX)_new_listings
            ENGINE = MergeTree()
            ORDER BY (type, channel, bedrooms, property_type, code, rolling_year, y, q, m)
            SETTINGS allow_nullable_key = 1
            AS
            select substring(lower(hex(h3_7)), 2) as code, 'h3_7' as type,
            count(*) new_listings,
            $(grouping_preamble("listed_date")),
            least(5,bedrooms) least_of_5_or_bedrooms
            from (select distinct id, * from properties_collapsed where channel != 'LREW_BUY') pc
            $(kpi_groups_and_settings)
        """)

        for type in sensible_geographies
            try
                execute(con(), """
                    insert into tmp_$(TABLE_PREFIX)_new_listings
                    select code, type,
                    count(*) new_listings,
                    $(grouping_preamble("listed_date")),
                    least(5,bedrooms) least_of_5_or_bedrooms
                    from (select code, type, h3 from location_h3 where res = $(loc2h3[type]) and type = '$type') lhi inner join (select distinct id, * from properties_collapsed where channel != 'LREW_BUY') pct on lhi.h3 = pct.h3_$(loc2h3[type])
                    $(kpi_groups_and_settings)
                """)
                @info "$type done"
            catch (e)
                @warn "$type failed with $e"
            end
        end
        execute(con(), "exchange TABLES $(TABLE_PREFIX)_new_listings and tmp_$(TABLE_PREFIX)_new_listings")

        # falling in price events
        reduction_body = """
            select rd.date, pc.channel channel, pc.* from (select * from (SELECT
                    id,
                    event_timestamp as date,
                    channel,
                    price,
                    date_diff('hours', previous_date, date) hours_passed,
                    lagInFrame(price, 1, -1) OVER (PARTITION BY channel, id ORDER BY date) AS previous_price,
                    lagInFrame(date, 1, Date('1990-01-01')) OVER (PARTITION BY channel, id ORDER BY date) AS previous_date
                FROM
                    (select * from rm_listing_events rle where channel != 'LREW_BUY') pc
                ORDER BY
                    id, date)
                    where (price < previous_price and price > previous_price * 0.5) -- exclude obvious typo correction
                    and (1*24 <= hours_passed and hours_passed < 100*24) -- wait at least a day
                    ) rd
                    left join properties_collapsed pc on rd.id = pc.id
        """
        execute(con(), """drop table if exists tmp_$(TABLE_PREFIX)_price_reductions settings max_table_size_to_drop = 100000000000""")
        execute(con(), """
            CREATE TABLE tmp_$(TABLE_PREFIX)_price_reductions
            ENGINE = MergeTree()
            ORDER BY (type, channel, bedrooms, property_type, code, rolling_year, y, q, m)
            SETTINGS allow_nullable_key = 1
            AS
            select substring(lower(hex(h3_7)), 2) as code, 'h3_7' as type,
            count(*) num_reductions,
            $(grouping_preamble("date")),
            least(5,bedrooms) least_of_5_or_bedrooms
            from ($reduction_body)
            $(kpi_groups_and_settings)
        """)

        for type in sensible_geographies
            try
                execute(con(), """
                    insert into tmp_$(TABLE_PREFIX)_price_reductions
                    select code, type,
                    count(*) num_reductions,
                    $(grouping_preamble("date")),
                    least(5,bedrooms) least_of_5_or_bedrooms
                    from (select code, type, h3 from location_h3 where res = $(loc2h3[type]) and type = '$type') lhi inner join (
                        $reduction_body
                    ) pct on lhi.h3 = pct.h3_$(loc2h3[type])
                    $(kpi_groups_and_settings)
                """)
                @info "$type done"
            catch (e)
                @warn "$type failed with $e"
            end
        end
        execute(con(), "exchange TABLES $(TABLE_PREFIX)_price_reductions and tmp_$(TABLE_PREFIX)_price_reductions")

        # todo: make DRY, expand to other geography types if it doesn't make disc size explode

        falling_through_body = """
            select rd.date, pc.channel channel, pc.* from (
            select * from (SELECT
                    id,
                    event_timestamp as date,
                    display_status,
                    lagInFrame(display_status, 1, '') OVER (PARTITION BY channel, id ORDER BY event_timestamp) AS previous_status,
                    lagInFrame(event_timestamp, 1, Date('1990-01-01')) OVER (PARTITION BY channel, id ORDER BY event_timestamp) AS previous_date,
                    date_diff('hours', previous_date, event_timestamp) hours_passed	
                FROM (select * from rm_listing_events rle where channel in ('RES_BUY', 'RES_NEW'))
                ORDER BY event_timestamp desc)
            where (display_status = '' and previous_status in ('Sold STC', 'Sold STCM', 'Under offer'))
            and (24 < hours_passed and hours_passed < 24*270)) rd -- exclude typos and reuse of same listing
            left join properties_collapsed pc on rd.id = pc.id
        """
        execute(con(), """drop table if exists tmp_$(TABLE_PREFIX)_sales_falling_through settings max_table_size_to_drop = 100000000000""")
        execute(con(), """
            CREATE TABLE tmp_$(TABLE_PREFIX)_sales_falling_through
            ENGINE = MergeTree()
            ORDER BY (type, channel, bedrooms, property_type, code, rolling_year, y, q, m)
            SETTINGS allow_nullable_key = 1
            AS
            select substring(lower(hex(h3_7)), 2) as code, 'h3_7' as type,
            count(*) num_sales_falling_through,
            $(grouping_preamble("date")),
            least(5,bedrooms) least_of_5_or_bedrooms
            from ($falling_through_body)
            $(kpi_groups_and_settings)
        """)

        for type in sensible_geographies
            try
                execute(con(), """
                    insert into tmp_$(TABLE_PREFIX)_sales_falling_through	
                    select code, type,
                    count(*) num_sales_falling_through,
                    $(grouping_preamble("date")),
                    least(5,bedrooms) least_of_5_or_bedrooms
                    from (select code, type, h3 from location_h3 where res = $(loc2h3[type]) and type = '$type') lhi inner join (
                    $falling_through_body
                    ) pct on lhi.h3 = pct.h3_$(loc2h3[type])
                    $(kpi_groups_and_settings)
                """)
                @info "$type done"
            catch (e)
                @warn "$type failed with $e"
            end
        end
        execute(con(), "exchange TABLES $(TABLE_PREFIX)_sales_falling_through and tmp_$(TABLE_PREFIX)_sales_falling_through")

        # # yoy changes lazily
        # k = filter(t -> "y" in t && !("m" in t) && !("q" in t), gen_grouping_sets_tuple()) # TODO: this is dangerous, will break as soon as there's e.g. week or day added

        # t = gen_grouping_sets_tuple()
        # all_grouping_keys = Set(collect(Iterators.flatten(t)))
        # g_notime = setdiff(all_grouping_keys, ["y", "m", "q", "rolling_year"])
        # narrowing = map(g -> "WHERE $(join(g, " IS NOT NULL AND ")) IS NOT NULL AND $(join(setdiff(all_grouping_keys,g), " IS NULL AND ")) IS NULL", k)
        # all_columns = names(select_df(con(), """select * from $(TABLE_PREFIX) limit 1"""))
        # aggregates = setdiff(all_columns, all_grouping_keys) # maybe i can use first_date - previous_date as the divisor?

        # aggregateToDiff(aggregate; nullish="0", good_bound=">", date_string="first_date") = """
        #     lagInFrame($aggregate, 1, $nullish) OVER (partition by $(tuple2clickhouse(g_notime)) order by $date_string) as previous_$aggregate,
        #     if(previous_$aggregate $good_bound $nullish, $aggregate - previous_$aggregate, NULL) as $(aggregate)_change,
        # """

        # todo: use other narrowings, do not copy all columns needlessly
        # execute(con(), "drop table if exists tmp_$(TABLE_PREFIX)_changes settings max_table_size_to_drop = 400000000000")
        # execute(con(), """
        #     CREATE TABLE tmp_$(TABLE_PREFIX)_changes
        #     ENGINE = MergeTree()
        #     ORDER BY (type, channel, bedrooms, property_type, code, rolling_year, y, q, m)
        #     SETTINGS allow_nullable_key = 1
        #     AS
        #     select * from (
        #     select 
        #     lagInFrame(first_date, 1, Date('1990-01-01')) OVER (partition by $(tuple2clickhouse(g_notime)) order by first_date) as previous_date,
        #     lagInFrame(last_date, 1, Date('1990-01-01')) OVER (partition by $(tuple2clickhouse(g_notime)) order by first_date) as previous_last_date,
        #     date_diff('days', previous_date, first_date) days_passed,
        #     date_diff('days', previous_last_date, last_date) last_days_passed,
        #     $(join(aggregateToDiff.(["price_median", "price_per_sqm", "price_bedroom_correlation", "entry_to_agreed_days", "entry_to_cleared_days", "agreed", "agreed_total_value", "cleared", "sample_size", "live_listings", "demand_index"])))
        #     *
        #     from (select * from $(TABLE_PREFIX) $(narrowing[1]))
        #     ) where days_passed between 365-30 and 365+30 and last_days_passed between 365-30 and 365+30 -- ensure only ~entire years are kept
        # """)
        # execute(con(), "exchange TABLES $(TABLE_PREFIX)_changes and tmp_$(TABLE_PREFIX)_changes")

        # # TODO: these extra tables need first_ and last_ date equivalents
        # for (table, column) in zip(["$(TABLE_PREFIX)_price_reductions", "$(TABLE_PREFIX)_sales_falling_through", "$(TABLE_PREFIX)_new_listings"], ["num_reductions", "num_sales_falling_through", "new_listings"])
        #     execute(con(), "drop table if exists tmp_$(table)_changes settings max_table_size_to_drop = 400000000000")
        #     execute(con(), """
        #         CREATE TABLE tmp_$(table)_changes
        #         ENGINE = MergeTree()
        #         ORDER BY (type, channel, bedrooms, property_type, code, rolling_year, y, q, m)
        #         SETTINGS allow_nullable_key = 1
        #         AS
        #         select * from (
        #         select 
        #         --lagInFrame(first_date, 1, Date('1990-01-01')) OVER (partition by $(tuple2clickhouse(g_notime)) order by first_date) as previous_date,
        #         --lagInFrame(last_date, 1, Date('1990-01-01')) OVER (partition by $(tuple2clickhouse(g_notime)) order by first_date) as previous_last_date,
        #         --date_diff('days', previous_date, first_date) days_passed,
        #         --date_diff('days', previous_last_date, last_date) last_days_passed,
        #         $(aggregateToDiff(column; date_string="(y, q, m)"))
        #         *
        #         from (select * from $table $(narrowing[1]))
        #         ) where y between 2023 and 2024 -- ensure only entire years are kept (TODO: add first_ and last_ date equivalents because this will stop working)
        #     """)
        #     execute(con(), "exchange TABLES $(table) and tmp_$(table)")
        # end

    finally
        unlock(kpis_lock)
    end
    return true
    # i think KPIs are now done
    # next job: AVM
end
