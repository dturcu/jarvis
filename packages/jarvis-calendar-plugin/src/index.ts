import { Type } from "@sinclair/typebox";
import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginToolContext,
  type PluginCommandContext
} from "openclaw/plugin-sdk/plugin-entry";
import {
  CALENDAR_TOOL_NAMES,
  CALENDAR_COMMAND_NAMES,
  getJarvisState,
  safeJsonParse,
  submitCalendarListEvents,
  submitCalendarCreateEvent,
  submitCalendarUpdateEvent,
  submitCalendarFindFree,
  submitCalendarBrief,
  toCommandReply,
  toToolResult,
  type CalendarListEventsParams,
  type CalendarCreateEventParams,
  type CalendarUpdateEventParams,
  type CalendarFindFreeParams,
  type CalendarBriefParams,
  type ToolResponse
} from "@jarvis/shared";

type CalendarCommandArgs = {
  operation: "list" | "create" | "update" | "find_free" | "brief";
  calendar_id?: string;
  start_date?: string;
  end_date?: string;
  max_results?: number;
  query?: string;
  event_id?: string;
  title?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  attendees?: string[];
  send_invites?: boolean;
  send_updates?: boolean;
  duration_minutes?: number;
  start_search?: string;
  end_search?: string;
  working_hours_only?: boolean;
  include_history?: boolean;
};

type MeetingsCommandArgs = {
  start_date?: string;
  end_date?: string;
  calendar_id?: string;
  query?: string;
};

function createCalendarTool(
  ctx: OpenClawPluginToolContext,
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  submit: (ctx: OpenClawPluginToolContext | undefined, params: any) => ToolResponse,
): AnyAgentTool {
  return {
    name,
    label,
    description,
    parameters,
    execute: async (_toolCallId, params) => toToolResult(submit(ctx, params))
  };
}

export function createCalendarTools(ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  return [
    createCalendarTool(
      ctx,
      "calendar_list_events",
      "Calendar List Events",
      "List events in a calendar within a specified date range, with optional text search.",
      Type.Object({
        calendar_id: Type.Optional(Type.String({ description: "Calendar ID. Defaults to 'primary'." })),
        start_date: Type.String({ description: "Start of date range (ISO datetime)." }),
        end_date: Type.String({ description: "End of date range (ISO datetime)." }),
        max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Maximum events to return. Default 50." })),
        query: Type.Optional(Type.String({ minLength: 1, description: "Text search filter for event title/description." }))
      }),
      (toolCtx, params: CalendarListEventsParams) => submitCalendarListEvents(toolCtx, params)
    ),
    createCalendarTool(
      ctx,
      "calendar_create_event",
      "Calendar Create Event",
      "Create a new calendar event. Requires approval before any invites are sent.",
      Type.Object({
        title: Type.String({ minLength: 1, description: "Event title." }),
        start: Type.String({ description: "Event start time (ISO datetime)." }),
        end: Type.String({ description: "Event end time (ISO datetime)." }),
        description: Type.Optional(Type.String({ description: "Event description or agenda." })),
        location: Type.Optional(Type.String({ description: "Event location or meeting link." })),
        attendees: Type.Optional(Type.Array(Type.String(), { description: "Attendee email addresses." })),
        calendar_id: Type.Optional(Type.String({ description: "Target calendar ID. Defaults to 'primary'." })),
        send_invites: Type.Optional(Type.Boolean({ description: "Send calendar invites to attendees." }))
      }),
      (toolCtx, params: CalendarCreateEventParams) => submitCalendarCreateEvent(toolCtx, params)
    ),
    createCalendarTool(
      ctx,
      "calendar_update_event",
      "Calendar Update Event",
      "Modify an existing calendar event. Conditionally requires approval based on scope of change.",
      Type.Object({
        event_id: Type.String({ minLength: 1, description: "ID of the event to update." }),
        calendar_id: Type.Optional(Type.String({ description: "Calendar containing the event." })),
        title: Type.Optional(Type.String({ description: "New event title." })),
        start: Type.Optional(Type.String({ description: "New start time (ISO datetime)." })),
        end: Type.Optional(Type.String({ description: "New end time (ISO datetime)." })),
        description: Type.Optional(Type.String({ description: "New description." })),
        location: Type.Optional(Type.String({ description: "New location." })),
        send_updates: Type.Optional(Type.Boolean({ description: "Send update notifications to attendees." }))
      }),
      (toolCtx, params: CalendarUpdateEventParams) => submitCalendarUpdateEvent(toolCtx, params)
    ),
    createCalendarTool(
      ctx,
      "calendar_find_free",
      "Calendar Find Free Slots",
      "Find available meeting slots that work for all specified attendees.",
      Type.Object({
        attendees: Type.Array(Type.String(), { description: "Attendee email addresses to check availability for." }),
        duration_minutes: Type.Integer({ minimum: 5, description: "Required slot duration in minutes." }),
        start_search: Type.String({ description: "Start of search window (ISO datetime)." }),
        end_search: Type.String({ description: "End of search window (ISO datetime)." }),
        working_hours_only: Type.Optional(Type.Boolean({ description: "Restrict results to working hours (9am–6pm)." }))
      }),
      (toolCtx, params: CalendarFindFreeParams) => submitCalendarFindFree(toolCtx, params)
    ),
    createCalendarTool(
      ctx,
      "calendar_brief",
      "Calendar Meeting Brief",
      "Generate a meeting preparation brief for an event, including key topics, recommended agenda, and attendee context.",
      Type.Object({
        event_id: Type.String({ minLength: 1, description: "ID of the event to brief." }),
        calendar_id: Type.Optional(Type.String({ description: "Calendar containing the event." })),
        include_history: Type.Optional(Type.Boolean({ description: "Include past interaction history with attendees." }))
      }),
      (toolCtx, params: CalendarBriefParams) => submitCalendarBrief(toolCtx, params)
    )
  ];
}

