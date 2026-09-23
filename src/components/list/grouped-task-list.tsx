"use client";

import { useState, type ComponentProps } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { TaskTable } from "./task-table";
import { cn } from "@/lib/utils";

export function GroupedTaskList(props: ComponentProps<typeof TaskTable>) {
  const [grouped, setGrouped] = useState(true);
  const completed = props.tasks.filter(
    (task) => props.columns.find((column) => column.id === task.column_id)?.is_done_column,
  ).length;
  return (
    <div className="space-y-4">
      <dl
        aria-label="Filtered task summary"
        className="bg-border grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-4"
      >
        {[
          ["Tasks", props.tasks.length],
          ["Completed", completed],
          [
            "High priority",
            props.tasks.filter((task) => task.priority === "high" || task.priority === "urgent")
              .length,
          ],
          ["Unscheduled", props.tasks.filter((task) => !task.due_date).length],
        ].map(([label, count]) => (
          <div key={label} className="bg-card px-5 py-4">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-headline-md mt-2 font-serif">{count}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          {props.tasks.length} {props.tasks.length === 1 ? "task" : "tasks"}
        </p>
        <label className="flex items-center gap-2">
          Group by
          <select
            className="bg-background rounded-md border px-3 py-2"
            value={grouped ? "status" : "none"}
            onChange={(event) => setGrouped(event.target.value === "status")}
          >
            <option value="status">Status</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
      {!grouped ? (
        <TaskTable {...props} />
      ) : (
        <Accordion
          type="multiple"
          defaultValue={props.columns.map((column) => column.id)}
          className="overflow-hidden rounded-lg border"
        >
          {props.columns.map((column) => {
            const tasks = props.tasks.filter((task) => task.column_id === column.id);
            return (
              <AccordionItem key={column.id} value={column.id}>
                <AccordionTrigger className="bg-card items-center rounded-none px-4">
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        column.is_done_column ? "bg-status-completed-fg" : "bg-brand-primary",
                      )}
                    />
                    <span className="text-headline-md truncate font-serif font-medium">
                      {column.name}
                    </span>
                    <span className="text-muted-foreground text-xs">{tasks.length}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  <TaskTable {...props} tasks={tasks} />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
