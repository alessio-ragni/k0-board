-- k0 Cloud — the first shape of it.
--
-- The board itself is not modelled here table by table. k0's own database on the machine is where
-- the board's rules live (states, decisions, rounds, dependencies), and it keeps working offline;
-- the cloud is where a copy of every row goes so it survives a lost laptop, reaches a second
-- machine and can be read from a browser. So the cloud stores rows as documents, one per row,
-- keyed by a uid the machine gave it, and a change to k0's tables does not need a change here.
--
-- What the cloud does own is what a single machine cannot: who you are, whether you have been
-- let in, which workspace your rows belong to, and the one counter that numbers your stories
-- across every repository and every machine.

-- ── Accounts ─────────────────────────────────────────────────────────────────
-- One row per person who has signed in, created by the trigger below on their first sign-in.
-- Signing in is not being let in: `approved` is what opens the door, and only an admin sets it.
create table public.accounts (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  name        text,
  avatar_url  text,
  provider    text,
  approved    boolean not null default false,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);

-- ── Workspaces ───────────────────────────────────────────────────────────────
-- Everybody gets a personal one on sign-in. A team is a second kind of workspace with more than
-- one member, which is why the rows hang off a workspace and not off a person: Team is then a
-- new row here and nothing else moves.
create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default '',
  kind       text not null default 'personal' check (kind in ('personal', 'team')),
  owner_id   uuid not null references public.accounts (id) on delete cascade,
  -- The next K number. A counter and not a MAX(), for the same reason as on the machine: a
  -- number is never handed out twice, not after a delete either.
  next_key   integer not null default 1,
  created_at timestamptz not null default now()
);

create table public.memberships (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id   uuid not null references public.accounts (id) on delete cascade,
  role         text not null default 'owner' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, account_id)
);

-- ── Records ──────────────────────────────────────────────────────────────────
-- One row of k0's board, as the machine last wrote it. `seq` moves on every write and only ever
-- forwards, which is what a machine asks with "what changed since I last looked".
create sequence public.records_seq;

create table public.records (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind         text not null check (kind in (
                 'project', 'epic', 'story', 'session', 'decision', 'decision_check',
                 'round', 'check_item', 'dependency', 'story_log')),
  uid          uuid not null,
  data         jsonb not null default '{}'::jsonb,
  deleted      boolean not null default false,
  -- When the machine made the change, in its milliseconds. Two machines that changed the same
  -- row keep the later one; the server's own clock decides nothing about that.
  changed_at   bigint not null default 0,
  machine      text not null default '',
  seq          bigint not null default nextval('public.records_seq'),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, kind, uid)
);

create index records_pull on public.records (workspace_id, seq);

create or replace function public.k0_records_touch() returns trigger
language plpgsql as $$
begin
  new.seq := nextval('public.records_seq');
  new.updated_at := now();
  return new;
end $$;

create trigger records_touch before update on public.records
  for each row execute function public.k0_records_touch();

-- ── Asking for access ────────────────────────────────────────────────────────
-- "Get early access" from somebody who has not signed in: an address and, if they like, a line
-- about what they would use k0 for. Anyone may write one; only an admin may read them.
create table public.access_requests (
  id         bigint generated always as identity primary key,
  email      text not null,
  note       text not null default '',
  created_at timestamptz not null default now(),
  constraint access_requests_email_ok check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 320),
  constraint access_requests_note_short check (length(note) <= 2000)
);
create unique index access_requests_email on public.access_requests (lower(email));

-- ── Who is who ───────────────────────────────────────────────────────────────
-- Security definer so the policies below can ask without recursing into their own tables.
create or replace function public.k0_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from accounts where id = auth.uid()), false)
$$;

create or replace function public.k0_is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select approved from accounts where id = auth.uid()), false)
$$;

create or replace function public.k0_is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join accounts a on a.id = m.account_id
    where m.workspace_id = ws and m.account_id = auth.uid() and a.approved
  )
