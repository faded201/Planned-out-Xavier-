-- Additive, stopped-by-default controller. No cloud resources or worker credentials.
create schema if not exists aegis_private;
revoke all on schema aegis_private from public, anon, authenticated;
create table aegis_private.control (
 id boolean primary key default true check(id), stopped boolean not null default true,
 epoch bigint not null default 1, policy_version text not null default 'aegis-1',
 signing_key bytea not null default extensions.gen_random_bytes(32),
 gateway_key_hash bytea,
 daily_micros bigint not null default 0 check(daily_micros>=0),
 monthly_micros bigint not null default 0 check(monthly_micros>=0),
 max_job_micros bigint not null default 0 check(max_job_micros>=0),
 daily_gpu_seconds bigint not null default 0 check(daily_gpu_seconds>=0),
 monthly_gpu_seconds bigint not null default 0 check(monthly_gpu_seconds>=0),
 max_gpu_jobs integer not null default 0 check(max_gpu_jobs>=0),
 audit_head text not null default repeat('0',64)
);
insert into aegis_private.control(id) values(true);
create table aegis_private.operators (actor uuid primary key references auth.users(id));
create table aegis_private.tenants (
 id uuid primary key, daily_micros bigint not null default 0 check(daily_micros>=0),
 monthly_micros bigint not null default 0 check(monthly_micros>=0)
);
create table aegis_private.members (
 tenant uuid references aegis_private.tenants(id), actor uuid references auth.users(id),
 actions text[] not null default '{}', zones text[] not null default '{}', primary key(tenant,actor)
);
create table aegis_private.providers (
 id text primary key, locked boolean not null default true,
 daily_micros bigint not null default 0 check(daily_micros>=0),
 monthly_micros bigint not null default 0 check(monthly_micros>=0)
);
create table aegis_private.workers (
 id text primary key check(id ~ '^[a-zA-Z0-9_-]{1,64}$'),
 tenant uuid not null references aegis_private.tenants(id),
 provider text not null references aegis_private.providers(id),
 zone text not null check(zone in ('public-inference','private-inference','vision-media','audio-speech','autonomous-tools','infrastructure','billing')),
 actions text[] not null default '{}', endpoint text not null,
 quarantined boolean not null default true, heartbeat timestamptz,
 principal uuid references auth.users(id),
 max_concurrent integer not null default 1 check(max_concurrent between 1 and 32),
 reservation_micros bigint not null default 0 check(reservation_micros>=0),
 gpu_seconds integer not null default 0 check(gpu_seconds between 0 and 3600),
 timeout_ms integer not null default 30000 check(timeout_ms between 1000 and 120000)
);
create table aegis_private.jobs (
 id uuid primary key, actor uuid not null, tenant uuid not null,
 worker_id text not null references aegis_private.workers(id), provider text not null,
 zone text not null, action text not null, input_digest text not null,
 target text not null, epoch bigint not null, policy_version text not null,
 state text not null check(state in ('pending','issued','running','completed','failed','revoked')),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 run_until timestamptz, reservation_micros bigint not null default 0,
 gpu_seconds integer not null default 0, reserved boolean not null default false,
 signature text, approved_by uuid, approval_expires timestamptz,
 settled_micros bigint, settled_at timestamptz, outcome text
);
create index aegis_jobs_budget on aegis_private.jobs(created_at) where reserved;
create index aegis_jobs_worker on aegis_private.jobs(worker_id,state);
create table aegis_private.events (
 sequence bigint generated always as identity primary key,
 at timestamptz not null default clock_timestamp(), actor uuid,
 tenant uuid, request_id uuid, worker_id text, action text, decision text not null,
 severity text not null, policy_version text not null, reservation_micros bigint,
 previous_hash text not null, hash text not null, payload jsonb not null
);
create index aegis_events_actor on aegis_private.events(actor,at);

-- Private functions are only called through explicit authenticated RPC wrappers.
create function aegis_private.identity() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(auth.jwt()->>'is_anonymous','false')<>'true'
 and exists(select 1 from auth.users where id=auth.uid())
 and exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' and (not_after is null or not_after>now()));
