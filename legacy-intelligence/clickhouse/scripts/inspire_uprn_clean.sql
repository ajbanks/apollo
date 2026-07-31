CREATE TABLE inspire_uprn_clean
ENGINE = MergeTree()
ORDER BY (INSPIREID, uprn)
AS
select any(INSPIREID) INSPIREID, uprn, any(plot_area_sqm) plot_area_sqm from (select INSPIREID, plot_area_sqm, uprn from inspire_uprn_raw iur left join inspire_area_sqm ias on iur.INSPIREID = ias.INSPIREID order by plot_area_sqm asc) group by uprn
