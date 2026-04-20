# Export Public Actions

Small Node.js CLI that:

1. Reads your Membrane workspace key and secret from `.env`
2. Generates JWT bearer tokens for regular requests and admin action creation
3. Lists your integrations that are linked to an external app
4. Lets you choose one integration by number
5. Fetches the integration's latest published public actions via the base package
6. Lets you choose which ones to clone
7. Creates the chosen actions in your workspace as tracked clones

## Setup

```bash
npm install
copy .env.example .env
```

Fill in `.env` with your workspace credentials.

## Run

```bash
npm start
```

## Notes

- Public actions are read from the external app's latest published package (`/external-apps/<id>` -> `basePackageId` -> `/packages/<id>?version=latest`).
- By default, `key` is omitted on create and Membrane auto-derives one. Set `SNAKE_CASE_KEYS=true` in `.env` to have the script derive snake-cased keys from the action name (e.g. `"Create Issue"` -> `create_issue`).
- Clones carry metadata — `meta.source = "public"` and `meta.publicId` (the source action snapshot id) — available to downstream tooling if needed.
- Action creation uses a workspace admin token with `isAdmin: true`, matching Membrane's permission requirement for modifying actions.
- Cloned actions are independent copies and will not receive automatic updates when the source public action is republished.
