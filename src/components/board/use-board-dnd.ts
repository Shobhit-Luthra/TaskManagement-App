"use client";

import { useCallback, useMemo, useState } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { computeDropPosition } from "./compute-drop-position";
import type { BoardColumn, BoardTask } from "./project-board";

type DropData = { type: "column" | "task"; columnId: string };

export function useBoardDnd({
  tasks,
  columns,
  readOnly,
  onMove,
}: {
  tasks: BoardTask[];
  columns: BoardColumn[];
  readOnly: boolean;
  onMove: (taskId: string, columnId: string, position: number, mutationId: string) => void;
}) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, tasks],
  );
  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      if (!readOnly) setActiveTaskId(String(event.active.id));
    },
    [readOnly],
  );
  const onDragOver = useCallback((_event: DragOverEvent) => {}, []);
  const onDragCancel = useCallback(() => setActiveTaskId(null), []);
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTaskId(null);
      if (readOnly || !event.over) return;
      const taskId = String(event.active.id);
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      const data = event.over.data.current as DropData | undefined;
      const columnId = data?.columnId ?? String(event.over.id);
      if (!columns.some((column) => column.id === columnId)) return;
      const siblings = tasks
        .filter((candidate) => candidate.column_id === columnId && candidate.id !== taskId)
        .sort((a, b) => a.position - b.position);
      const overIndex =
        data?.type === "task"
          ? siblings.findIndex((candidate) => candidate.id === String(event.over!.id))
          : siblings.length;
      const insertionIndex = overIndex < 0 ? siblings.length : overIndex;
      const position = computeDropPosition(
        siblings[insertionIndex - 1]?.position ?? null,
        siblings[insertionIndex]?.position ?? null,
      );
      if (task.column_id === columnId && task.position === position) return;
      onMove(taskId, columnId, position, crypto.randomUUID());
    },
    [columns, onMove, readOnly, tasks],
  );
  return { sensors, activeTask, onDragStart, onDragOver, onDragEnd, onDragCancel };
}
