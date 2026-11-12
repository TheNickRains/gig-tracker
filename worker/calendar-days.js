function dayInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric',month:'2-digit',day:'2-digit' }).format(date);
}
function eventDays(event, timeZone, from, until) {
  if (event.status === 'cancelled' || event.transparency === 'transparent' || (event.summary || '').includes('(Gig Collective)')) return [];
  const first = event.start?.date || (event.start?.dateTime && dayInZone(new Date(event.start.dateTime), timeZone));
  let last;
  if (event.end?.date) last = new Date(Date.parse(event.end.date + 'T00:00:00Z') - 86400000).toISOString().slice(0,10);
  else if (event.end?.dateTime) last = dayInZone(new Date(Date.parse(event.end.dateTime) - 1), timeZone);
  else last = first;
  if (!first || !last) return [];
  const days = [];
  for (let day = first < from ? from : first; day <= last && day <= until; day = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0,10)) days.push(day);
  return days;
}
module.exports = { dayInZone, eventDays };
