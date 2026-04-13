# Export Public Actions

Small Node.js CLI that:

1. Reads your Membrane workspace key and secret from `.env`
2. Generates JWT bearer tokens for regular requests and admin action creation
3. Lists available external apps
4. Lets you choose one app by number
5. Lists public actions for that app
6. Lets you choose which actions to create
7. Creates customized actions in your workspace based on the public action definitions

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

- The script uses the selected integration's `key` as `integrationKey` when creating actions.
- Created actions are marked with `"isCustomized": true`.
- The script copies the public action's `name`, `description`, `inputSchema`, `type`, `config`, and `customOutputSchema`.
- Action creation uses a workspace admin token with `isAdmin: true`, matching Membrane's permission requirement for modifying actions.
- Cloned actions are independent customized copies and will not receive automatic updates when the original public actions change.
