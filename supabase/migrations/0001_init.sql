-- PromptPay ad-server schema (Postgres, replacing the local SQLite store).
-- These tables are written only by the Edge Function via the service role /
-- direct DB connection, so RLS stays off (no anon access).

create table if not exists creatives (
  campaign_id   text primary key,
  advertiser    text not null,
  text          text not null,
  click_url     text not null,
  icon          text,
  creative_hash text not null,
  created_at     bigint not null
);

create table if not exists challenges (
  nonce      text primary key,
  issued_at  bigint not null,
  expires_at bigint not null,
  used       boolean not null default false
);

create table if not exists usage (
  key          text primary key,
  units        integer not null,
  window_start bigint not null
);

create table if not exists pending (
  campaign_id text not null,
  earner      text not null,
  human_id    text not null,
  impressions integer not null default 0,
  clicks      integer not null default 0,
  updated_at  bigint not null,
  primary key (campaign_id, earner, human_id)
);

create table if not exists receipts (
  receipt_id  text primary key,
  campaign_id text not null,
  earner      text not null,
  human_id    text not null,
  impressions integer not null,
  clicks      integer not null,
  tx_hash     text not null,
  settled_at  bigint not null
);

create table if not exists events_log (
  id          bigserial primary key,
  campaign_id text not null,
  surface     text,
  type        text not null,
  earner      text not null,
  created_at  bigint not null
);

create index if not exists events_log_created_idx on events_log (created_at desc);
create index if not exists receipts_settled_idx on receipts (settled_at desc);

-- Atomic rolling-24h per-key cap with partial acceptance. Returns the number
-- of units accepted (mirrors the SQLite store.acceptUnits logic).
create or replace function accept_units(p_key text, p_units int, p_cap int, p_now bigint)
returns int
language plpgsql
as $$
declare
  v_used int := 0;
  v_window bigint := p_now;
  v_room int;
  v_accepted int;
  v_day constant bigint := 24 * 60 * 60 * 1000;
begin
  select units, window_start into v_used, v_window
  from usage where key = p_key for update;

  if not found or (p_now - v_window) >= v_day then
    v_used := 0;
    v_window := p_now;
  end if;

  v_room := greatest(0, p_cap - v_used);
  v_accepted := least(p_units, v_room);

  insert into usage (key, units, window_start)
  values (p_key, v_used + v_accepted, v_window)
  on conflict (key) do update set units = excluded.units, window_start = excluded.window_start;

  return v_accepted;
end;
$$;
