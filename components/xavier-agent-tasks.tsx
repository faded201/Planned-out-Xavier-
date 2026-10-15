'use client';
import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import styles from './xavier-agent-tasks.module.css';
type Task = { id:string; goal:string; target:string; status:string; events:string[]; result?:string; pending?:{name:string;arguments:string} };
export function XavierAgentTasks() {
  const [open,setOpen]=useState(false); const [goal,setGoal]=useState(''); const [target,setTarget]=useState('windows');
  const [origins,setOrigins]=useState(''); const [tasks,setTasks]=useState<Task[]>([]); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const api=useCallback(async(method:string,body?:unknown)=>{
    const session=await getSupabase()?.auth.getSession(); const token=session?.data.session?.access_token;
    if(!token)throw new Error('Sign in as the owner to use agent tasks.');
    const response=await fetch('/api/agent/tasks',{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Task service unavailable');return result;
  },[]);
  const refresh=useCallback(async()=>{try{const result=await api('GET');setTasks(result.tasks);setError('');}catch(e){setError(e instanceof Error?e.message:'Unable to load tasks');}},[api]);
  useEffect(()=>{if(!open)return;void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[open,refresh]);
  async function action(id:string,action:string){setBusy(true);try{await api('PATCH',{id,action});await refresh();}catch(e){setError(e instanceof Error?e.message:'Task action failed');}finally{setBusy(false);}}
  return <section className={styles.panel}>
    <button type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>Agent tasks {open?'−':'+'}</button>
    {open&&<div>
      <form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await api('POST',{goal,target,origins:origins.split(/\s+/).filter(Boolean)});setGoal('');await refresh();}catch(err){setError(err instanceof Error?err.message:'Unable to create task');}finally{setBusy(false);}}}>
        <label>Goal<textarea required maxLength={8000} value={goal} onChange={e=>setGoal(e.target.value)}/></label>
        <label>Run on<select value={target} onChange={e=>setTarget(e.target.value)}><option value="windows">Windows PC</option><option value="cloud">Cloud (when worker is configured)</option></select></label>
        <label>Allowed website origins<input placeholder="https://example.com" value={origins} onChange={e=>setOrigins(e.target.value)}/></label>
        <button disabled={busy||!goal.trim()} type="submit">Start task</button>
      </form>
      {error&&<p role="alert">{error}</p>}
      <div aria-live="polite">{tasks.map(task=><article key={task.id}>
        <h3>{task.goal}</h3><p>{task.target} · {task.status}</p>
        {task.pending&&task.status==='approval'&&<div><strong>{task.pending.name}</strong><pre>{task.pending.arguments}</pre><button disabled={busy} onClick={()=>void action(task.id,'approve')}>Approve action</button></div>}
        {task.result&&<p>{task.result}</p>}
        <details><summary>Activity</summary>{task.events.map((event,i)=><pre key={i}>{event}</pre>)}</details>
        {!['completed','failed','cancelled'].includes(task.status)&&<button disabled={busy} onClick={()=>void action(task.id,'cancel')}>Cancel task</button>}
      </article>)}</div>
    </div>}
  </section>;
}
