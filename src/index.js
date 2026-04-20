import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// Load environment variables from the local .env file.
dotenv.config();

// Configuration used to connect to the Membrane API and sign JWTs.
const API_BASE_URL = process.env.MEMBRANE_API_BASE_URL || "https://api.getmembrane.com";
const WORKSPACE_KEY = process.env.MEMBRANE_WORKSPACE_KEY;
const WORKSPACE_SECRET = process.env.MEMBRANE_WORKSPACE_SECRET;
const TOKEN_CUSTOMER_ID = process.env.MEMBRANE_CUSTOMER_ID || "local-cli";
const TOKEN_CUSTOMER_NAME = process.env.MEMBRANE_CUSTOMER_NAME || "Local CLI";
const TOKEN_ALGORITHM = "HS256";
const TOKEN_EXPIRES_IN = 3600;
const ADMIN_TOKEN_ALGORITHM = "HS512";
const ADMIN_TOKEN_EXPIRES_IN = 7200;
// Opt-in: when set, clone keys are snake-cased from the action name (e.g. "Create Issue" ->
// "create_issue"). When not set, the script omits `key` on create and Membrane auto-derives one.
const SNAKE_CASE_KEYS = /^(1|true|yes)$/i.test(process.env.SNAKE_CASE_KEYS || "");

function assertEnv() {
  // Stop early if the required workspace credentials are missing.
  const missing = [];

  if (!WORKSPACE_KEY) {
    missing.push("MEMBRANE_WORKSPACE_KEY");
  }

  if (!WORKSPACE_SECRET) {
    missing.push("MEMBRANE_WORKSPACE_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. Copy .env.example to .env and fill them in.`,
    );
  }
}

function createToken() {
  // Create the regular bearer token used for read operations.
  return jwt.sign(
    {
      id: TOKEN_CUSTOMER_ID,
      name: TOKEN_CUSTOMER_NAME,
      iss: WORKSPACE_KEY,
    },
    WORKSPACE_SECRET,
    {
      algorithm: TOKEN_ALGORITHM,
      expiresIn: TOKEN_EXPIRES_IN,
    },
  );
}

function createAdminToken() {
  // Create the workspace admin token required for action creation.
  return jwt.sign(
    {
      workspaceKey: WORKSPACE_KEY,
      isAdmin: true,
    },
    WORKSPACE_SECRET,
    {
      algorithm: ADMIN_TOKEN_ALGORITHM,
      expiresIn: ADMIN_TOKEN_EXPIRES_IN,
    },
  );
}

async function membraneFetch(path, options = {}, token = createToken()) {
  // Send an authenticated request to Membrane and normalize the response body.
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const rawText = await response.text();
  let body;

  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = rawText;
  }

  if (!response.ok) {
    const details =
      typeof body === "string" ? body : JSON.stringify(body, null, 2);
    throw new Error(
      `Membrane request failed (${response.status} ${response.statusText}) for ${path}\n${details}`,
    );
  }

  return body;
}

async function listIntegrations() {
  // Fetch available integrations and keep only active ones tied to an external app.
  const response = await membraneFetch("/integrations?limit=100");
  const items = Array.isArray(response?.items) ? response.items : [];

  return items
    .filter((item) => !item.isDeactivated && item.externalAppId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Derive a workspace-valid snake_case key from the human-readable action name
// ("Create Issue" -> "create_issue"). Action snapshots in published packages don't expose `key`.
function nameToSnakeKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function listPackageActions(externalAppId) {
  // Public actions are discovered through the external-app's base package (the latest published
  // version). Each element in the package is a frozen action snapshot at publish time.
  const app = await membraneFetch(`/external-apps/${externalAppId}`);

  if (!app?.basePackageId) {
    return [];
  }

  const pkg = await membraneFetch(`/packages/${app.basePackageId}?version=latest`);
  const actionSnapshotRefs = (pkg?.elements || []).filter(
    (element) => element.type === "action" && element.id,
  );

  const actionSnapshots = [];

  for (const ref of actionSnapshotRefs) {
    const actionSnapshot = await membraneFetch(`/actions/${ref.id}`);

    if (!actionSnapshot?.name) {
      continue;
    }

    actionSnapshots.push({
      id: ref.id,
      key: SNAKE_CASE_KEYS ? nameToSnakeKey(actionSnapshot.name) : null,
      name: actionSnapshot.name,
      description: actionSnapshot.description || "",
      type: actionSnapshot.type,
      inputSchema: actionSnapshot.inputSchema || { type: "object", properties: {} },
      config: actionSnapshot.config || {},
      outputMapping: actionSnapshot.outputMapping,
      customOutputSchema: actionSnapshot.customOutputSchema || {},
    });
  }

  return actionSnapshots.sort((a, b) => a.name.localeCompare(b.name));
}

function printNumberedList(items, formatter) {
  // Render a numbered list so the user can select by index.
  for (const [index, item] of items.entries()) {
    output.write(`${index + 1}. ${formatter(item, index)}\n`);
  }
}

async function promptForSingleSelection(rl, items, label) {
  // Keep prompting until the user picks one valid number from the list.
  while (true) {
    const answer = await rl.question(`\nChoose ${label} by number: `);
    const selectedIndex = Number.parseInt(answer, 10) - 1;

    if (Number.isInteger(selectedIndex) && items[selectedIndex]) {
      return items[selectedIndex];
    }

    output.write(`Invalid ${label} selection. Try again.\n`);
  }
}

function parseMultiSelection(answer, max) {
  // Convert a comma-separated list like "1,3,5" into zero-based indexes.
  const indexes = answer
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10) - 1);

  if (indexes.length === 0) {
    return [];
  }

  const uniqueIndexes = [...new Set(indexes)];
  const isValid = uniqueIndexes.every(
    (index) => Number.isInteger(index) && index >= 0 && index < max,
  );

  return isValid ? uniqueIndexes : [];
}

