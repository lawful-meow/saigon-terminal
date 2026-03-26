// ─── commands.js ───────────────────────────────────────────────────────────────
// Pure command-palette helper for Saigon Terminal.
// Dependency-free and safe to import from browser or Node.
// ───────────────────────────────────────────────────────────────────────────────

const PRESETS = Object.freeze([
  { id: "leaders", label: "Leaders", description: "Strongest CAN SLIM names" },
  { id: "repair", label: "Repair Watch", description: "Early base repair and reclaim setups" },
  { id: "entry", label: "Entry Watch", description: "Names near a Wyckoff trigger" },
  { id: "risk", label: "Risk Off", description: "Breakdown and markdown risk" },
  { id: "longs", label: "Long Candidates", description: "Bullish or repair-ready names" },
  { id: "shorts", label: "Short Candidates", description: "Weak or markdown names" },
  { id: "all", label: "All Rows", description: "Current full terminal board" },
]);

const COMMANDS = Object.freeze([
  {
    name: "scan",
    usage: "scan",
    description: "Run a full scan of the active watchlist.",
  },
  {
    name: "batch",
    usage: "batch <tickers>",
    description: "Throttle-scan many tickers and keep the strongest names.",
  },
  {
    name: "open",
    usage: "open <ticker>",
    description: "Focus a ticker in the board and detail panel.",
  },
  {
    name: "add",
    usage: "add <ticker> [name] [sector]",
    description: "Add a ticker to the editable watchlist.",
  },
  {
    name: "update",
    usage: "update <ticker> [name] [sector]",
    description: "Update an existing watchlist row.",
  },
  {
    name: "remove",
    usage: "remove <ticker>",
    description: "Remove a ticker from the watchlist.",
  },
  {
    name: "preset",
    usage: "preset <id>",
    description: "Load a preset board lens.",
  },
  {
    name: "prompt",
    usage: "prompt",
    description: "Open the AI prompt export.",
  },
  {
    name: "publish",
    usage: "publish",
    description: "Publish the latest snapshot.",
  },
  {
    name: "help",
    usage: "help [command]",
    description: "Show command help.",
  },
]);

const COMMAND_LOOKUP = new Map(
  COMMANDS.flatMap((command) => [
    [command.name, command],
    ...(command.aliases || []).map((alias) => [alias, command]),
  ]),
);