$$;
create function aegis_private.operator(p_mfa boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select aegis_private.identity() and exists(select 1 from aegis_private.operators where actor=auth.uid())
 and (not p_mfa or coalesce(auth.jwt()->>'aal','')='aal2');
$$;
create function aegis_private.event(p_decision text,p_severity text,p_job uuid default null,p_context jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare c aegis_private.control; j aegis_private.jobs; b jsonb; h text;
begin
 select * into c from aegis_private.control where id for update;
 select * into j from aegis_private.jobs where id=p_job;
 b:=jsonb_build_object('at',clock_timestamp(),'actor',auth.uid(),'tenant',j.tenant,
 'requestId',p_job,'correlationId',p_job,'workerId',j.worker_id,'action',j.action,
 'target',j.target,'decision',p_decision,'severity',p_severity,'policyVersion',c.policy_version,
 'reservationMicros',j.reservation_micros,'outcome',j.state,'context',p_context);
 h:=encode(extensions.hmac(convert_to(c.audit_head||b::text,'UTF8'),c.signing_key,'sha256'),'hex');
 insert into aegis_private.events(actor,tenant,request_id,worker_id,action,decision,severity,policy_version,reservation_micros,previous_hash,hash,payload)
 values(auth.uid(),j.tenant,p_job,j.worker_id,j.action,p_decision,p_severity,c.policy_version,j.reservation_micros,c.audit_head,h,b);
 update aegis_private.control set audit_head=h where id;
 return jsonb_build_object('allowed',false,'reason',p_decision);
end $$;
create function aegis_private.proof(j aegis_private.jobs) returns text
language sql immutable set search_path='' as $$
 select jsonb_build_array(j.id,j.actor,j.tenant,j.worker_id,j.provider,j.zone,j.action,j.input_digest,j.target,j.epoch,j.policy_version,extract(epoch from j.expires_at),j.reservation_micros,j.gpu_seconds)::text;
$$;

create function aegis_private.request(p_id uuid,p_tenant uuid,p_worker text,p_action text,p_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c aegis_private.control; w aegis_private.workers; p aegis_private.providers;
 t aegis_private.tenants; j aegis_private.jobs; n bigint; d timestamptz; m timestamptz;
begin
 if not aegis_private.identity() then raise exception 'authentication-required' using errcode='42501'; end if;
 select * into c from aegis_private.control where id for update;
 if not found then raise exception 'controller-unavailable'; end if;
 select count(*) into n from aegis_private.events where actor=auth.uid() and at>clock_timestamp()-interval '1 minute';
 if n>=20 then return jsonb_build_object('allowed',false,'reason','actor-rate-limit'); end if;
 if c.stopped then return aegis_private.event('global-stop','critical'); end if;
 if p_id is null or p_tenant is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or p_action is null or p_action not in ('inference','read','write','deploy','delete','billing','permissions') then
 return aegis_private.event('invalid-request','warning'); end if;
 select * into w from aegis_private.workers where id=p_worker;
 if not found then return aegis_private.event('unknown-worker','warning'); end if;
 if w.tenant<>p_tenant or not exists(select 1 from aegis_private.members where tenant=p_tenant and actor=auth.uid() and p_action=any(actions) and w.zone=any(zones)) then
 return aegis_private.event('tenant-or-permission-denied','high'); end if;
 if w.quarantined then return aegis_private.event('worker-quarantined','high'); end if;
 if w.heartbeat is null or w.heartbeat<clock_timestamp()-interval '90 seconds' then return aegis_private.event('heartbeat-stale','warning'); end if;
 if not p_action=any(w.actions) then return aegis_private.event('action-denied','high'); end if;
 select * into p from aegis_private.providers where id=w.provider;
 if p.locked then return aegis_private.event('provider-locked','high'); end if;
 select * into j from aegis_private.jobs where id=p_id;
 if found then
   if j.actor<>auth.uid() or j.tenant<>p_tenant or j.worker_id<>p_worker or j.action<>p_action or j.input_digest<>p_digest then return aegis_private.event('request-binding-denied','high'); end if;
   if j.state<>'pending' then return aegis_private.event('grant-replay','high',j.id); end if;
   if j.epoch<>c.epoch or j.target<>w.endpoint then return aegis_private.event('request-revoked','high',j.id); end if;
 else
   insert into aegis_private.jobs(id,actor,tenant,worker_id,provider,zone,action,input_digest,target,epoch,policy_version,state,expires_at)
   values(p_id,auth.uid(),p_tenant,w.id,w.provider,w.zone,p_action,p_digest,w.endpoint,c.epoch,c.policy_version,'pending',clock_timestamp()+interval '5 minutes') returning * into j;
 end if;
 if j.expires_at<clock_timestamp() then return aegis_private.event('request-expired','warning',j.id); end if;
 if p_action in ('write','deploy','delete','billing','permissions') and (j.approved_by is null or j.approval_expires<=clock_timestamp()) then return aegis_private.event('human-approval-required','warning',j.id); end if;
 if (select count(*) from aegis_private.jobs where worker_id=w.id and state in ('issued','running'))>=w.max_concurrent then return aegis_private.event('worker-capacity','warning',j.id); end if;
 select * into t from aegis_private.tenants where id=p_tenant;
 if w.reservation_micros>c.max_job_micros then return aegis_private.event('job-budget-exhausted','high',j.id); end if;
 d:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 m:=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 if exists (
   select 1 from (values(c.daily_micros,d,null::text,null::uuid),(c.monthly_micros,m,null::text,null::uuid),
   (p.daily_micros,d,p.id,null::uuid),(p.monthly_micros,m,p.id,null::uuid),
   (t.daily_micros,d,null::text,t.id),(t.monthly_micros,m,null::text,t.id)) b(lim,since,provider_id,tenant_id)
   where w.reservation_micros+coalesce((select sum(greatest(reservation_micros,coalesce(settled_micros,0))) from aegis_private.jobs
     where reserved and (created_at>=b.since or settled_at>=b.since or settled_at is null) and (b.provider_id is null or provider=b.provider_id) and (b.tenant_id is null or tenant=b.tenant_id)),0)>b.lim
 ) then return aegis_private.event('budget-exhausted','high',j.id); end if;
 if w.gpu_seconds>0 and ((select count(*) from aegis_private.jobs where state in ('issued','running') and gpu_seconds>0)>=c.max_gpu_jobs
 or w.gpu_seconds+coalesce((select sum(gpu_seconds) from aegis_private.jobs where reserved and (created_at>=d or settled_at>=d or settled_at is null)),0)>c.daily_gpu_seconds
 or w.gpu_seconds+coalesce((select sum(gpu_seconds) from aegis_private.jobs where reserved and (created_at>=m or settled_at>=m or settled_at is null)),0)>c.monthly_gpu_seconds) then return aegis_private.event('gpu-budget-exhausted','high',j.id); end if;
 update aegis_private.jobs set state='issued',reserved=true,reservation_micros=w.reservation_micros,gpu_seconds=w.gpu_seconds,
 expires_at=clock_timestamp()+interval '30 seconds',approved_by=null,approval_expires=null where id=j.id returning * into j;
 update aegis_private.jobs set signature=encode(extensions.hmac(convert_to(aegis_private.proof(j),'UTF8'),c.signing_key,'sha256'),'hex') where id=j.id returning * into j;
 perform aegis_private.event('grant-issued','info',j.id);
 return jsonb_build_object('allowed',true,'id',j.id,'signature',j.signature,'expiresAt',j.expires_at,'workerId',j.worker_id,'reservationMicros',j.reservation_micros);
end $$;

create function aegis_private.lease(p_id uuid,p_signature text,p_digest text,p_operation text,p_gateway_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c aegis_private.control; j aegis_private.jobs; w aegis_private.workers; h text;
begin
 if not aegis_private.identity() then raise exception 'authentication-required' using errcode='42501'; end if;
 select * into c from aegis_private.control where id for update;
 if not found then raise exception 'controller-unavailable'; end if;
 if c.gateway_key_hash is null or p_gateway_key is null or octet_length(p_gateway_key)>256 or extensions.digest(convert_to(p_gateway_key,'UTF8'),'sha256') is distinct from c.gateway_key_hash then
 raise exception 'gateway-required' using errcode='42501'; end if;
 select * into j from aegis_private.jobs where id=p_id;
 if not found or j.actor<>auth.uid() then return aegis_private.event('grant-identity-denied','high'); end if;
 h:=encode(extensions.hmac(convert_to(aegis_private.proof(j),'UTF8'),c.signing_key,'sha256'),'hex');
 if p_signature is null or p_signature<>h or j.signature<>h or p_digest is distinct from j.input_digest then return aegis_private.event('forged-grant','critical',j.id); end if;
 select * into w from aegis_private.workers where id=j.worker_id;
 if c.stopped or j.epoch<>c.epoch or j.policy_version<>c.policy_version or w.quarantined or w.endpoint<>j.target or w.provider<>j.provider or w.tenant<>j.tenant or w.zone<>j.zone or not j.action=any(w.actions)
 or w.heartbeat is null or w.heartbeat<clock_timestamp()-interval '90 seconds'
 or not exists(select 1 from aegis_private.providers where id=j.provider and not locked)
 or not exists(select 1 from aegis_private.members where actor=j.actor and tenant=j.tenant and j.action=any(actions) and j.zone=any(zones)) then
 update aegis_private.jobs set state='revoked' where id=j.id;
 return aegis_private.event('execution-revoked','critical',j.id); end if;
 if p_operation='consume' then
   if j.state<>'issued' then return aegis_private.event('grant-replay','high',j.id); end if;
   if j.expires_at<=clock_timestamp() then return aegis_private.event('grant-expired','warning',j.id); end if;
   update aegis_private.jobs set state='running',run_until=clock_timestamp()+w.timeout_ms*interval '1 millisecond' where id=j.id returning * into j;
   perform aegis_private.event('execution-started','info',j.id);
 elsif p_operation='check' then
   if j.state<>'running' or j.run_until<=clock_timestamp() then return jsonb_build_object('allowed',false,'reason','execution-expired-or-revoked'); end if;
 elsif p_operation in ('completed','failed') then
   if j.state<>'running' then return jsonb_build_object('allowed',false,'reason','execution-not-running'); end if;
   update aegis_private.jobs set state=p_operation,outcome=p_operation,settled_micros=reservation_micros,settled_at=clock_timestamp() where id=j.id;
   perform aegis_private.event('execution-'||p_operation,'info',j.id);
 else return jsonb_build_object('allowed',false,'reason','invalid-operation'); end if;
 return jsonb_build_object('allowed',true,'endpoint',j.target,'workerId',j.worker_id,'action',j.action,'tenant',j.tenant,'timeoutMs',w.timeout_ms,'runUntil',j.run_until);
end $$;

create function aegis_private.command(p_command text,p_target text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c aegis_private.control;
begin
 if not aegis_private.operator(true) then raise exception 'operator-mfa-required' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,''))) not between 8 and 200 then raise exception 'reason-required'; end if;
 select * into c from aegis_private.control where id for update;
 if p_command='stop' then
 update aegis_private.control set stopped=true,epoch=epoch+1 where id;
 update aegis_private.jobs set state='revoked' where state in ('pending','issued','running');
 elsif p_command='resume' then update aegis_private.control set stopped=false,epoch=epoch+1 where id;
 elsif p_command='quarantine' then
 update aegis_private.workers set quarantined=true where id=p_target;
 update aegis_private.jobs set state='revoked' where worker_id=p_target and state in ('pending','issued','running');
 elsif p_command='release' then update aegis_private.workers set quarantined=false where id=p_target;
 elsif p_command='lock-provider' then
 update aegis_private.providers set locked=true where id=p_target;
 update aegis_private.jobs set state='revoked' where provider=p_target and state in ('pending','issued','running');
 elsif p_command='unlock-provider' then update aegis_private.providers set locked=false where id=p_target;
 elsif p_command='approve' then
 update aegis_private.jobs set approved_by=auth.uid(),approval_expires=clock_timestamp()+interval '60 seconds'
 where id=p_target::uuid and state='pending' and expires_at>clock_timestamp() and epoch=c.epoch;
 if not found then raise exception 'approval-target-invalid'; end if;
 elsif p_command='revoke' then update aegis_private.jobs set state='revoked' where id=p_target::uuid;
 else raise exception 'unknown-command'; end if;
 perform aegis_private.event('operator-'||p_command,'high',case when p_command in ('approve','revoke') then p_target::uuid else null end,jsonb_build_object('target',left(p_target,100),'reason',p_reason));
 return jsonb_build_object('ok',true,'command',p_command);
end $$;

create function aegis_private.snapshot() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c aegis_private.control;
begin
 if not aegis_private.operator(false) then raise exception 'operator-required' using errcode='42501'; end if;
 select * into c from aegis_private.control where id;
 return jsonb_build_object('stopped',c.stopped,'queuePaused',c.stopped,'epoch',c.epoch,'policyVersion',c.policy_version,
 'dailyLimitMicros',c.daily_micros,'monthlyLimitMicros',c.monthly_micros,
 'dailyReservedMicros',coalesce((select sum(greatest(reservation_micros,coalesce(settled_micros,0))) from aegis_private.jobs where reserved and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0),
 'workers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'provider',provider,'zone',zone,'quarantined',quarantined,'heartbeat',heartbeat,'maxConcurrent',max_concurrent)) from aegis_private.workers),'[]'::jsonb),
 'providers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'locked',locked,'dailyLimitMicros',daily_micros)) from aegis_private.providers),'[]'::jsonb),
 'jobs',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,worker_id,zone,action,state,created_at,expires_at,reservation_micros from aegis_private.jobs order by created_at desc limit 100)x),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(x)) from (select sequence,at,worker_id,action,decision,severity,hash from aegis_private.events order by sequence desc limit 100)x),'[]'::jsonb));
