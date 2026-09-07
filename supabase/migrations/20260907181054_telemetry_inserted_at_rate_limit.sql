alter table "public"."telemetry_weather_fetch" add column "inserted_at" timestamp with time zone not null default now();

CREATE INDEX telemetry_weather_fetch_account_inserted_idx ON public.telemetry_weather_fetch USING btree (account_token_hash, inserted_at);


