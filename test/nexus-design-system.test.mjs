import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');

test('the workspace loads the shared Nexus design system before feature styles',()=>{
  const html=read('../public/workspace.html'),design=html.indexOf('/nexus-design-system.css');
  assert.ok(design>0);
  for(const sheet of ['/schedule-calendar.css','/reminders.css','/life.css','/nexus-messages.css','/team-chat.css'])assert.ok(design<html.indexOf(sheet));
});

test('one semantic identity contract covers products, specialists, and groups',()=>{
  const css=read('../public/nexus-design-system.css');
  for(const identity of ['nex','schedule','reminders','life','projects','groups','research','review']){
    assert.match(css,new RegExp(`--nx-${identity}:`));
    assert.match(css,new RegExp(`data-nx-identity=\\"${identity}\\"`));
  }
  for(const contract of ['--nx-current','--nx-current-wash','.nx-surface','.nx-icon','.nx-status','.nx-action','.nx-action-primary'])assert.ok(css.includes(contract));
});

test('existing product and team surfaces consume the shared identities',()=>{
  assert.match(read('../public/schedule-calendar.css'),/--nx-schedule/);
  assert.match(read('../public/reminders.css'),/--nx-reminders/);
  assert.match(read('../public/life.css'),/--nx-life/);
  const teams=read('../public/team-chat.css');
  assert.match(teams,/--nx-groups/);assert.match(teams,/--nx-projects/);assert.match(teams,/--nx-nex/);
  const messages=read('../public/nexus-messages.css');
  assert.doesNotMatch(messages,/\.tone-schedule\{--accent:#/);assert.match(messages,/--accent:var\(--nx-current/);assert.match(messages,/var\(--accent/);
});