$$;

-- ── First sign-in ────────────────────────────────────────────────────────────
create or replace function public.k0_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into accounts (id, email, name, avatar_url, provider)
  values (
    new.id,
    new.email,
    coalesce(meta->>'full_name', meta->>'name', meta->>'user_name', ''),
    meta->>'avatar_url',
    coalesce(new.raw_app_meta_data->>'provider', '')
  )
  on conflict (id) do nothing;

  insert into workspaces (name, kind, owner_id) values ('Personal', 'personal', new.id) returning id into ws;
  insert into memberships (workspace_id, account_id, role) values (ws, new.id, 'owner');
  return new;
end $$;

create trigger k0_on_signup after insert on auth.users
  for each row execute function public.k0_on_signup();

-- ── What k0 asks ─────────────────────────────────────────────────────────────

-- Who am I, am I in, and which workspace do my rows go to.
create or replace function public.k0_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'email', a.email, 'name', a.name, 'avatar_url', a.avatar_url,
    'approved', a.approved, 'is_admin', a.is_admin,
    'workspace', (select w.id from workspaces w where w.owner_id = a.id and w.kind = 'personal' limit 1)
  )
  from accounts a where a.id = auth.uid()
$$;

-- The next K number in a workspace: one number, handed out once, whichever machine asks.
create or replace function public.k0_next_key(ws uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not k0_is_member(ws) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  update workspaces set next_key = next_key + 1 where id = ws returning next_key - 1 into n;
  return n;
end $$;

-- A machine that already holds numbers (the one-time move of an existing board) pushes the
-- counter past them, so nothing is ever handed out twice.
create or replace function public.k0_reserve_keys(ws uuid, upto integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not k0_is_member(ws) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  update workspaces set next_key = greatest(next_key, upto + 1) where id = ws returning next_key into n;
  return n;
end $$;

-- Letting somebody in. Admins only.
create or replace function public.k0_set_approved(account uuid, yes boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not k0_is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update accounts set approved = yes, approved_at = case when yes then now() else null end where id = account;
end $$;

-- ── Policies ─────────────────────────────────────────────────────────────────
alter table public.accounts enable row level security;
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.records enable row level security;
alter table public.access_requests enable row level security;

create policy "own account" on public.accounts for select using (id = auth.uid() or public.k0_is_admin());

create policy "own workspaces" on public.workspaces for select using (
  exists (select 1 from public.memberships m where m.workspace_id = id and m.account_id = auth.uid())
);

create policy "own memberships" on public.memberships for select using (account_id = auth.uid());

create policy "members read" on public.records for select using (public.k0_is_member(workspace_id));
create policy "members write" on public.records for insert with check (public.k0_is_member(workspace_id));
create policy "members change" on public.records for update
  using (public.k0_is_member(workspace_id)) with check (public.k0_is_member(workspace_id));

create policy "anyone asks" on public.access_requests for insert to anon, authenticated with check (true);
create policy "admins read requests" on public.access_requests for select using (public.k0_is_admin());

-- Nothing deletes a record: a delete on the machine is `deleted = true` here, so the other
-- machines hear about it instead of keeping a row nobody remembers removing.

grant usage on schema public to anon, authenticated;
grant select on public.accounts, public.workspaces, public.memberships to authenticated;
grant select, insert, update on public.records to authenticated;
grant insert on public.access_requests to anon, authenticated;
grant select on public.access_requests to authenticated;
grant usage on sequence public.records_seq to authenticated;
grant execute on function public.k0_me(), public.k0_next_key(uuid), public.k0_reserve_keys(uuid, integer),
  public.k0_set_approved(uuid, boolean), public.k0_is_admin(), public.k0_is_approved(), public.k0_is_member(uuid)
  to authenticated;
revoke execute on function public.k0_next_key(uuid), public.k0_reserve_keys(uuid, integer),
  public.k0_set_approved(uuid, boolean) from anon, public;
