const crypto = require("crypto");
const config = require("../config");
const { appendJsonl, clearFile, readJson, readJsonl, writeJson, resolveProjectPath } = require("./file-store");

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const listeners = new Map();
let tasksCache = null;

function tasksPath() {
  return resolveProjectPath(process.env.SAIGON_TASKS_PATH || config.store.tasksPath || "./data/tasks.json");
}

function taskLogPath() {
  return resolveProjectPath(process.env.SAIGON_TASK_LOG_PATH || config.store.taskLogPath || "./data/task-log.jsonl");
}

function loadTasks() {
  if (tasksCache) return tasksCache;
  tasksCache = readJson(tasksPath(), {});

  for (const task of Object.values(tasksCache)) {
    if (task.status === "running" || task.status === "queued") {
      task.status = "failed";
      task.currentStep = "interrupted on restart";
      task.updatedAt = new Date().toISOString();
      task.error = "Task did not survive process restart";
    }
  }

  writeJson(tasksPath(), tasksCache);
  return tasksCache;
}

function saveTasks() {
  writeJson(tasksPath(), loadTasks());
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emit(taskId, event, payload = {}) {
  const entry = {
    id: `task-event:${crypto.randomUUID()}`,
    taskId,
    event,
    timestamp: new Date().toISOString(),
    payload,
  };

  appendJsonl(taskLogPath(), entry);
  const subs = listeners.get(taskId) || new Set();
  for (const res of subs) {
    sendSse(res, event, entry);
  }
  return entry;
}

function updateTask(taskId, patch = {}) {
  const tasks = loadTasks();
  const current = tasks[taskId];
  if (!current) throw new Error(`Task ${taskId} not found`);

  tasks[taskId] = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  saveTasks();
  emit(taskId, "status", tasks[taskId]);
  return tasks[taskId];
}

function createTask(type, runner, options = {}) {
  const id = options.id || `task:${crypto.randomUUID()}`;
  const task = {
    id,
    type,
    status: "queued",
    startedAt: null,
    updatedAt: new Date().toISOString(),
    progressPct: 1,
    currentStep: options.initialStep || "queued",
    warnings: [],
    resultRef: null,
    error: null,
    meta: options.meta || {},
  };

  loadTasks()[id] = task;
  saveTasks();
  emit(id, "created", task);
  emit(id, "status", task);

  setImmediate(async () => {
    updateTask(id, {
      status: "running",
      startedAt: new Date().toISOString(),
      currentStep: options.initialStep || "running",
      progressPct: 2,
    });

    const ctx = {
      taskId: id,
      progress(progressPct, currentStep, extra = {}) {
        return updateTask(id, {
          progressPct: Math.max(0, Math.min(100, Math.round(progressPct))),
          currentStep,
          warnings: Array.isArray(extra.warnings) ? extra.warnings : loadTasks()[id].warnings,
          resultRef: extra.resultRef ?? loadTasks()[id].resultRef,
        });
      },
      warn(message) {
        const current = loadTasks()[id];
        const warnings = [...current.warnings, String(message)];
        return updateTask(id, { warnings });
      },
      log(step, payload = {}) {
        return emit(id, step, payload);
      },
      complete(resultRef = null, patch = {}) {
        return updateTask(id, {
          status: "completed",
          progressPct: 100,
          currentStep: "completed",
          resultRef,
          ...patch,
        });
      },
    };

    try {
      const result = await runner(ctx);
      if (!TERMINAL_STATES.has(loadTasks()[id].status)) {
        ctx.complete(result?.resultRef || result || null, {
          warnings: Array.isArray(result?.warnings) ? result.warnings : loadTasks()[id].warnings,
        });
      }
      emit(id, "completed", { result });
    } catch (error) {
      updateTask(id, {
        status: "failed",
        currentStep: "failed",
        error: error.message,
      });
      emit(id, "failed", { error: error.message });
    }
  });

  return task;
}

function getTask(taskId) {
  return loadTasks()[taskId] || null;
}

function listRecentTasks(limit = 8) {
  return Object.values(loadTasks())
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
}

function getTaskEvents(taskId) {
  return readJsonl(taskLogPath()).filter((entry) => entry.taskId === taskId);
}

function subscribe(taskId, req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write("\n");

  const existing = getTask(taskId);
  if (existing) sendSse(res, "status", existing);
  for (const entry of getTaskEvents(taskId)) {
    sendSse(res, entry.event, entry);
  }

  const subs = listeners.get(taskId) || new Set();
  subs.add(res);
  listeners.set(taskId, subs);

  req.on("close", () => {
    const current = listeners.get(taskId);
    if (!current) return;
    current.delete(res);
    if (!current.size) listeners.delete(taskId);
  });
}

function resetForTests() {
  tasksCache = {};
  writeJson(tasksPath(), tasksCache);
  clearFile(taskLogPath());
  listeners.clear();
}

module.exports = {
  createTask,
  updateTask,
  getTask,
  listRecentTasks,
  getTaskEvents,
  subscribe,
  resetForTests,
};
