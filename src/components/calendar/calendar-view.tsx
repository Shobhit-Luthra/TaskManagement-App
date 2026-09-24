"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  groupByDueDate,
  monthLabel,
  shiftAnchor,
  visibleDays,
  type CalendarView as View,
} from "@/lib/calendar/grid";
import { todayInTimeZone } from "@/lib/filters/timezone";
import { useProjectChannel } from "@/lib/realtime/use-project-channel";
import { CalendarChip, CalendarChipOverlay, CalendarGrid } from "./calendar-grid";
import { useCalendarTasks, type CalendarSource } from "./use-calendar-tasks";

export function CalendarView({
  source,
  initialAnchor,
  timeZone,
  currentUserId,
}: {
  source: CalendarSource;
  initialAnchor: string;
  timeZone?: string;
  currentUserId: string;
}) {
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(initialAnchor);
  const [today, setToday] = useState<string | null>(null);
  // `initialAnchor` is computed server-side (UTC for My Tasks, the project's
  // timezone for a project calendar) before we know the browser's own zone.
  // Near a month boundary those can disagree, so once the browser-zone
  // "today" is known, re-anchor to it -- but only if the user hasn't already
  // navigated away from wherever they started.
  const navigatedRef = useRef(false);
  useEffect(() => {
    const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timer = window.setTimeout(() => {
      const computedToday = todayInTimeZone(new Date(), zone);
      setToday(computedToday);
      if (!navigatedRef.current) setAnchor(computedToday);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [timeZone]);

  const days = useMemo(() => visibleDays(view, anchor), [view, anchor]);
  const calendar = useCalendarTasks(source, { from: days[0]!, to: days[days.length - 1]! });
  const tasksByDay = useMemo(() => groupByDueDate(calendar.tasks), [calendar.tasks]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const activeTask = useMemo(
    () => [...calendar.tasks, ...calendar.undated].find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, calendar.tasks, calendar.undated],
  );

  function onDragStart(event: DragStartEvent) {
    setActiveTaskId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);
    const day: unknown = event.over?.data.current?.day;
    if (typeof day === "string") void calendar.reschedule(String(event.active.id), day);
  }

  function onDragCancel() {
    setActiveTaskId(null);
  }

  const heading =
    view === "month"
      ? monthLabel(anchor)
      : `Week of ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${days[0]}T00:00:00Z`))}`;

  return (
    <section aria-label="Task calendar" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={view === "month" ? "Previous month" : "Previous week"}
            onClick={() => {
              navigatedRef.current = true;
              setAnchor((current) => shiftAnchor(view, current, -1));
            }}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigatedRef.current = true;
              setAnchor(today ?? initialAnchor);
            }}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={view === "month" ? "Next month" : "Next week"}
            onClick={() => {
              navigatedRef.current = true;
              setAnchor((current) => shiftAnchor(view, current, 1));
            }}
          >
            <ChevronRight />
          </Button>
          <h2 className="text-headline-md ml-2 font-serif" aria-live="polite">
            {heading}
          </h2>
        </div>
        <div role="group" aria-label="Calendar range" className="flex gap-1">
          {(["month", "week"] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={view === option ? "default" : "ghost"}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option === "month" ? "Month" : "Week"}
            </Button>
          ))}
        </div>
      </div>
      {calendar.message && (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {calendar.message}
        </p>
      )}
      {calendar.error && (
        <div role="alert" className="mt-3 text-sm">
          <p>The calendar could not be loaded.</p>
          <Button variant="outline" className="mt-2" onClick={calendar.refresh}>
            Try again
          </Button>
        </div>
      )}
      {calendar.loading && (
        <p role="status" className="text-muted-foreground mt-3 text-sm">
          Loading calendar…
        </p>
      )}
      <DndContext
        id="calendar"
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <CalendarGrid
          view={view}
          days={days}
          month={anchor.slice(0, 7)}
          today={today}
          tasksByDay={tasksByDay}
          showProject={source.kind === "me"}
        />
        <details className="mt-4 rounded-xl border p-3" open={calendar.undated.length > 0}>
          <summary className="cursor-pointer text-sm font-medium">
            No due date ({calendar.undated.length})
          </summary>
          <p className="text-muted-foreground mt-1 text-xs">
            Drag a task onto a day to schedule it.
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {calendar.undated.map((task) => (
              <li key={task.id}>
                <CalendarChip task={task} showProject={source.kind === "me"} />
              </li>
            ))}
          </ul>
        </details>
        <DragOverlay>
          {activeTask && (
            <CalendarChipOverlay task={activeTask} showProject={source.kind === "me"} />
          )}
        </DragOverlay>
      </DndContext>
      {source.kind === "project" && (
        <ProjectRealtime
          projectId={source.projectId}
          currentUserId={currentUserId}
          onChange={calendar.refresh}
        />
      )}
    </section>
  );
}

function ProjectRealtime({
  projectId,
  currentUserId,
  onChange,
}: {
  projectId: string;
  currentUserId: string;
  onChange: () => void;
}) {
  const router = useRouter();
  useProjectChannel(projectId, currentUserId, {
    onTask: onChange,
    onColumn: onChange,
    onMembershipRemoved: () => router.replace("/projects?removed=1"),
  });
  return null;
}
