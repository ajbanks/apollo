# KPIs 

## General remarks

`part_of_year` gives you the part of the year in units of `part_of_year_resolution`, e.g. `part_of_year_resolution = 'week'` and `part_of_year = 31` means the 31st week of the year. You should always filter or group by `part_of_year_resolution` as `part_of_year` is meaningless without it.

We currently only have rightmove buy, let and land registry england & wales data. The kind of data you're looking at is specified in the `channel` column.

`[x]_change` gives you the dead-reckoned (linearly interpolated) rate of change in column `[x]` since the previous `part_of_year`, i.e., it gives you the `part_of_year_resolution`ly change, e.g. `weekly`. `[x]_change_yoy` is the same but for year-on-year changes.


## Detailed column descriptions:

`agreed`: number of listings withdrawn from sale with reason "let/sale agreed" etc

`bedrooms`: KPIs are for properties with this number of bedrooms (estimated for land registry). `-1` means all properties

`channel`: data source

`cleared`: number of properties that, having been listed some time before, had a final sale appear in the land registry in this time period

`code`: location code

`date_end`: last actual date in this actual sample

`date_start`: first actual date in this actual sample

`entry_to_agreed_days`: median number of days that properties which were `agreed` in this time period had spent listed

`entry_to_cleared_days`: median number of days that properties which were `cleared` in this time period between being listed and a sale appearing on the land registry

`floor_area_sqm`: median floor area in square metres

`name`: name of location

`new_entries`: number of new entries for this channel (e.g. new listings for rightmove, new sales for land registry)

`part_of_year`: part of the year in units of part_of_year_resolution

`part_of_year_resolution`: units for `part_of_year`, e.g. `week`, `month` or `year`. __NB: SQL INJECTION RISK__

`price`: median price of listings that were agreed/cleared in this time period, and unsold properties were most recently active in this time period

`price_per_sqm`: median (price per sqm of floor area). NB: statistically not the same as median(price)/median(floor_area_sqm)

`price_percentile_10`: 10th percentile of price. Other percentiles available; NB: 50th is the same as the median, i.e. `price`

`price_sample_size`: number of properties that made up the `price` data. You want at least 5 properties on between each percentile you pick, i.e. just the median => 10 properties, quartiles (25, 50, 75) => 20 properties, deciles (10, 20, ... 80, 90) => 50 properties, etc.

`type`: type of location code

`year`: year