function formatJobReply(response: ToolResponse): string {
  const parts = [response.summary];
  if (response.job_id) {
    parts.push(`job=${response.job_id}`);
  }
  if (response.approval_id) {
    parts.push(`approval=${response.approval_id}`);
  }
  return parts.join(" | ");
}

function parseJsonArgs<T>(ctx: PluginCommandContext): T | null {
  return safeJsonParse<T>(ctx.args);
}

function toToolContext(ctx: PluginCommandContext): OpenClawPluginToolContext {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    messageChannel: ctx.channel,
    requesterSenderId: ctx.senderId
  };
}

function invalidJsonReply(commandName: string) {
  return toCommandReply(`Invalid JSON arguments for /${commandName}.`, true);
}

export function createCalendarCommand() {
  return {
    name: "calendar",
    description: "Manage calendar events (list, create, update, find free slots, brief) with JSON arguments.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<CalendarCommandArgs>(ctx);
      if (!args) {
        return invalidJsonReply("calendar");
      }

      const toolCtx = toToolContext(ctx);

      switch (args.operation) {
        case "list": {
          const response = submitCalendarListEvents(toolCtx, {
            calendarId: args.calendar_id,
            startDate: args.start_date ?? new Date().toISOString(),
            endDate: args.end_date ?? new Date(Date.now() + 7 * 86400000).toISOString(),
            maxResults: args.max_results,
            query: args.query
          });
          return toCommandReply(formatJobReply(response));
        }
        case "create": {
          if (!args.title || !args.start || !args.end) {
            return toCommandReply("Usage: /calendar {\"operation\":\"create\",\"title\":\"...\",\"start\":\"...\",\"end\":\"...\"}", true);
          }
          const response = submitCalendarCreateEvent(toolCtx, {
            title: args.title,
            start: args.start,
            end: args.end,
            description: args.description,
            location: args.location,
            attendees: args.attendees,
            calendarId: args.calendar_id,
            sendInvites: args.send_invites
          });
          return toCommandReply(formatJobReply(response));
        }
        case "update": {
          if (!args.event_id) {
            return toCommandReply("Usage: /calendar {\"operation\":\"update\",\"event_id\":\"...\"}", true);
          }
          const response = submitCalendarUpdateEvent(toolCtx, {
            eventId: args.event_id,
            calendarId: args.calendar_id,
            title: args.title,
            start: args.start,
            end: args.end,
            description: args.description,
            location: args.location,
            sendUpdates: args.send_updates
          });
          return toCommandReply(formatJobReply(response));
        }
        case "find_free": {
          if (!args.attendees || !args.duration_minutes || !args.start_search || !args.end_search) {
            return toCommandReply("Usage: /calendar {\"operation\":\"find_free\",\"attendees\":[...],\"duration_minutes\":60,\"start_search\":\"...\",\"end_search\":\"...\"}", true);
          }
          const response = submitCalendarFindFree(toolCtx, {
            attendees: args.attendees,
            durationMinutes: args.duration_minutes,
            startSearch: args.start_search,
            endSearch: args.end_search,
            workingHoursOnly: args.working_hours_only
          });
          return toCommandReply(formatJobReply(response));
        }
        case "brief": {
          if (!args.event_id) {
            return toCommandReply("Usage: /calendar {\"operation\":\"brief\",\"event_id\":\"...\"}", true);
          }
          const response = submitCalendarBrief(toolCtx, {
            eventId: args.event_id,
            calendarId: args.calendar_id,
            includeHistory: args.include_history
          });
          return toCommandReply(formatJobReply(response));
        }
        default:
          return toCommandReply(
            `Unsupported /calendar operation: ${String((args as CalendarCommandArgs).operation)}. Valid: list, create, update, find_free, brief.`,
            true
          );
      }
    }
  };
}

export function createMeetingsCommand() {
  return {
    name: "meetings",
    description: "Quick alias to list upcoming meetings. Accepts optional JSON {start_date, end_date, query}.",
    acceptsArgs: true,
    handler: (ctx: PluginCommandContext) => {
      const args = parseJsonArgs<MeetingsCommandArgs>(ctx) ?? {};
      const toolCtx = toToolContext(ctx);
      const now = new Date().toISOString();
      const weekOut = new Date(Date.now() + 7 * 86400000).toISOString();
      const response = submitCalendarListEvents(toolCtx, {
        calendarId: args.calendar_id,
        startDate: args.start_date ?? now,
        endDate: args.end_date ?? weekOut,
        query: args.query
      });
      return toCommandReply(formatJobReply(response));
    }
  };
}

export const jarvisCalendarToolNames = [...CALENDAR_TOOL_NAMES];
export const jarvisCalendarCommandNames = [...CALENDAR_COMMAND_NAMES];

export default definePluginEntry({
  id: "jarvis-calendar",
  name: "Jarvis Calendar",
  description: "Calendar management plugin for listing events, creating/updating meetings, finding free slots, and generating meeting briefs",
  register(api) {
    api.registerTool((ctx) => createCalendarTools(ctx));
    api.registerCommand(createCalendarCommand());
    api.registerCommand(createMeetingsCommand());
  }
});
