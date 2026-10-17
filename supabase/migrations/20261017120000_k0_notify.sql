-- Tell somebody when somebody arrives. A new early-access request, and a new account waiting to be
-- let in, each call the `notify` edge function, which sends the emails (see
-- supabase/functions/notify). The call goes through pg_net, so it never holds up the insert that
-- caused it: a request is saved even if the email cannot be sent.
--
-- The secret the function checks is kept in Supabase Vault under the name `k0_hook_secret`, put
-- there once by hand, so it is in neither this file nor the repository.
create extension if not exists pg_net with schema extensions;

create or replace function public.k0_notify(payload jsonb) returns void
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'k0_hook_secret' limit 1);
begin
  if secret is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://pegjzrbsogextluajmjm.supabase.co/functions/v1/notify',
    body := payload,
    headers := jsonb_build_object('content-type', 'application/json', 'x-k0-hook', secret)
  );
end $$;

revoke execute on function public.k0_notify(jsonb) from public, anon, authenticated;

create or replace function public.k0_on_access_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform k0_notify(jsonb_build_object('kind', 'access_request', 'email', new.email, 'note', new.note));
  return new;
end $$;

create trigger k0_on_access_request after insert on public.access_requests
  for each row execute function public.k0_on_access_request();

create or replace function public.k0_on_account() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.approved then
    perform k0_notify(jsonb_build_object('kind', 'account', 'email', new.email, 'name', new.name, 'provider', new.provider));
  end if;
  return new;
end $$;

create trigger k0_on_account after insert on public.accounts
  for each row execute function public.k0_on_account();
