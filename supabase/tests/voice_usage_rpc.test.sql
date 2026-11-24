-- pgTAP: quota RPCs from migration 003 (SEC-7, ECON-3, ECON-5, CON-3). Run: supabase test db
begin;
select plan(20);

-- fixture user (profiles.id references auth.users)
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quota-test@example.invalid');
insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000000a1')
on conflict (id) do nothing;

-- SEC-7: privileges
select ok(has_function_privilege('service_role', 'public.reserve_debrief_chars(uuid,integer,integer)', 'execute'), 'service_role can reserve');
select ok(has_function_privilege('service_role', 'public.refund_debrief_chars(uuid,date,integer)', 'execute'), 'service_role can refund');
select ok(has_function_privilege('service_role', 'public.consume_qa_seconds(uuid,integer,integer)', 'execute'), 'service_role can consume');
select ok(not has_function_privilege('authenticated', 'public.reserve_debrief_chars(uuid,integer,integer)', 'execute'), 'authenticated cannot reserve');
select ok(not has_function_privilege('authenticated', 'public.refund_debrief_chars(uuid,date,integer)', 'execute'), 'authenticated cannot refund');
select ok(not has_function_privilege('authenticated', 'public.consume_qa_seconds(uuid,integer,integer)', 'execute'), 'authenticated cannot consume');
select ok(not has_function_privilege('anon', 'public.reserve_debrief_chars(uuid,integer,integer)', 'execute'), 'anon cannot reserve');
select ok(not has_function_privilege('anon', 'public.consume_qa_seconds(uuid,integer,integer)', 'execute'), 'anon cannot consume');
select ok((select prosecdef from pg_proc where oid = 'public.reserve_debrief_chars(uuid,integer,integer)'::regprocedure), 'reserve is SECURITY DEFINER');

-- ECON-3 / CON-3: reserve edge cases (run as the migration owner; privileges verified above)
select is(public.reserve_debrief_chars('00000000-0000-0000-0000-0000000000a1', 400), date_trunc('month', timezone('utc', now()))::date, 'first reserve returns the current UTC month');
update public.voice_usage set debrief_chars_used = 15800 where user_id = '00000000-0000-0000-0000-0000000000a1';
select is(public.reserve_debrief_chars('00000000-0000-0000-0000-0000000000a1', 400), null::date, 'reserve at 15 800 refused');
select is((select debrief_chars_used from public.voice_usage where user_id = '00000000-0000-0000-0000-0000000000a1'), 15800, 'refused reserve changes nothing');
update public.voice_usage set debrief_chars_used = 15600 where user_id = '00000000-0000-0000-0000-0000000000a1';
select isnt(public.reserve_debrief_chars('00000000-0000-0000-0000-0000000000a1', 400), null::date, 'reserve at 15 600 granted');
select is((select debrief_chars_used from public.voice_usage where user_id = '00000000-0000-0000-0000-0000000000a1'), 16000, 'used lands exactly on the cap');
select is(public.reserve_debrief_chars('00000000-0000-0000-0000-0000000000a1', 1, 99999), null::date, 'p_cap above 16000 is clamped');
select throws_ok($$select public.reserve_debrief_chars('00000000-0000-0000-0000-0000000000a1', 401)$$, 'reserve rejects p_chars > 400');

-- refund
select lives_ok($$select public.refund_debrief_chars('00000000-0000-0000-0000-0000000000a1', date_trunc('month', timezone('utc', now()))::date, 350)$$, 'refund works');
select is((select debrief_chars_used from public.voice_usage where user_id = '00000000-0000-0000-0000-0000000000a1'), 15650, 'refund subtracts');

-- ECON-5: Q&A
update public.voice_usage set qa_seconds_used = 250 where user_id = '00000000-0000-0000-0000-0000000000a1';
select results_eq(
  $$select granted, remaining from public.consume_qa_seconds('00000000-0000-0000-0000-0000000000a1', 120)$$,
  $$values (50, 0)$$,
  'consume grants partial to cap'
);
select results_eq(
  $$select granted, remaining from public.consume_qa_seconds('00000000-0000-0000-0000-0000000000a1', 0, 1)$$,
  $$values (0, 0)$$,
  'cap clamps up to 300; 0 seconds reads remaining'
);

select * from finish();
rollback;
