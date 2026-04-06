import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { getJarvisState } from "./state.js";
import type { ToolResponse } from "./types.js";

export type CalendarListEventsParams = {
  calendarId?: string;
  startDate: string;
  endDate: string;
  maxResults?: number;
  query?: string;
};

export type CalendarCreateEventParams = {
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
  calendarId?: string;
  sendInvites?: boolean;
};

export type CalendarUpdateEventParams = {
  eventId: string;
  calendarId?: string;
  title?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  sendUpdates?: boolean;
};

export type CalendarFindFreeParams = {
  attendees: string[];
  durationMinutes: number;
  startSearch: string;
  endSearch: string;
  workingHoursOnly?: boolean;
};

export type CalendarBriefParams = {
  eventId: string;
  calendarId?: string;
  includeHistory?: boolean;
};

export function submitCalendarListEvents(
  ctx: OpenClawPluginToolContext | undefined,
  params: CalendarListEventsParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "calendar.list_events",
    input: {
      calendar_id: params.calendarId,
      start_date: params.startDate,
      end_date: params.endDate,
      max_results: params.maxResults,
      query: params.query,
    }
  });
}

export function submitCalendarCreateEvent(
  ctx: OpenClawPluginToolContext | undefined,
  params: CalendarCreateEventParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "calendar.create_event",
    input: {
      title: params.title,
      start: params.start,
      end: params.end,
      description: params.description,
      location: params.location,
      attendees: params.attendees,
      calendar_id: params.calendarId,
      send_invites: params.sendInvites,
    }
  });
}

export function submitCalendarUpdateEvent(
  ctx: OpenClawPluginToolContext | undefined,
  params: CalendarUpdateEventParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "calendar.update_event",
    input: {
      event_id: params.eventId,
      calendar_id: params.calendarId,
      title: params.title,
      start: params.start,
      end: params.end,
      description: params.description,
      location: params.location,
      send_updates: params.sendUpdates,
    }
  });
}

export function submitCalendarFindFree(
  ctx: OpenClawPluginToolContext | undefined,
  params: CalendarFindFreeParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "calendar.find_free",
    input: {
      attendees: params.attendees,
      duration_minutes: params.durationMinutes,
      start_search: params.startSearch,
      end_search: params.endSearch,
      working_hours_only: params.workingHoursOnly,
    }
  });
}

export function submitCalendarBrief(
  ctx: OpenClawPluginToolContext | undefined,
  params: CalendarBriefParams,
): ToolResponse {
  return getJarvisState().submitJob({
    ctx,
    type: "calendar.brief",
    input: {
      event_id: params.eventId,
      calendar_id: params.calendarId,
      include_history: params.includeHistory,
    }
  });
}
