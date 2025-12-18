'use client';

import { useState } from 'react';
import { AlertTriangle, X, CheckCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { useMaintenanceTasks, TaskWithStatus } from '@/lib/maintenance/hooks';
import { formatDaysRemaining } from '@/lib/maintenance/config';

function TaskItem({
  task,
  onComplete,
  onSnooze,
}: {
  task: TaskWithStatus;
  onComplete: () => void;
  onSnooze: () => void;
}) {
  const stateColors = {
    ok: 'bg-green-50 border-green-200',
    due_soon: 'bg-yellow-50 border-yellow-200',
    overdue: 'bg-orange-50 border-orange-200',
    critical: 'bg-red-50 border-red-200',
  };

  const stateLabels = {
    ok: 'OK',
    due_soon: 'Due Soon',
    overdue: 'Overdue',
    critical: 'Critical',
  };

  return (
    <div className={`p-3 rounded-lg border ${stateColors[task.state]} flex items-center justify-between gap-4`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{task.name}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            task.state === 'critical' ? 'bg-red-200 text-red-800' :
            task.state === 'overdue' ? 'bg-orange-200 text-orange-800' :
            task.state === 'due_soon' ? 'bg-yellow-200 text-yellow-800' :
            'bg-green-200 text-green-800'
          }`}>
            {stateLabels[task.state]}
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-0.5">{task.description}</p>
        <p className="text-xs text-gray-500 mt-1">
          {formatDaysRemaining(task, task.status)}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onSnooze}
          className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-200 rounded transition-colors"
          title="Snooze for 24 hours"
        >
          <Clock className="w-4 h-4" />
        </button>
        <button
          onClick={onComplete}
          className="text-xs px-3 py-1.5 bg-teal-600 text-white rounded hover:bg-teal-700 transition-colors flex items-center gap-1"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          Done
        </button>
      </div>
    </div>
  );
}

export function MaintenanceBanner() {
  const { alertTasks, hasCriticalTask, markCompleted, snoozeTask, loaded } = useMaintenanceTasks();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Don't render until loaded from localStorage
  if (!loaded) return null;

  // No alert tasks = no banner
  if (alertTasks.length === 0 || isDismissed) return null;

  // Count by state for summary
  const criticalCount = alertTasks.filter((t) => t.state === 'critical').length;
  const overdueCount = alertTasks.filter((t) => t.state === 'overdue').length;
  const dueSoonCount = alertTasks.filter((t) => t.state === 'due_soon').length;

  return (
    <div
      className={`
        fixed top-0 left-0 right-0 z-50
        ${hasCriticalTask ? 'animate-pulse-slow bg-red-500' : 'bg-amber-400'}
        shadow-lg
      `}
    >
      {/* Collapsed summary bar */}
      <div
        className={`
          px-4 py-2.5 flex items-center justify-between cursor-pointer
          ${hasCriticalTask ? 'text-white' : 'text-amber-900'}
        `}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className={`w-5 h-5 ${hasCriticalTask ? 'animate-bounce' : ''}`} />
          <div className="flex items-center gap-2">
            <span className="font-semibold">Maintenance Needed</span>
            <span className="text-sm opacity-90">
              {criticalCount > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-700 text-white rounded text-xs mr-1">
                  {criticalCount} critical
                </span>
              )}
              {overdueCount > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-600 text-white rounded text-xs mr-1">
                  {overdueCount} overdue
                </span>
              )}
              {dueSoonCount > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-yellow-600 text-white rounded text-xs">
                  {dueSoonCount} due soon
                </span>
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className={`p-1 rounded ${hasCriticalTask ? 'hover:bg-red-600' : 'hover:bg-amber-500'}`}
          >
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsDismissed(true);
            }}
            className={`p-1 rounded ${hasCriticalTask ? 'hover:bg-red-600' : 'hover:bg-amber-500'}`}
            title="Dismiss (will reappear on page reload)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Expanded task list */}
      {isExpanded && (
        <div className="px-4 pb-4 bg-white border-t border-gray-200 max-h-[50vh] overflow-y-auto">
          <div className="py-3 space-y-2">
            {alertTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onComplete={() => markCompleted(task.id)}
                onSnooze={() => snoozeTask(task.id, 24)}
              />
            ))}
          </div>
          <div className="text-xs text-gray-500 text-center pt-2 border-t border-gray-100">
            Click &quot;Done&quot; after completing a task to reset its timer
          </div>
        </div>
      )}

      {/* CSS for slow pulse animation */}
      <style jsx>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
