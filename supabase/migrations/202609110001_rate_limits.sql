-- Fixed-window rate limiting. This RPC is available only to the server-side
-- service-role client; authenticated users cannot consume another user's quota.
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  window_begin timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  current_count integer;
begin
  if p_key is null or char_length(p_key) > 200 then
    raise exception 'INVALID_KEY' using errcode = '22023';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'INVALID_RATE_LIMIT' using errcode = '22023';
  end if;

  insert into public.rate_limits (key, window_start, count)
  values (p_key, window_begin, 1)
  on conflict (key, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into current_count;

  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return query select
    current_count <= p_limit,
    greatest(p_limit - current_count, 0),
    window_begin + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
