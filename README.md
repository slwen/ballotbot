![screenshot](https://raw.githubusercontent.com/slwen/ballotbot/master/avatar.png)

## Commands

Ballotbot listens for these commands:

> /ballot candidate a, candidate b, candidate c

Comma separate each candidate or voting option and `ballotbot` will take care of the rest.

## Local Dev

Before getting started you will need to set up a new app over at [api.slack.com](https://api.slack.com/apps/new)

#### Dev Requirements

- Node.js v7.1.0
- direnv
- yarn
- [ngrok](https://ngrok.com/) `npm i -g ngrok`

#### Environment

```
export CLIENT_ID=<slack-client-id>
export CLIENT_SECRET=<slack-app-secret>
export VERIFICATION_TOKEN=<slack-app-verification-token>
export PORT=4050
```

#### Start the server:

```sh
$ yarn install
$ yarn dev
```

#### Start up a local tunnel with `ngrok`:

This will expose a secure HTTP connection to localhost. You will need to tweak settings in your slack app configuration based on the random URL that ngrok sets up.

```sh
$ yarn tunnel
```

Visit http://127.0.0.1:4040/status for an `ngrok` dashboard.


#### Installing the app in your slack organisation:

Visit `https://<your-random-ngrok-url>/login`
