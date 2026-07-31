
CREATE USER <username> WITH PASSWORD '<password>';

GRANT CONNECT ON DATABASE <database_name> TO <username>;
GRANT USAGE ON SCHEMA <database_name> TO <username>;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO <username>;

REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM <username>;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO <username>;
