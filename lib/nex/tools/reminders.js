export const REMINDER_TOOLS=[
  {name:'read_reminders',description:'Read the signed-in account’s private reminders, including undated tasks and linked Schedule blocks. Use these for things to remember or complete; use Schedule for time allocation. Shared with Nexus Life. In-app alerts work while Nexus is open. Phone alerts additionally require an enabled device and configured push delivery; do not claim delivery without confirmation.',input_schema:{type:'object',properties:{}}},
  {name:'manage_reminder',description:'Create, edit, complete, reopen, delete, or reserve Schedule time for one private reminder. Get a clear user request before changing records. Do not delete unless explicitly requested: deletion also removes its linked block. For schedule use starts_at and ends_at, preview with apply false, show the open time, then apply true after approval. Scheduling reuses one linked block and rejects overlaps. Completion also updates that block. Phone alerts require the user to enable notifications on a supported device and configured push delivery; do not promise delivery without verification. Location and messaging triggers are not supported.',input_schema:{type:'object',properties:{
    action:{type:'string',enum:['create','update','delete','schedule']},id:{type:'string'},title:{type:'string'},notes:{type:'string'},
    due_date:{type:['string','null'],description:'Optional local YYYY-MM-DD date, or null to clear.'},
    due_at:{type:['string','null'],description:'Optional ISO alert time with explicit timezone; provide due_date as the user’s local date. Null clears it.'},
    repeat:{type:'string',enum:['none','daily','weekly'],description:'Recurring reminder: completing it creates one next occurrence; requires due_date.'},
    timezone:{type:'string',description:'IANA timezone for the reminder, such as America/Chicago. Keeps a recurring alert at the same local time through clock changes.'},
    status:{type:'string',enum:['planned','done']},starts_at:{type:'string'},ends_at:{type:'string'},apply:{type:'boolean'},
  },required:['action']}},
];
