create or replace function public.update_project(p_project_id uuid, p_name text, p_description text, p_timezone text) returns table (id uuid, name varchar, description text, timezone varchar, updated_at timestamptz) language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); project_row public.projects%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role in ('owner', 'admin')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'INVALID_PROJECT_NAME' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 2000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  if p_timezone is null or char_length(trim(p_timezone)) not between 1 and 64 then raise exception 'INVALID_TIMEZONE' using errcode = '22023'; end if;
  update public.projects set name = trim(p_name), description = nullif(trim(p_description), ''), timezone = trim(p_timezone) where id = p_project_id and deleted_at is null returning * into project_row;
  if not found then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value) values (p_project_id, current_user_id, 'project', p_project_id, 'updated', jsonb_build_object('name', project_row.name));
  return query select project_row.id, project_row.name, project_row.description, project_row.timezone, project_row.updated_at;
end; $$;
revoke all on function public.update_project(uuid, text, text, text) from public;
grant execute on function public.update_project(uuid, text, text, text) to authenticated;
