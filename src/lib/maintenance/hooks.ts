'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  MAINTENANCE_TASKS,
  MAINTENANCE_STORAGE_KEY,
  TaskStatus,
  TaskState,
  MaintenanceTask,
  getTaskState,
} from './config';

export interface TaskWithStatus extends MaintenanceTask {
  status: TaskStatus | undefined;
  state: TaskState;
}

/**
 * Hook to manage maintenance task statuses
 */
export function useMaintenanceTasks() {
  const [statuses, setStatuses] = useState<Record<string, TaskStatus>>({});
  const [loaded, setLoaded] = useState(false);

  // Load statuses from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(MAINTENANCE_STORAGE_KEY);
      if (stored) {
        setStatuses(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load maintenance statuses:', e);
    }
    setLoaded(true);
  }, []);

  // Save statuses to localStorage whenever they change
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(MAINTENANCE_STORAGE_KEY, JSON.stringify(statuses));
      } catch (e) {
        console.error('Failed to save maintenance statuses:', e);
      }
    }
  }, [statuses, loaded]);

  // Mark a task as completed
  const markCompleted = useCallback((taskId: string) => {
    setStatuses((prev) => ({
      ...prev,
      [taskId]: {
        taskId,
        lastCompleted: Date.now(),
        snoozedUntil: null,
      },
    }));
  }, []);

  // Snooze a task for a certain number of hours
  const snoozeTask = useCallback((taskId: string, hours: number = 24) => {
    setStatuses((prev) => ({
      ...prev,
      [taskId]: {
        ...prev[taskId],
        taskId,
        lastCompleted: prev[taskId]?.lastCompleted || null,
        snoozedUntil: Date.now() + hours * 60 * 60 * 1000,
      },
    }));
  }, []);

  // Get all tasks with their current status and state
  const tasksWithStatus: TaskWithStatus[] = MAINTENANCE_TASKS.map((task) => ({
    ...task,
    status: statuses[task.id],
    state: getTaskState(task, statuses[task.id]),
  }));

  // Get tasks that need attention (due_soon, overdue, or critical)
  const alertTasks = tasksWithStatus.filter(
    (task) => task.state !== 'ok'
  );

  // Check if any task is in critical state
  const hasCriticalTask = alertTasks.some((task) => task.state === 'critical');

  return {
    tasks: tasksWithStatus,
    alertTasks,
    hasCriticalTask,
    markCompleted,
    snoozeTask,
    loaded,
  };
}