function normalizeTicker(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizePresetId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function tokenize(input) {
  const text = String(input || "").trim();
  if (!text) return [];

  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function parseTickerList(input) {
  const values = Array.isArray(input) ? input : tokenize(input);
  const seen = new Set();
  const tickers = [];

  for (const value of values) {
    const chunks = String(value)
      .split(/[,\s;|]+/)
      .map((chunk) => normalizeTicker(chunk))
      .filter((chunk) => chunk.length >= 2 && chunk.length <= 12);

    for (const ticker of chunks) {
      if (seen.has(ticker)) continue;
      seen.add(ticker);
      tickers.push(ticker);
    }
  }

  return tickers;
}

function looksLikeSector(token) {
  return /^[A-Z][A-Z0-9&/_-]{1,19}$/.test(token) && !/^\d+$/.test(token);
}

function splitNameAndSector(tokens) {
  if (!tokens.length) return { name: null, sector: null };
  if (tokens.length === 1) return { name: tokens[0], sector: null };

  const maybeSector = tokens[tokens.length - 1];
  if (looksLikeSector(maybeSector)) {
    return {
      name: tokens.slice(0, -1).join(" "),
      sector: maybeSector,
    };
  }

  return {
    name: tokens.join(" "),
    sector: null,
  };
}

function buildStockPayload(ticker, nameTokens) {
  const normalizedTicker = normalizeTicker(ticker);
  const { name, sector } = splitNameAndSector(nameTokens);
  return {
    ticker: normalizedTicker,
    name: name || normalizedTicker,
    sector: sector || "USER",
  };
}

function buildHelpText(topic = null) {
  const intro = [
    "Saigon Terminal commands:",
    "",
  ];

  const lines = COMMANDS.map((command) => `- ${command.usage} — ${command.description}`);
  const presets = [
    "",
    "Presets:",
    ...PRESETS.map((preset) => `- ${preset.id} — ${preset.description}`),
  ];

  const detail = topic
    ? [
        "",
        `Topic: ${topic}`,
        "Use exact tickers and quote multi-word names, e.g. add FPT \"FPT Corp\" TECH",
      ]
    : [];

  return [...intro, ...lines, ...presets, ...detail].join("\n");
}

function parseAddOrUpdate(command, tokens) {
  const ticker = normalizeTicker(tokens[1]);
  if (!ticker) {
    return {
      ok: false,
      kind: "error",
      command,
      error: "Ticker is required",
      help: buildHelpText(command),
    };
  }

  const rest = tokens.slice(2);
  const payload = buildStockPayload(ticker, rest);

  if (command === "add") {
    return {
      ok: true,
      kind: "action",
      command,
      action: {
        type: "watchlist.add",
        stock: payload,
      },
      help: buildHelpText(command),
    };
  }

  return {
    ok: true,
    kind: "action",
    command,
    action: {
      type: "watchlist.update",
      ticker,
      patch: {
        ticker: payload.ticker,
        name: payload.name,
        sector: payload.sector,
      },
    },
    help: buildHelpText(command),
  };
}

function parseCommand(input, options = {}) {
  const raw = String(input || "").trim();
  const help = buildHelpText();

  if (!raw) {
    return {
      ok: false,
      kind: "empty",
      command: null,
      action: null,
      help,
      error: "Empty command",
    };
  }

  const tokens = tokenize(raw);
  if (!tokens.length) {
    return {
      ok: false,
      kind: "empty",
      command: null,
      action: null,
      help,
      error: "Empty command",
    };
  }

  const commandName = String(tokens[0]).toLowerCase();
  const commandDef = COMMAND_LOOKUP.get(commandName);
  if (!commandDef) {
    return {
      ok: false,
      kind: "error",
      command: commandName,
      action: null,
      help,
      error: `Unknown command: ${commandName}`,
    };
  }

  const result = {
    ok: true,
    kind: "action",
    command: commandDef.name,
    action: null,
    help,
    warnings: [],
  };

  switch (commandDef.name) {
    case "scan":
      result.action = { type: "scan" };
      if (tokens.length > 1) {
        const maybeTicker = normalizeTicker(tokens[1]);
        if (maybeTicker) {
          result.action = { type: "scan.one", ticker: maybeTicker };
          result.warnings.push("scan with a ticker focuses a single symbol");
        }
      }
      return result;

    case "batch": {
      const tickers = parseTickerList(tokens.slice(1));
      if (!tickers.length) {
        return {
          ok: false,
          kind: "error",
          command: "batch",
          action: null,
          help,
          error: "Batch requires at least one ticker",
        };
      }

      const topN = Number(options.topN || 10);
      const delayMs = Number(options.delayMs || 450);
      result.action = {
        type: "batch.scan",
        tickers,
        topN: Number.isFinite(topN) && topN > 0 ? Math.min(20, Math.floor(topN)) : 10,
        delayMs: Number.isFinite(delayMs) && delayMs > 0 ? Math.max(250, Math.min(3000, Math.floor(delayMs))) : 450,
      };
      return result;
    }

    case "open": {
      const ticker = normalizeTicker(tokens[1]);
      if (!ticker) {
        return {
          ok: false,
          kind: "error",
          command: "open",
          action: null,
          help,
          error: "Open requires a ticker",
        };
      }

      result.action = { type: "open.ticker", ticker };
      return result;
    }

    case "add":
    case "update":
      return parseAddOrUpdate(commandDef.name, tokens);

    case "remove": {
      const ticker = normalizeTicker(tokens[1]);
      if (!ticker) {
        return {
          ok: false,
          kind: "error",
          command: "remove",
          action: null,
          help,
          error: "Remove requires a ticker",
        };
      }

      return {
        ok: true,
        kind: "action",
        command: "remove",
        action: { type: "watchlist.remove", ticker },
        help,
      };
    }

    case "preset": {
      const presetId = normalizePresetId(tokens[1]);
      if (!presetId) {
        return {
          ok: false,
          kind: "error",
          command: "preset",
          action: null,
          help,
          error: "Preset requires an id",
        };
      }

      const preset = PRESETS.find((item) => item.id === presetId) || null;
      result.action = {
        type: "preset.load",
        presetId,
        preset,
      };
      if (!preset) result.warnings.push(`Unknown preset id: ${presetId}`);
      return result;
    }

    case "prompt":
      return {
        ok: true,
        kind: "action",
        command: "prompt",
        action: { type: "prompt.open" },
        help,
      };

    case "publish":
      return {
        ok: true,
        kind: "action",
        command: "publish",
        action: { type: "publish.snapshot" },
        help,
      };

    case "help": {
      const topic = tokens[1] ? String(tokens[1]).toLowerCase() : null;
      const topicCommand = topic ? COMMAND_LOOKUP.get(topic) || null : null;
      return {
        ok: true,
        kind: "help",
        command: "help",
        action: topicCommand
          ? { type: "help.topic", topic: topicCommand.name }
          : { type: "help.general" },
        help: buildHelpText(topicCommand ? topicCommand.name : null),
      };
    }

    default:
      return {
        ok: false,
        kind: "error",
        command: commandDef.name,
        action: null,
        help,
        error: `Unsupported command: ${commandDef.name}`,
      };
  }
}

function formatAction(action) {
  if (!action) return "No action";

  switch (action.type) {
    case "scan":
      return "Scan watchlist";
    case "scan.one":
      return `Scan ${action.ticker}`;
    case "batch.scan":
      return `Batch scan ${action.tickers.length} tickers`;
    case "open.ticker":
      return `Open ${action.ticker}`;
    case "watchlist.add":
      return `Add ${action.stock.ticker}`;
    case "watchlist.update":
      return `Update ${action.ticker}`;
    case "watchlist.remove":
      return `Remove ${action.ticker}`;
    case "preset.load":
      return `Load preset ${action.presetId}`;
    case "prompt.open":
      return "Open prompt";
    case "publish.snapshot":
      return "Publish snapshot";
    case "help.topic":
      return `Help for ${action.topic}`;
    case "help.general":
      return "Show help";
    default:
      return action.type;
  }
}

module.exports = {
  COMMANDS,
  PRESETS,
  tokenize,
  parseTickerList,
  parseCommand,
  buildHelpText,
  formatAction,
  normalizeTicker,
  normalizePresetId,
};
