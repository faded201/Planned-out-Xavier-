'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import type { PlannerTask } from '@/lib/types';
import { nextOccurrence, type RepeatRule } from '@/lib/recurrence';
import type { LivingLayout } from '@/lib/premium';
import { LivingCalendarArchitecture } from '@/components/living-calendar-architecture';

type CalendarRole = 'viewer' | 'editor';
type CalendarAccess = 'owner' | CalendarRole | 'private';

type SharedCalendar = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  color: string;
  timezone: string;
  created_at: string;
  updated_at: string;
};

type CalendarMember = {
  id: string;
  calendar_id: string;
  owner_id: string;
  user_id: string;
  member_email: string;
  role: CalendarRole;
  joined_at: string;
};

type CalendarInvite = {
  id: string;
  calendar_id: string;
  calendar_name: string;
  owner_id: string;
  invitee_email: string;
  invite_message: string;
  role: CalendarRole;
  created_at: string;
  expires_at: string;
};

type SharedEvent = {
  id: string;
  calendar_id: string;
  owner_id: string;
  created_by: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string;
  notes: string;
  recurrence: RepeatRule;
  created_at: string;
  updated_at: string;
};

type EventForm = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  notes: string;
  recurrence: RepeatRule;
};

type CalendarFeed = { id: string; user_id: string; name: string; url: string };
type FeedEvent = { id: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean; feedName: string };
type CalendarMessage = { id: string; calendar_id: string; user_id: string; body: string; created_at: string };

const EMPTY_FORM: EventForm = {
  title: '',
  date: localDateKey(new Date()),
  startTime: '09:00',
  endTime: '10:00',
  allDay: false,
  location: '',
  notes: '',
  recurrence: 'none'
};

