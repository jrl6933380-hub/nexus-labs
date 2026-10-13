export const calendarState={date:new Date(),mode:'list'};
export function openCalendarAt(ctx,item){
 const date=new Date(item.starts_at);if(!Number.isFinite(+date))return ctx.go('planner');
 const state=ctx.calendarState || calendarState;
 state.date=date;state.mode='day';state.timelineScrollTop=Math.max(0,date.getHours()-1)*80;state.timelineScrollLeft=undefined;
 return ctx.go('planner');
}