end $$;

create function public.aegis_request(p_id uuid,p_tenant uuid,p_worker text,p_action text,p_digest text) returns jsonb
language sql security invoker set search_path='' as $$ select aegis_private.request(p_id,p_tenant,p_worker,p_action,p_digest); $$;
create function public.aegis_lease(p_id uuid,p_signature text,p_digest text,p_operation text,p_gateway_key text) returns jsonb
language sql security invoker set search_path='' as $$ select aegis_private.lease(p_id,p_signature,p_digest,p_operation,p_gateway_key); $$;
create function public.aegis_command(p_command text,p_target text,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select aegis_private.command(p_command,p_target,p_reason); $$;
create function public.aegis_snapshot() returns jsonb
language sql security invoker set search_path='' as $$ select aegis_private.snapshot(); $$;

do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='aegis_private' loop
 execute format('alter table aegis_private.%I enable row level security',r.tablename);
 end loop;
end $$;
revoke all on all tables in schema aegis_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema aegis_private from public,anon,authenticated,service_role;
revoke all on all functions in schema aegis_private from public,anon,authenticated,service_role;
grant usage on schema aegis_private to authenticated;
grant execute on function aegis_private.request(uuid,uuid,text,text,text),aegis_private.lease(uuid,text,text,text,text),aegis_private.command(text,text,text),aegis_private.snapshot() to authenticated;
revoke all on function public.aegis_request(uuid,uuid,text,text,text),public.aegis_lease(uuid,text,text,text,text),public.aegis_command(text,text,text),public.aegis_snapshot() from public,anon,service_role;
grant execute on function public.aegis_request(uuid,uuid,text,text,text),public.aegis_lease(uuid,text,text,text,text),public.aegis_command(text,text,text),public.aegis_snapshot() to authenticated;