async function promptForMultipleSelection(rl, items, label) {
  // Let the user choose many items at once or use "all" to select everything.
  while (true) {
    const answer = await rl.question(
      `\nChoose ${label} by comma-separated numbers (example: 1,3,5) or type "all": `,
    );
    const normalizedAnswer = answer.trim().toLowerCase();

    if (normalizedAnswer === "all") {
      return items;
    }

    const indexes = parseMultiSelection(answer, items.length);

    if (indexes.length > 0) {
      return indexes.map((index) => items[index]);
    }

    output.write(`Invalid ${label} selection. Try again.\n`);
  }
}

function toCreateActionPayload(actionSnapshot, integration) {
  const payload = {
    name: actionSnapshot.name,
    integrationKey: integration.key,
    description: actionSnapshot.description,
    type: actionSnapshot.type,
    inputSchema: actionSnapshot.inputSchema,
    config: actionSnapshot.config,
    outputMapping: actionSnapshot.outputMapping,
    customOutputSchema: actionSnapshot.customOutputSchema,
    meta: {
      source: "public",
      publicId: actionSnapshot.id,
    },
  };

  // When SNAKE_CASE_KEYS isn't set we let Membrane auto-derive the key server-side.
  if (actionSnapshot.key) {
    payload.key = actionSnapshot.key;
  }

  return payload;
}

async function createAction(payload) {
  // Create one action using the admin token because this is a workspace-level write.
  return membraneFetch(
    "/actions",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    createAdminToken(),
  );
}

async function main() {
  // Validate config before starting the interactive flow.
  assertEnv();

  // Open a readline session for the terminal prompts.
  const rl = readline.createInterface({ input, output });

  try {
    // Step 1: show the user which external apps are available.
    output.write("Fetching available external apps...\n");
    const integrations = await listIntegrations();

    if (integrations.length === 0) {
      output.write("No integrations with externalAppId were found.\n");
      return;
    }

    printNumberedList(
      integrations,
      (integration) =>
        `${integration.name} (${integration.key}) - externalAppId: ${integration.externalAppId}`,
    );

    // Step 2: let the user choose one external app by number.
    const selectedIntegration = await promptForSingleSelection(
      rl,
      integrations,
      "an external app",
    );

    // Step 3: load the public actions for the selected external app.
    output.write(
      `\nFetching public actions for ${selectedIntegration.name}...\n`,
    );
    const actions = await listPackageActions(selectedIntegration.externalAppId);

    if (actions.length === 0) {
      output.write("No public actions were found for that external app.\n");
      return;
    }

    printNumberedList(
      actions,
      (action) => {
        const keyPart = action.key ? ` (${action.key})` : "";
        const descPart = action.description ? ` - ${action.description}` : "";
        return `${action.name}${keyPart}${descPart}`;
      },
    );

    // Step 4: let the user choose which actions should be cloned.
    const selectedActions = await promptForMultipleSelection(
      rl,
      actions,
      "actions to create",
    );

    // Step 5: create the selected actions one by one and collect the outcome.
    output.write(
      `\nCreating ${selectedActions.length} action(s) for ${selectedIntegration.name}...\n`,
    );

    const results = [];

    for (const action of selectedActions) {
      const payload = toCreateActionPayload(action, selectedIntegration);

      try {
        const created = await createAction(payload);
        results.push({
          status: "created",
          sourceName: action.name,
          createdId: created?.id || created?.item?.id || "unknown",
        });
      } catch (error) {
        results.push({
          status: "failed",
          sourceName: action.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    output.write("\nResult:\n");

    // Step 6: print a summary showing which actions were created or failed.
    for (const result of results) {
      if (result.status === "created") {
        output.write(`- Created "${result.sourceName}" (id: ${result.createdId})\n`);
      } else {
        output.write(`- Failed "${result.sourceName}"\n${result.error}\n`);
      }
    }

    output.write(
      "\nNote: cloned actions are independent copies and will not receive automatic updates when the source public action changes.\n",
    );
  } finally {
    // Always close the readline session before exiting.
    rl.close();
  }
}

main().catch((error) => {
  // Surface unexpected errors in a readable way and exit with a failure code.
  output.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
