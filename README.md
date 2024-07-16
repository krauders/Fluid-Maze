# Fluid Maze

This repository contains a simple app that enables all connected clients to navigate a shared 2D maze together.

## Requirements

[Node.js](https://nodejs.dev/en/download) version 18+

## Getting Started

After cloning the repository, install dependencies and start the application

```bash
npm install
npm start
```

Navigate to [http://localhost:8080/](http://localhost:8080/) in the browser to view the app.

## Running in GitHub Codespaces

To run this in GitHub Codespaces and provide a public URL, I made the following changes.

Start the app by running `npm start` in a terminal inside VSCode. 
Then, go to the Ports tab in the bottom console where the terminal is, and you should see 2 ports, 7070 and 8080.
Right-click each port, select Visibility, and select Public. You should see public URLs show up instead of localhost:7070 and localhost:8080.
Open `app.js` or wherever you initialize the tinylicious client, and change 

```
const client = new TinyliciousClient();
```

to something like this, with your `7070` port URL. Make sure it's HTTPS and specify the port to be 443. 

```
const clientProps = { connection: { port: 443, domain: "https://effective-goldfish-5wv9gjxr5qxh49x6-7070.app.github.dev" } };
const client = new TinyliciousClient(clientProps);
```

Then, in your `package.json`, to enable serving publicly, find this script:

```
"start:client": "webpack serve",
```

and change it to

```
"start:client": "webpack serve --allowed-hosts all",
```

That should be it! I didn't need to change anything in the tinylicious resource factory or anywhere else. 