import crypto from 'node:crypto';
import webpush from 'web-push';
import { listPlannerItems } from './planner.js';
import { reminderStore } from './reminders.js';

const USERS_KEY = 'nexus:push:users:v1';
const SUBSCRIPTION_PREFIX = 'nexus:push:subscriptions:v1:';
const SENT_PREFIX = 'nexus:push:sent:v1:';
const DELIVERY_WINDOW_MS = 15 * 60 * 1000;
const SENT_TTL_SECONDS = 14 * 24 * 60 * 60;

async function redis(command) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Notification storage is unavailable');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('Notification storage request failed');
  return data.result;
}

function subscriptionKey(user) {
  if (!user) throw new Error('Notification account is required');
  return `${SUBSCRIPTION_PREFIX}${encodeURIComponent(user)}`;
}

function subscriptionId(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
}

function cleanSubscription(value) {
  const endpoint = String(value?.endpoint || '');
  const p256dh = String(value?.keys?.p256dh || '');
  const auth = String(value?.keys?.auth || '');
  let url;try{url=new URL(endpoint);}catch{}
  const trustedHost=url && (['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname) || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com'));
  if (!url || url.protocol!=='https:' || url.port || url.username || url.password || !trustedHost || endpoint.length>2048 || !p256dh || !auth) throw new Error('That device could not enable notifications');
  return { endpoint: endpoint.slice(0, 2048), expirationTime: value.expirationTime || null, keys: { p256dh: p256dh.slice(0, 512), auth: auth.slice(0, 256) } };
}

function parseSubscriptions(raw) {
  const items = [];
  for (let index = 0; index < (raw || []).length; index += 2) {
    try { items.push(JSON.parse(raw[index + 1])); } catch { /* ignore damaged device records */ }
  }
  return items;
}

export function duePushNotifications({ reminders = [], schedule = [], now = Date.now() } = {}) {
  const due = [];
  const insideWindow = (time) => Number.isFinite(time) && time <= now && time >= now - DELIVERY_WINDOW_MS;
  for (const item of reminders) {
    const dueAt = Date.parse(item.due_at);
    if (item.status === 'done' || !insideWindow(dueAt)) continue;
    due.push({
      key: `reminder:${item.id}:${item.due_at}`,
      title: 'Reminder',
      body: item.title,
      url: '/workspace.html?view=reminders',
      tag: `nexus-reminder-${item.id}`,
    });
  }
  for (const item of schedule) {
    if (item.status !== 'planned' || item.all_day) continue;
    const starts = Date.parse(item.starts_at);
    const ends = Date.parse(item.ends_at);
    if (item.reminder_minutes != null) {
      const alertAt = starts - Number(item.reminder_minutes) * 60 * 1000;
      if (insideWindow(alertAt)) due.push({
        key: `schedule-start:${item.id}:${item.starts_at}:${item.reminder_minutes}`,
        title: item.reminder_minutes ? `Starting in ${item.reminder_minutes} minutes` : 'Starting now',
        body: item.title,
        url: '/workspace.html?view=planner',
        tag: `nexus-schedule-start-${item.id}`,
      });
    }
    if (item.end_reminder && insideWindow(ends)) due.push({
      key: `schedule-end:${item.id}:${item.ends_at}`,
      title: 'Planned time is up',
      body: `${item.title} can keep going, or Nex can adjust what comes next.`,
      url: '/workspace.html?view=planner',
      tag: `nexus-schedule-end-${item.id}`,
    });
  }
  return due;
}

export function createPushService({
  command = redis,
  planner = { list: listPlannerItems },
  reminders = reminderStore,
  sender = webpush,
  now = Date.now,
  env = process.env,
} = {}) {
  const configured = () => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  const configureSender = () => {
    if (!configured()) throw new Error('Phone notifications are not configured yet');
    sender.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  };
  async function subscribe(user, value) {
    const subscription = cleanSubscription(value);
    const id = subscriptionId(subscription.endpoint);
    await command(['HSET', subscriptionKey(user), id, JSON.stringify(subscription)]);
    await command(['SADD', USERS_KEY, user]);
    return { enabled: true, id };
  }
  async function unsubscribe(user, endpoint) {
    const value = String(endpoint || '');
    if (value) await command(['HDEL', subscriptionKey(user), subscriptionId(value)]);
    const remaining = Number(await command(['HLEN', subscriptionKey(user)]));
    if (!remaining) await command(['SREM', USERS_KEY, user]);
    return { enabled: remaining > 0 };
  }
  async function status(user) {
    return { configured: configured(), enabled: Number(await command(['HLEN', subscriptionKey(user)])) > 0, publicKey: env.VAPID_PUBLIC_KEY || null };
  }
  async function send(subscription, notification) {
    configureSender();
    return sender.sendNotification(subscription, JSON.stringify(notification), { TTL: 60 * 60, urgency: 'normal' });
  }
  async function test(user) {
    const subscriptions = parseSubscriptions(await command(['HGETALL', subscriptionKey(user)]));
    if (!subscriptions.length) throw new Error('Turn on notifications on this device first');
    await Promise.all(subscriptions.map((subscription) => send(subscription, {
      title: 'Nexus notifications are on',
      body: 'Schedule and Reminder alerts can now reach this device.',
      url: '/workspace.html?view=messages',
      tag: 'nexus-notifications-ready',
    })));
    return { sent: subscriptions.length };
  }
  async function deliverUser(user) {
    const subscriptions = parseSubscriptions(await command(['HGETALL', subscriptionKey(user)]));
    if (!subscriptions.length) return { user, sent: 0, due: 0 };
    const [reminderItems, scheduleItems] = await Promise.all([
      reminders.list(user),
      planner.list({ from: new Date(now() - DELIVERY_WINDOW_MS - 24 * 60 * 60 * 1000).toISOString(), to: new Date(now() + 24 * 60 * 60 * 1000).toISOString() }, user),
    ]);
    const notifications = duePushNotifications({ reminders: reminderItems, schedule: scheduleItems, now: now() });
    let sent = 0;
    for (const notification of notifications) {
      const claimed = await command(['SET', `${SENT_PREFIX}${encodeURIComponent(user)}:${subscriptionId(notification.key)}`, '1', 'NX', 'EX', SENT_TTL_SECONDS]);
      if (claimed !== 'OK') continue;
      for (const subscription of subscriptions) {
        try { await send(subscription, notification); sent += 1; }
        catch (error) {
          if ([404, 410].includes(Number(error?.statusCode))) await unsubscribe(user, subscription.endpoint);
          else console.error('push delivery failed:', error?.message || error);
        }
      }
    }
    return { user, sent, due: notifications.length };
  }
  async function deliverAll() {
    if (!configured()) return { configured: false, users: 0, sent: 0 };
    const users = await command(['SMEMBERS', USERS_KEY]) || [];
    const results = [];
    for (const user of users) {
      try { results.push(await deliverUser(user)); }
      catch (error) { console.error('push user delivery failed:', error?.message || error); }
    }
    return { configured: true, users: users.length, sent: results.reduce((total, item) => total + item.sent, 0) };
  }
  return { subscribe, unsubscribe, status, test, deliverUser, deliverAll };
}

export const pushService = createPushService();
