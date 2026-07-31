CREATE USER OR REPLACE public_web
IDENTIFIED WITH sha256_password by 'a2hkayBzZGlsO2RqIHNsayBsYWpzZCBmbGogc2Rsa2og'
SETTINGS 
readonly = 1,
limit = 1000000, -- 1M rows
max_memory_usage_for_user = 1000000000, -- 1GB
output_format_arrow_compression_method = 'none';
-- todo:
-- consider CPU limit
-- try to force aggregation
-- add short query timeout

-- NB: needs clickhouse client >= 24.10
GRANT SELECT ON transitous_* TO public_web;
GRANT SELECT ON public_* TO public_web;

CREATE QUOTA OR REPLACE quota_public FOR INTERVAL 2 minute MAX failed_sequential_authentications = 3 TO public_web;


-- todo: add quota for admin account, but add emergency admin account only accessible via localhost first
-- CREATE QUOTA OR REPLACE quota_admin FOR INTERVAL 2 minute MAX failed_sequential_authentications = 3 TO admin;
