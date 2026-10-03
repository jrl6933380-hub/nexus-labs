export const REMINDER_TOOLS=[
  {name:'read_reminders',description:'Read the signed-in account’s private reminders, including undated tasks and linked Schedule blocks. Use these for things to remember or complete; use Schedule for time allocation. Shared with Nexus Life. Timed alerts currently appear only while Nexus is open.',input_schema:{type:'object',properties:{}}},
  {name:'manage_reminder',description:'Create, edit, complete, reopen, delete, or reserve Schedule time for one private reminder. Get a clear user request before changing records. Do not delete unless explicitly requested: deletion also removes its linked block. For schedule use starts_at and ends_at, preview with apply false, show the open time, then apply true after approval. Scheduling reuses one linked block and rejects overlaps. Completion also updates that block. Never claim background notifications, location triggers, or messaging triggers are supported.',input_schema:{type:'object',properties:{
    action:{type:'string',enum:['create','update','delete','schedule']},id:{type:'string'},title:{type:'string'},notes:{type:'string'},
    due_date:{type:['string','null'],description:'Optional local YYYY-MM-DD date, or null to clear.'},
    due_at:{type:['string','null'],description:'Optional ISO alert time with explicit timezone; provide due_date as the user’s local date. Null clears it.'},
    status:{type:'string',enum:['planned','done']},starts_at:{type:'string'},ends_at:{type:'string'},apply:{type:'boolean'},
  },required:['action']}},
];
