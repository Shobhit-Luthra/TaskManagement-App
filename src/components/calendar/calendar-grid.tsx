"use client";

import Link from "next/link";
import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2 } from "lucide-react";
import { MAX_CHIPS_PER_DAY, type CalendarView } from "@/lib/calendar/grid";
import { cn } from "@/lib/utils";
import type { CalendarTask } from "./use-calendar-tasks";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayLabel(day: string): string {
  const [year = 0, month = 0, date = 0] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

export function CalendarGrid({
  view,
  days,
  month,
  today,
  tasksByDay,
  showProject,
}: {
  view: CalendarView;
  days: string[];
  month: string;
  today: string | null;
  tasksByDay: Map<string, CalendarTask[]>;
  showProject: boolean;
}) {
  return (
    <div role="table" aria-label="Calendar" className="mt-4 overflow-x-auto rounded-xl border">
      <div role="row" className="bg-muted/50 grid min-w-[42rem] grid-cols-7 border-b">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            role="columnheader"
            className="text-muted-foreground px-2 py-2 text-xs font-medium uppercase"
          >
            {weekday}
          </div>
        ))}
      </div>
      {Array.from({ length: days.length / 7 }, (_, week) => (
        <div key={week} role="row" className="grid min-w-[42rem] grid-cols-7">
          {days.slice(week * 7, week * 7 + 7).map((day) => (
            <CalendarDay
              key={day}
              day={day}
              tasks={tasksByDay.get(day) ?? []}
              outside={view === "month" && !day.startsWith(month)}
              isToday={day === today}
              tall={view === "week"}
              showProject={showProject}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function CalendarDay({
  day,
  tasks,
  outside,
  isToday,
  tall,
  showProject,
}: {
  day: string;
  tasks: CalendarTask[];
  outside: boolean;
  isToday: boolean;
  tall: boolean;
  showProject: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { isOver, setNodeRef } = useDroppable({ id: `day:${day}`, data: { day } });
  const visible = expanded ? tasks : tasks.slice(0, MAX_CHIPS_PER_DAY);
  const hidden = tasks.length - visible.length;
  return (
    <div
      ref={setNodeRef}
      role="cell"
      aria-label={dayLabel(day)}
      aria-current={isToday ? "date" : undefined}
      className={cn(
        "min-h-28 border-r border-b p-1.5 last:border-r-0",
        tall && "min-h-80",
        outside && "bg-muted/30 text-muted-foreground",
        isOver && "ring-primary ring-2 ring-inset",
      )}
    >
      <span
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-full text-xs",
          isToday && "bg-primary text-primary-foreground font-semibold",
        )}
      >
        {Number(day.slice(8))}
      </span>
      <ul className="mt-1 space-y-1">
        {visible.map((task) => (
          <li key={task.id}>
            <CalendarChip task={task} showProject={showProject} />
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-1 rounded text-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          +{hidden} more
        </button>
      )}
    </div>
  );
}

export function CalendarChip({ task, showProject }: { task: CalendarTask; showProject: boolean }) {
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { taskId: task.id },
    disabled: !task.can_edit,
  });
  const details = [
    showProject ? task.project_name : null,
    task.subtask_total > 0 ? `${task.subtask_done}/${task.subtask_total} subtasks` : null,
  ].filter(Boolean);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...(task.can_edit ? listeners : {})}
      className={cn(
        "bg-card rounded-md border px-1.5 py-1 text-xs",
        task.can_edit && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <Link
        href={`/p/${task.project_id}/board?task=${task.id}`}
        className={cn(
          "focus-visible:ring-ring block truncate rounded font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none",
          task.is_done && "text-muted-foreground line-through",
        )}
      >
        {task.is_done && <CheckCircle2 aria-label="Completed" className="mr-1 inline size-3" />}
        {task.title}
      </Link>
      {details.length > 0 && (
        <p className="text-muted-foreground truncate">{details.join(" · ")}</p>
      )}
    </div>
  );
}
