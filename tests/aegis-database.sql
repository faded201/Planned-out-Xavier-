-- Controlled simulation: synthetic identities/workers, no network calls, always rollback.
begin;
do $$
declare
 actor_id uuid:=gen_random_uuid(); session_id uuid:=gen_random_uuid(); tenant_id uuid:=gen_random_uuid();
 job_id uuid; g jsonb; r jsonb; signature text; c aegis_private.control;
 key_text text:='simulation-only-gateway-key-not-used-in-production';
begin
 if not (select stopped from aegis_private.control where id) or exists(select 1 from aegis_private.workers) then
   raise exception 'Simulation requires stopped, empty controller';
 end if;
 insert into auth.users(id,aud,role) values(actor_id,'authenticated','authenticated');
 insert into auth.sessions(id,user_id,aal) values(session_id,actor_id,'aal2');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'session_id',session_id,'aal','aal2','role','authenticated')::text,true);
 r:=public.aegis_request(gen_random_uuid(),tenant_id,'simulation','inference',repeat('a',64));
 if r->>'reason'<>'global-stop' then raise exception 'Default-deny failed'; end if;
 begin
   perform public.aegis_command('resume','','simulation unauthorized operator');
   raise exception 'Operator rejection failed';
 exception when insufficient_privilege then null; end;
 insert into aegis_private.operators values(actor_id);
 insert into aegis_private.tenants values(tenant_id,100,100);
 insert into aegis_private.members values(tenant_id,actor_id,array['inference','deploy'],array['private-inference']);
 insert into aegis_private.providers values('simulation',false,100,100);
 insert into aegis_private.workers(id,tenant,provider,zone,actions,endpoint,quarantined,heartbeat,reservation_micros,max_concurrent)
 values('simulation',tenant_id,'simulation','private-inference',array['inference','deploy'],'https://example.invalid/never-called',false,clock_timestamp(),60,4);
 update aegis_private.control set gateway_key_hash=extensions.digest(convert_to(key_text,'UTF8'),'sha256'),daily_micros=100,monthly_micros=100,max_job_micros=60 where id;
 perform public.aegis_command('resume','','simulation enable isolated fixtures');
 r:=public.aegis_request(gen_random_uuid(),tenant_id,'unknown','inference',repeat('a',64));
 if r->>'reason'<>'unknown-worker' then raise exception 'Worker identity failed'; end if;
 r:=public.aegis_request(gen_random_uuid(),gen_random_uuid(),'simulation','inference',repeat('a',64));
 if r->>'reason'<>'tenant-or-permission-denied' then raise exception 'Tenant isolation failed'; end if;
 r:=public.aegis_request(gen_random_uuid(),tenant_id,'simulation','permissions',repeat('a',64));
 if r->>'reason'<>'tenant-or-permission-denied' then raise exception 'Escalation rejection failed'; end if;
 job_id:=gen_random_uuid();
 g:=public.aegis_request(job_id,tenant_id,'simulation','inference',repeat('a',64));
 if g->>'allowed'<>'true' then raise exception 'Grant issue failed: %',g->>'reason'; end if;
 signature:=g->>'signature';
 begin
   perform public.aegis_lease(job_id,signature,repeat('a',64),'consume','wrong');
   raise exception 'Gateway isolation failed';
 exception when insufficient_privilege then null; end;
 r:=public.aegis_lease(job_id,repeat('0',64),repeat('a',64),'consume',key_text);
 if r->>'reason'<>'forged-grant' then raise exception 'Forgery rejection failed'; end if;
 r:=public.aegis_lease(job_id,signature,repeat('b',64),'consume',key_text);
 if r->>'reason'<>'forged-grant' then raise exception 'Input binding failed'; end if;
 r:=public.aegis_lease(job_id,signature,repeat('a',64),'consume',key_text);
 if r->>'allowed'<>'true' then raise exception 'Consumption failed'; end if;
 r:=public.aegis_lease(job_id,signature,repeat('a',64),'consume',key_text);
 if r->>'reason'<>'grant-replay' then raise exception 'Replay rejection failed'; end if;
 r:=public.aegis_request(gen_random_uuid(),tenant_id,'simulation','inference',repeat('a',64));
 if r->>'reason'<>'budget-exhausted' then raise exception 'Budget reservation failed'; end if;
 -- Prior-period unsettled work must still constrain the new accounting period.
 update aegis_private.jobs set created_at=clock_timestamp()-interval '40 days' where id=job_id;
 r:=public.aegis_request(gen_random_uuid(),tenant_id,'simulation','inference',repeat('a',64));
 if r->>'reason'<>'budget-exhausted' then raise exception 'Budget rollover protection failed'; end if;
 perform public.aegis_command('quarantine','simulation','simulation quarantine worker');
 r:=public.aegis_lease(job_id,signature,repeat('a',64),'check',key_text);
 if r->>'reason'<>'execution-revoked' then raise exception 'Active revocation failed'; end if;
 perform public.aegis_command('release','simulation','simulation release worker');
 perform public.aegis_command('lock-provider','simulation','simulation provider lockdown');
 r:=public.aegis_request(gen_random_uuid(),tenant_id,'simulation','inference',repeat('a',64));
 if r->>'reason'<>'provider-locked' then raise exception 'Provider containment failed'; end if;
 perform public.aegis_command('stop','','simulation global stop persists');
 if not (public.aegis_snapshot()->>'stopped')::boolean then raise exception 'Persistent stop failed'; end if;
 -- Check log-chain integrity without exposing its signing material.
 select * into c from aegis_private.control where id;
 if exists(select 1 from aegis_private.events where hash<>encode(extensions.hmac(convert_to(previous_hash||payload::text,'UTF8'),c.signing_key,'sha256'),'hex')) then raise exception 'Audit integrity failed'; end if;
 if exists(select 1 from (select previous_hash,lag(hash,1,repeat('0',64)) over(order by sequence) prior from aegis_private.events)x where previous_hash<>prior) then raise exception 'Audit continuity failed'; end if;
 if has_table_privilege('authenticated','aegis_private.control','SELECT') or has_function_privilege('anon','public.aegis_snapshot()','EXECUTE') then raise exception 'Privilege isolation failed'; end if;
 perform set_config('request.jwt.claims','{}',true);
 begin
   perform public.aegis_request(gen_random_uuid(),tenant_id,'simulation','inference',repeat('a',64));
   raise exception 'Invalid identity accepted';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'AEGIS database simulation passed; all fixtures rolled back' as result;