function localDateKey(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthLabel(value: Date) {
  return value.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

function shortTime(value: string) {
  return new Date(value).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

function initials(email: string) {
  return email.trim().slice(0, 2).toUpperCase() || 'ME';
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function toIso(date: string, time: string, endOfDay = false) {
  const safeTime = endOfDay ? '23:59' : time || '09:00';
  return new Date(`${date}T${safeTime}:00`).toISOString();
}

function roleLabel(role: CalendarAccess) {
  if (role === 'owner') return 'Owner';
  if (role === 'editor') return 'Can edit';
  if (role === 'viewer') return 'View only';
  return 'Private';
}

export function CollaborativeCalendar({
  user,
  tasks,
  premium = false,
  livingLayout = 'neural-command',
  onSelectTask,
  onCreateTask,
  onRequestSignIn
}: {
  user: User | null;
  tasks: PlannerTask[];
  premium?: boolean;
  livingLayout?: LivingLayout;
  onSelectTask: (id: string) => void;
  onCreateTask: () => void;
  onRequestSignIn: () => void;
}) {
  const sb = useMemo(() => getSupabase(), []);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [calendars, setCalendars] = useState<SharedCalendar[]>([]);
  const [members, setMembers] = useState<CalendarMember[]>([]);
  const [invites, setInvites] = useState<CalendarInvite[]>([]);
  const [events, setEvents] = useState<SharedEvent[]>([]);
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);
  const [feedName, setFeedName] = useState('Google Calendar');
  const [feedUrl, setFeedUrl] = useState('');
  const [chat, setChat] = useState<CalendarMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [activeCalendarId, setActiveCalendarId] = useState<string>('private');
  const [showPeople, setShowPeople] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState<EventForm>(EMPTY_FORM);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteRole, setInviteRole] = useState<CalendarRole>('viewer');
  const [newCalendarName, setNewCalendarName] = useState('Family Calendar');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const activeCalendar = calendars.find((calendar) => calendar.id === activeCalendarId) || null;
  const myMembership = members.find((member) => member.calendar_id === activeCalendarId && member.user_id === user?.id) || null;
  const access: CalendarAccess = activeCalendar?.owner_id === user?.id ? 'owner' : myMembership?.role || 'private';
  const canEdit = access === 'owner' || access === 'editor';
  const isOwner = access === 'owner';
  const ownedInvites = invites.filter((invite) => invite.owner_id === user?.id && invite.calendar_id === activeCalendarId);
  const incomingInvites = invites.filter((invite) => invite.owner_id !== user?.id);
  const calendarMembers = members.filter((member) => member.calendar_id === activeCalendarId && member.owner_id === user?.id);
  const days = useMemo(() => calendarDays(month), [month]);
  const today = localDateKey(new Date());

  const notify = useCallback((text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 5000);
  }, []);

  const refreshAccess = useCallback(async () => {
    if (!sb || !user) {
      setCalendars([]);
      setMembers([]);
      setInvites([]);
      setEvents([]);
      setFeeds([]);
      setActiveCalendarId('private');
      return;
    }
    const [calendarResult, memberResult, inviteResult, feedsResult] = await Promise.all([
      sb.from('xp_shared_calendars').select('*').order('created_at', { ascending: true }),
      sb.from('xp_calendar_members').select('*').order('joined_at', { ascending: true }),
      sb.from('xp_calendar_invites').select('*').order('created_at', { ascending: false }),
      sb.from('xp_calendar_feeds').select('*').order('created_at', { ascending: true })
    ]);
    const error = calendarResult.error || memberResult.error || inviteResult.error;
    if (error) return notify(error.message);
    const nextCalendars = (calendarResult.data || []) as SharedCalendar[];
    setCalendars(nextCalendars);
    setMembers((memberResult.data || []) as CalendarMember[]);
    setInvites((inviteResult.data || []) as CalendarInvite[]);
    if (!feedsResult.error) {
      const nextFeeds = (feedsResult.data || []) as CalendarFeed[];
      setFeeds((current) => current.length === nextFeeds.length && current.every((feed, index) => feed.id === nextFeeds[index].id && feed.url === nextFeeds[index].url && feed.name === nextFeeds[index].name) ? current : nextFeeds);
    }
    setActiveCalendarId((current) => {
      if (current === 'private') return current;
      return nextCalendars.some((calendar) => calendar.id === current) ? current : 'private';
    });
  }, [notify, sb, user]);

  const refreshEvents = useCallback(async () => {
    if (!sb || !user || activeCalendarId === 'private') {
      setEvents([]);
      return;
    }
    const afterVisible = new Date(days[days.length - 1]);
    afterVisible.setDate(afterVisible.getDate() + 1);
    const { data, error } = await sb
      .from('xp_shared_calendar_events')
      .select('*')
      .eq('calendar_id', activeCalendarId)
      .lt('starts_at', afterVisible.toISOString())
      .order('starts_at', { ascending: false }).limit(5000);
    if (error) return notify(error.message);
    setEvents((data || []) as SharedEvent[]);
  }, [activeCalendarId, days, notify, sb, user]);

  useEffect(() => { void refreshAccess(); }, [refreshAccess]);
  useEffect(() => { void refreshEvents(); }, [refreshEvents]);
  const refreshChat = useCallback(async () => {
    if (!sb || !user || activeCalendarId === 'private') { setChat([]); return; }
    const { data } = await sb.from('xp_calendar_messages').select('*').eq('calendar_id', activeCalendarId).order('created_at', { ascending: false }).limit(100);
    setChat(((data || []) as CalendarMessage[]).reverse());
  }, [sb, user, activeCalendarId]);
  useEffect(() => { void refreshChat(); }, [refreshChat]);
  async function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sb || !user || activeCalendarId === 'private' || !chatInput.trim()) return;
    const { error } = await sb.from('xp_calendar_messages').insert({ calendar_id: activeCalendarId, user_id: user.id, body: chatInput.trim().slice(0, 1000) });
    if (error) return notify(error.message);
    setChatInput(''); await refreshChat();
  }
  useEffect(() => {
    if (!sb || !user || !feeds.length) { setFeedEvents([]); return; }
    let cancelled = false;
    const load = async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) return;
      const from = days[0].toISOString();
      const after = new Date(days[days.length - 1]); after.setDate(after.getDate() + 1);
      const loaded = await Promise.all(feeds.map(async (feed) => {
        const query = new URLSearchParams({ feedId: feed.id, from, to: after.toISOString() });
        const response = await fetch(`/api/calendar/feed?${query}`, { headers: { Authorization: `Bearer ${data.session?.access_token}` } });
        const result = await response.json();
        if (!response.ok) throw new Error(`${feed.name}: ${result.error}`);
        return (result.events as FeedEvent[]).map((item) => ({ ...item, feedName: feed.name }));
      }));
      if (!cancelled) setFeedEvents(loaded.flat());
    };
    void load().catch((error) => { if (!cancelled) notify(error instanceof Error ? error.message : 'Calendar feed unavailable.'); });
    const timer = window.setInterval(() => void load().catch(() => {}), 300000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [sb, user, feeds, days, notify]);

  async function addFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sb || !user) return;
    let candidate: URL;
    try { candidate = new URL(feedUrl.trim().replace(/^webcal:\/\//i, 'https://')); }
    catch { return notify('Paste a valid Google or Outlook iCal link.'); }
    if (candidate.protocol !== 'https:' || !['calendar.google.com', 'www.google.com', 'outlook.live.com', 'outlook.office365.com', 'outlook.office.com', 'outlook.com'].includes(candidate.hostname)) return notify('Only Google and Outlook iCal links are supported.');
    const { error } = await sb.from('xp_calendar_feeds').insert({ user_id: user.id, name: feedName.trim() || 'External calendar', url: candidate.toString() });
    if (error) return notify(error.message);
    setFeedUrl(''); await refreshAccess(); notify('Read-only calendar connected.');
  }
  async function removeFeed(id: string) {
    if (!sb) return;
    const { error } = await sb.from('xp_calendar_feeds').delete().eq('id', id);
    if (error) return notify(error.message);
    await refreshAccess(); notify('Calendar connection removed.');
  }
  useEffect(() => {
    if (!sb || !user) return;
    const channel = sb.channel(`planned-out-calendar-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'xp_shared_calendars' }, () => void refreshAccess())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'xp_calendar_members' }, () => void refreshAccess())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'xp_calendar_invites' }, () => void refreshAccess())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'xp_shared_calendar_events' }, () => void refreshEvents())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'xp_calendar_messages' }, () => void refreshChat())
      .subscribe();
    // A timed refresh also covers projects where Realtime publication is not enabled.
    const timer = window.setInterval(() => { void refreshAccess(); void refreshEvents(); void refreshChat(); }, 30000);
    return () => { window.clearInterval(timer); void sb.removeChannel(channel); };
  }, [sb, user, refreshAccess, refreshEvents, refreshChat]);

  async function createCalendar() {
    if (!sb || !user || !newCalendarName.trim()) return;
    setBusy(true);
    const { data, error } = await sb.from('xp_shared_calendars').insert({
      owner_id: user.id,
      name: newCalendarName.trim(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Brisbane'
    }).select('*').single();
    setBusy(false);
    if (error) return notify(error.message);
    const calendar = data as SharedCalendar;
    await refreshAccess();
    setActiveCalendarId(calendar.id);
    notify(`${calendar.name} created.`);
  }

  function openNewEvent(day?: Date) {
    if (!canEdit || !activeCalendar) return;
    setEditingEventId(null);
    setEventForm({ ...EMPTY_FORM, date: localDateKey(day || new Date()) });
    setShowEvent(true);
  }

  function openExistingEvent(event: SharedEvent) {
    const start = new Date(event.starts_at);
    const end = event.ends_at ? new Date(event.ends_at) : start;
    setEditingEventId(event.id);
    setEventForm({
      title: event.title,
      date: localDateKey(start),
      startTime: start.toTimeString().slice(0, 5),
      endTime: end.toTimeString().slice(0, 5),
      allDay: event.all_day,
      location: event.location,
      notes: event.notes,
      recurrence: event.recurrence || 'none'
    });
    setShowEvent(true);
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sb || !user || !activeCalendar || !canEdit || !eventForm.title.trim()) return;
    setBusy(true);
    const payload = {
      calendar_id: activeCalendar.id,
      owner_id: activeCalendar.owner_id,
      created_by: user.id,
      title: eventForm.title.trim(),
      starts_at: toIso(eventForm.date, eventForm.allDay ? '00:00' : eventForm.startTime),
      ends_at: toIso(eventForm.date, eventForm.allDay ? '23:59' : eventForm.endTime, eventForm.allDay),
      all_day: eventForm.allDay,
      location: eventForm.location.trim(),
      notes: eventForm.notes.trim(),
      recurrence: eventForm.recurrence,
      updated_at: new Date().toISOString()
    };
    const result = editingEventId
      ? await sb.from('xp_shared_calendar_events').update(payload).eq('id', editingEventId)
      : await sb.from('xp_shared_calendar_events').insert(payload);
    setBusy(false);
    if (result.error) return notify(result.error.message);
    setShowEvent(false);
    setEditingEventId(null);
    await refreshEvents();
    notify(editingEventId ? 'Calendar event updated.' : 'Calendar event created.');
  }

  async function deleteEvent() {
    if (!sb || !editingEventId || !canEdit) return;
    setBusy(true);
    const { error } = await sb.from('xp_shared_calendar_events').delete().eq('id', editingEventId);
    setBusy(false);
    if (error) return notify(error.message);
    setShowEvent(false);
    setEditingEventId(null);
    await refreshEvents();
    notify('Calendar event removed.');
  }

  async function sendInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sb || !user || !activeCalendar || !isOwner || !inviteEmail.trim()) return;
    if (inviteEmail.trim().toLowerCase() === user.email?.toLowerCase()) return notify('You already own this calendar.');
    setBusy(true);
    const { data: invitation, error } = await sb.from('xp_calendar_invites').insert({
      calendar_id: activeCalendar.id,
      owner_id: user.id,
      invitee_email: inviteEmail.trim().toLowerCase(),
      invite_message: inviteMessage.trim(),
      role: inviteRole,
      calendar_name: activeCalendar.name
    }).select('id').single();
    setBusy(false);
    if (error) return notify(error.code === '23505' ? 'That person already has a pending invitation.' : error.message);
    setInviteEmail('');
    setInviteMessage('');
    await refreshAccess();
    const { data: session } = await sb.auth.getSession();
    const sent = await fetch('/api/calendar/invite-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session?.access_token || ''}` },
      body: JSON.stringify({ inviteId: invitation.id })
    }).then(async (result) => ({ ok: result.ok, message: (await result.json()).error as string | undefined })).catch(() => ({ ok: false, message: 'Email could not be sent.' }));
    notify(sent.ok ? 'Invitation emailed. They can accept after signing in.' : `${sent.message || 'Email unavailable'} Use Copy link under Pending invitations.`);
  }

  async function acceptInvite(invite: CalendarInvite) {
    if (!sb || !user || !user.email) return;
    setBusy(true);
    const { error } = await sb.from('xp_calendar_members').insert({
      calendar_id: invite.calendar_id,
      owner_id: invite.owner_id,
      user_id: user.id,
      member_email: user.email.toLowerCase(),
      role: invite.role
    });
    if (!error || error.code === '23505') {
      await sb.from('xp_calendar_invites').delete().eq('id', invite.id);
    }
    setBusy(false);
    if (error && error.code !== '23505') return notify(error.message);
    await refreshAccess();
    setActiveCalendarId(invite.calendar_id);
    notify('Invitation accepted.');
  }

  async function declineInvite(inviteId: string) {
    if (!sb) return;
    const { error } = await sb.from('xp_calendar_invites').delete().eq('id', inviteId);
    if (error) return notify(error.message);
    await refreshAccess();
    notify('Invitation declined.');
  }

  async function cancelInvite(inviteId: string) {
    if (!sb || !isOwner) return;
    const { error } = await sb.from('xp_calendar_invites').delete().eq('id', inviteId);
    if (error) return notify(error.message);
    await refreshAccess();
    notify('Invitation cancelled.');
  }

  async function removeMember(memberId: string) {
    if (!sb || !isOwner) return;
    const { error } = await sb.from('xp_calendar_members').delete().eq('id', memberId);
    if (error) return notify(error.message);
    await refreshAccess();
    notify('Member removed. Their calendar access is revoked.');
  }

  async function updateMemberRole(memberId: string, role: CalendarRole) {
    if (!sb || !isOwner) return;
    const { error } = await sb.from('xp_calendar_members').update({ role }).eq('id', memberId);
    if (error) return notify(error.message);
    await refreshAccess();
    notify('Member permission updated.');
  }

  async function shareInvite(invite: CalendarInvite) {
    const url = `${window.location.origin}/?calendarInvite=${encodeURIComponent(invite.id)}`;
    const text = `${invite.invite_message ? `${invite.invite_message}\n\n` : ''}You're invited to ${invite.calendar_name} on Planned Out. Sign in with ${invite.invitee_email} to accept: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Invitation to ${invite.calendar_name}`, text });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      notify('Invite message and link copied. Paste it into a message to the invited person.');
    } catch {
      notify('Could not copy. Check your browser clipboard permission.');
    }
  }

  const privateTasksForDay = (date: string) => tasks.filter((task) => task.startDate === date || task.dueDate === date);
  const sharedEventsForDay = (date: string) => events.filter((event) => {
    const occurrence = localDateKey(new Date(event.starts_at));
    if (occurrence === date) return true;
    if (!event.recurrence || event.recurrence === 'none') return false;
    return nextOccurrence(occurrence, event.recurrence, date) === date;
  });
  const visibleDateKeys = new Set(days.map(localDateKey));
  const visiblePrivateTasks = tasks.filter((task) => visibleDateKeys.has(task.startDate || '') || visibleDateKeys.has(task.dueDate || '')).length;
  const visibleFeedEvents = feedEvents.filter((item) => visibleDateKeys.has(localDateKey(new Date(item.starts_at)))).length;
  const visibleSharedEvents = events.filter((item) => visibleDateKeys.has(localDateKey(new Date(item.starts_at)))).length;
  const todayItemCount = activeCalendarId === 'private'
    ? privateTasksForDay(today).length + feedEvents.filter((item) => localDateKey(new Date(item.starts_at)) === today).length
    : sharedEventsForDay(today).length;
  const visibleItemCount = activeCalendarId === 'private'
    ? visiblePrivateTasks + visibleFeedEvents
    : visibleSharedEvents;

  return <section className={`page calendar-pro-page ${premium ? `calendar-architecture-mode architecture-${livingLayout}` : ''}`}>
    <div className="calendar-pro-hero">
      <div>
        <p className="eyebrow">CALENDAR PLANNER · SHARED ACCESS</p>
        <h2>Plan the month. Bring the right people in.</h2>
        <p>Keep your private planner private, or switch to a shared calendar where the owner controls every invitation, role and removal.</p>
      </div>
      <div className="calendar-pro-hero-actions">
        <button onClick={onCreateTask}>+ Planner task</button>
        {activeCalendar && canEdit && <button className="primary" onClick={() => openNewEvent()}>+ Shared event</button>}
        {activeCalendar && <button onClick={() => setShowPeople(true)}>People &amp; access</button>}
      </div>
    </div>

    {message && <div className="calendar-pro-message">{message}</div>}

    {premium && <LivingCalendarArchitecture
      layout={livingLayout}
      month={monthLabel(month)}
      activeSpace={activeCalendar?.name || 'My Planner'}
      access={activeCalendar ? roleLabel(access) : 'Private'}
      visibleItems={visibleItemCount}
      todayItems={todayItemCount}
    />}

    {incomingInvites.length > 0 && <div className="calendar-invite-banner">
      <div><strong>{incomingInvites.length} calendar invitation{incomingInvites.length === 1 ? '' : 's'}</strong><span>Waiting for your response</span></div>
      <div className="calendar-invite-stack">{incomingInvites.map((invite) => {
        return <div className="calendar-invite-card" key={invite.id}><div><b>{invite.calendar_name || 'Shared calendar'}</b><small>{roleLabel(invite.role)}</small>{invite.invite_message && <p className="calendar-invite-note">{invite.invite_message}</p>}</div><button onClick={() => void declineInvite(invite.id)}>Decline</button><button className="primary" disabled={busy} onClick={() => void acceptInvite(invite)}>Accept</button></div>;
      })}</div>
    </div>}

    <div className="calendar-pro-layout">
      <div className="calendar-pro-main">
        <div className="calendar-pro-toolbar">
          <div className="month-switcher"><button onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>←</button><button onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button><button onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>→</button></div>
          <h3>{monthLabel(month)}</h3>
          <div className="calendar-access-badge"><span className={`access-dot ${access}`} />{activeCalendar ? roleLabel(access) : 'Private planner'}</div>
        </div>
        <div className="calendar-weekdays">{['MON','TUE','WED','THU','FRI','SAT','SUN'].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-month-grid">{days.map((day) => {
          const key = localDateKey(day);
          const isOtherMonth = day.getMonth() !== month.getMonth();
          const privateItems = privateTasksForDay(key).slice(0, 3);
          const externalItems = feedEvents.filter((item) => localDateKey(new Date(item.starts_at)) === key).slice(0, 3);
          const sharedItems = sharedEventsForDay(key).slice(0, 4);
          return <div className={`calendar-pro-day ${isOtherMonth ? 'outside' : ''} ${key === today ? 'today' : ''}`} key={key} onDoubleClick={() => activeCalendar && canEdit && openNewEvent(day)}>
            <div className="calendar-day-head"><b>{day.getDate()}</b>{key === today && <span>Today</span>}</div>
            <div className="calendar-day-items">
              {activeCalendarId === 'private' && privateItems.map((task) => <button className="calendar-item private" key={task.id} onClick={() => onSelectTask(task.id)}><small>{task.startTime || 'Task'}</small><b>{task.title}</b></button>)}
              {activeCalendarId === 'private' && externalItems.map((item) => <div className="calendar-item shared" key={item.id} title={`${item.feedName} · read only`}><small>{item.feedName} · {item.all_day ? 'All day' : shortTime(item.starts_at)}</small><b>{item.title}</b></div>)}
              {activeCalendarId !== 'private' && sharedItems.map((item) => <button className="calendar-item shared" key={item.id} onClick={() => openExistingEvent(item)} style={{ borderLeftColor: activeCalendar?.color || 'var(--accent)' }}><small>{item.all_day ? 'All day' : shortTime(item.starts_at)}</small><b>{item.title}</b></button>)}
            </div>
            {activeCalendar && canEdit && !isOtherMonth && <button className="calendar-day-add" aria-label="Add event" onClick={() => openNewEvent(day)}>+</button>}
          </div>;
        })}</div>
      </div>

      <aside className="calendar-pro-side">
        <div className="calendar-side-section">
          <div className="calendar-side-title"><div><p className="eyebrow">CALENDARS</p><h3>Your spaces</h3></div></div>
          <button className={`calendar-source ${activeCalendarId === 'private' ? 'active' : ''}`} onClick={() => setActiveCalendarId('private')}><span className="calendar-source-icon private">◷</span><div><b>My Planner</b><small>Private tasks &amp; goals</small></div><em>Only me</em></button>
          {activeCalendarId === 'private' && feeds.map((feed) => <div className="calendar-source" key={feed.id}><span className="calendar-source-icon">↗</span><div><b>{feed.name}</b><small>Read-only iCal feed</small></div><button type="button" aria-label={`Disconnect ${feed.name}`} onClick={() => void removeFeed(feed.id)}>×</button></div>)}
          {calendars.map((calendar) => {
            const member = members.find((item) => item.calendar_id === calendar.id && item.user_id === user?.id);
            const calendarAccess: CalendarAccess = calendar.owner_id === user?.id ? 'owner' : member?.role || 'viewer';
            return <button className={`calendar-source ${activeCalendarId === calendar.id ? 'active' : ''}`} key={calendar.id} onClick={() => setActiveCalendarId(calendar.id)}><span className="calendar-source-icon" style={{ background: calendar.color }} /><div><b>{calendar.name}</b><small>{roleLabel(calendarAccess)}</small></div><em>{calendar.owner_id === user?.id ? 'Owner' : 'Shared'}</em></button>;
          })}
        </div>

        {!user ? <div className="calendar-signin-card"><span>◉</span><h3>Sign in to share calendars</h3><p>Your private month still works. Sign in to create shared calendars, invite people and sync shared events.</p><button className="primary" onClick={onRequestSignIn}>Sign in / create account</button></div> : <div className="calendar-side-section">
          <p className="eyebrow">NEW SHARED CALENDAR</p>
          <div className="calendar-create-row"><input value={newCalendarName} onChange={(event) => setNewCalendarName(event.target.value)} placeholder="Calendar name" /><button disabled={busy || !newCalendarName.trim()} onClick={() => void createCalendar()}>Create</button></div>
        </div>}

        

        {activeCalendar && <div className="calendar-side-section calendar-summary-card">
          <span className="calendar-big-dot" style={{ background: activeCalendar.color }} />
          <h3>{activeCalendar.name}</h3>
          <p>{activeCalendar.description || 'A shared planning space for events, commitments and the people who need to see them.'}</p>
          <div className="calendar-summary-meta"><span>{roleLabel(access)}</span><span>{activeCalendar.timezone}</span></div>
          <button onClick={() => setShowPeople(true)}>Manage people &amp; access</button>
        </div>}
        {activeCalendar && <div className="calendar-side-section"><p className="eyebrow">CALENDAR CHAT</p><div className="calendar-people-list" style={{ maxHeight: 220, overflowY: 'auto' }}>{chat.map((item) => <div key={item.id} className="calendar-person-row"><div><b>{item.user_id === user?.id ? 'You' : 'Member'}</b><small>{new Date(item.created_at).toLocaleString('en-AU')}</small><p>{item.body}</p></div></div>)}</div><form onSubmit={sendChat} className="calendar-create-row"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Message your calendar" maxLength={1000} required /><button>Send</button></form></div>}
      </aside>
    </div>

    {showPeople && activeCalendar && <div className="modal"><div className="modal-card calendar-people-modal"><button className="x" onClick={() => setShowPeople(false)}>×</button><p className="eyebrow">PEOPLE &amp; ACCESS</p><h2>{activeCalendar.name}</h2><p className="calendar-modal-intro">The owner controls membership. Removing someone revokes their access to this calendar and its shared events.</p>
      <div className="calendar-owner-row"><div className="member-avatar owner">{isOwner ? initials(user?.email || 'Owner') : 'OW'}</div><div><b>{isOwner ? (user?.email || 'You') : 'Calendar owner'}</b><small>{isOwner ? 'You own this calendar' : 'Owner-managed calendar'}</small></div>{isOwner && <span className="owner-badge">OWNER</span>}</div>
      {isOwner && <form className="calendar-invite-form" onSubmit={sendInvite}><div><label>Invite by email</label><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="person@example.com" required /></div><div><label>Permission</label><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as CalendarRole)}><option value="viewer">View only</option><option value="editor">Can edit</option></select></div><div className="calendar-invite-message-field"><label>Personal message (optional)</label><textarea value={inviteMessage} onChange={(event) => setInviteMessage(event.target.value)} placeholder="Tell them why you're inviting them" maxLength={1000} rows={3} /></div><button className="primary" disabled={busy}>Send invitation</button></form>}
      <div className="calendar-people-list">
        {isOwner && calendarMembers.map((member) => <div className="calendar-person-row" key={member.id}><div className="member-avatar">{initials(member.member_email)}</div><div><b>{member.member_email || 'Member'}</b><small>Joined {new Date(member.joined_at).toLocaleDateString('en-AU')}</small></div><select value={member.role} onChange={(event) => void updateMemberRole(member.id, event.target.value as CalendarRole)}><option value="viewer">View only</option><option value="editor">Can edit</option></select><button className="danger-ghost" onClick={() => void removeMember(member.id)}>Remove</button></div>)}
        {!isOwner && myMembership && <div className="calendar-person-row"><div className="member-avatar">{initials(myMembership.member_email)}</div><div><b>{myMembership.member_email}</b><small>Your access</small></div><span className="role-chip">{roleLabel(myMembership.role)}</span></div>}
      </div>
      {isOwner && ownedInvites.length > 0 && <div className="calendar-pending"><h3>Pending invitations</h3>{ownedInvites.map((invite) => <div className="calendar-pending-row" key={invite.id}><div><b>{invite.invitee_email}</b><small>{roleLabel(invite.role)} · expires {new Date(invite.expires_at).toLocaleDateString('en-AU')}</small></div><button onClick={() => void shareInvite(invite)}>Share message &amp; link</button><button className="danger-ghost" onClick={() => void cancelInvite(invite.id)}>Cancel</button></div>)}</div>}
    </div></div>}

    {showEvent && activeCalendar && <div className="modal">{!canEdit ? <div className="modal-card"><button type="button" className="x" onClick={() => setShowEvent(false)}>×</button><h2>{eventForm.title}</h2><p>{eventForm.date} · {eventForm.allDay ? "All day" : `${eventForm.startTime}–${eventForm.endTime}`}</p><p>{eventForm.location}</p><p>{eventForm.notes}</p>{eventForm.recurrence !== "none" && <p>Repeats {eventForm.recurrence}</p>}</div> : <form className="modal-card calendar-event-modal" onSubmit={saveEvent}><button type="button" className="x" onClick={() => setShowEvent(false)}>×</button><p className="eyebrow">SHARED EVENT</p><h2>{editingEventId ? 'Edit event' : 'Create event'}</h2>{editingEventId && eventForm.recurrence !== 'none' && <p>Editing or deleting this event changes the whole repeating series.</p>}<label className="field"><span>Title</span><input value={eventForm.title} onChange={(event) => setEventForm((form) => ({ ...form, title: event.target.value }))} required /></label><div className="form-grid"><label className="field"><span>Date</span><input type="date" value={eventForm.date} onChange={(event) => setEventForm((form) => ({ ...form, date: event.target.value }))} /></label><label className="calendar-check"><input type="checkbox" checked={eventForm.allDay} onChange={(event) => setEventForm((form) => ({ ...form, allDay: event.target.checked }))} /><span>All day</span></label>{!eventForm.allDay && <><label className="field"><span>Starts</span><input type="time" value={eventForm.startTime} onChange={(event) => setEventForm((form) => ({ ...form, startTime: event.target.value }))} /></label><label className="field"><span>Ends</span><input type="time" value={eventForm.endTime} onChange={(event) => setEventForm((form) => ({ ...form, endTime: event.target.value }))} /></label></>}</div><label className="field"><span>Repeat</span><select value={eventForm.recurrence} onChange={(event) => setEventForm((form) => ({ ...form, recurrence: event.target.value as RepeatRule }))}>{["none","daily","weekly","monthly","yearly"].map((rule) => <option key={rule} value={rule}>{rule}</option>)}</select></label><label className="field"><span>Location</span><input value={eventForm.location} onChange={(event) => setEventForm((form) => ({ ...form, location: event.target.value }))} placeholder="Optional" /></label><label className="field"><span>Notes</span><textarea rows={4} value={eventForm.notes} onChange={(event) => setEventForm((form) => ({ ...form, notes: event.target.value }))} /></label><div className="calendar-modal-actions">{editingEventId && <button type="button" className="danger-ghost" onClick={() => void deleteEvent()}>Delete event</button>}<button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save event'}</button></div></form>}</div>}
  </section>;
}
