const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "saigon-task-test-"));
process.env.SAIGON_TASKS_PATH = path.join(tempRoot, "tasks.json");
process.env.SAIGON_TASK_LOG_PATH = path.join(tempRoot, "task-log.jsonl");

const taskService = require("../services/task-service");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTask(id, timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const task = taskService.getTask(id);
    if (task && (task.status === "completed" || task.status === "failed")) return task;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for task ${id}`);
}

test("task service persists lifecycle events and writes SSE payloads", async () => {
  taskService.resetForTests();

  const req = new EventEmitter();
  const chunks = [];
  const res = {
    writeHead() {},
    write(chunk) {
      chunks.push(chunk);
    },
  };

  const task = taskService.createTask("unit", async (ctx) => {
    ctx.progress(50, "halfway");
    ctx.log("unit.step", { message: "midpoint" });
    return { resultRef: { type: "unit" } };
  });

  taskService.subscribe(task.id, req, res);
  const finalTask = await waitForTask(task.id);

  assert.equal(finalTask.status, "completed");
  assert.ok(taskService.getTaskEvents(task.id).some((entry) => entry.event === "unit.step"));
  assert.ok(chunks.some((chunk) => String(chunk).includes("event: status")));
  assert.ok(chunks.some((chunk) => String(chunk).includes("event: completed")));

  req.emit("close");
});
