/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { SharedTree, SchemaFactory, Tree, TreeViewConfiguration } from "fluid-framework";
import { TinyliciousClient } from "@fluidframework/tinylicious-client";

// const clientProps = { connection: { port: 443, domain: "https://effective-goldfish-5wv9gjxr5qxh49x6-8080.app.github.dev" } };
const client = new TinyliciousClient();
const containerSchema = {
	initialObjects: { mazeTree: SharedTree },
};

const root = document.getElementById("content");

// The string passed to the SchemaFactory should be unique
const sf = new SchemaFactory("fluidHelloWorldSample");

class Columns extends sf.array("Columns", sf.number) {}

class Rows extends sf.array("Rows", Columns) {}

class Player extends sf.object("Player", {
	number: sf.number,
	x: sf.number,
	y: sf.number,
	initials: sf.string,
	uuid: sf.string
}) {}

class PlayerList extends sf.array("PlayerList", Player) {}

// Here we define an object we'll use in the schema, a Maze.
class Maze extends sf.object("Maze", {
	rows: Rows,
	playerList: PlayerList
}) {}

// Maze configuration
// The rows and columns actually get multiplied by 2x+1 to account for the walls
const mazeRows = 10;
const mazeColumns = 10;
// player's position
let player;

let initialMaze = {
	rows: [],
	playerList: []
};

// Here we define the tree schema, which has a single Maze object.
const treeConfiguration = new TreeViewConfiguration({
	schema: Maze,
});

let globalMazeRef;

// color for this player
const playerColor = getRandomColor();
// color for other players = gray
const otherPlayerColor = 'gray';
let playerNumber;

// pop up a modal to ask the user to enter their 2-3 letter initials
let initials;

// method to check if the connection state is 2 (connected) and if not, wait for 5 seconds and check again
const checkConnectionState = async (container) => {
	if (container.connectionState !== 2) {
		console.log("Container connection state:" + container.connectionState);
		await new Promise((resolve) => setTimeout(resolve, 5000));
		await checkConnectionState(container);
	}
};

let globalContainer;

const loadExistingMaze = async (id) => {
	console.log("Getting container: ", id);
	const { container } = await client.getContainer(id, containerSchema).catch((error) => {
		console.error("Error getting container: ", error);
		// redirect to root path
		// location.href = "/";
	});
	globalContainer = container;
	const sharedTree = container.initialObjects.mazeTree.viewWith(treeConfiguration);
	const mazeModel = sharedTree.root;
	globalMazeRef = mazeModel;
	console.log("Loaded maze: ", mazeModel.playerList);
	console.log("Player position: ", player);
	console.log("Player list: ", mazeModel.playerList);
	drawMaze(mazeModel, root);
	Tree.on(mazeModel.playerList, "treeChanged", drawMaze);
	console.log("Container connection state:" + container.connectionState);
	initials = prompt("Please enter your 2-3 letter initials");
	await checkConnectionState(container);
	console.log("Container connection state:" + container.connectionState);
	playerNumber = globalMazeRef.playerList.length + 1;
	// make sure there isn't already a player with the same number
	while (globalMazeRef.playerList.find(p => p.number === playerNumber)) {
		playerNumber++;
	}
	console.log("Player number: ", playerNumber);
	mazeModel.playerList.insertAtEnd(getRandomPosition(mazeModel));
	player = {...mazeModel.playerList.find(p => p.number === playerNumber)};
	drawMaze(mazeModel, root);
};

const generateMaze = async(rows, columns) => {
    let maze = Array(rows * 2 + 1).fill().map(() => Array(columns * 2 + 1).fill(0));
    let stack = [];
    let current = { x: Math.floor(Math.random() * rows) * 2 + 1, y: Math.floor(Math.random() * columns) * 2 + 1 };

    function isInsideMaze(x, y) {
        return x > 0 && y > 0 && x < rows * 2 && y < columns * 2;
    }

    function getNeighbors(x, y) {
        let neighbors = [
            { x: x - 2, y: y, wall: 'top' },
            { x: x, y: y + 2, wall: 'right' },
            { x: x + 2, y: y, wall: 'bottom' },
            { x: x, y: y - 2, wall: 'left' }
        ];
        return neighbors.filter(neighbor => isInsideMaze(neighbor.x, neighbor.y) && maze[neighbor.x][neighbor.y] === 0);
    }

    function carvePath(x, y, direction) {
        switch (direction) {
            case 'top': maze[x - 1][y] = 1; maze[x][y] = 1; break;
            case 'right': maze[x][y + 1] = 1; maze[x][y] = 1; break;
            case 'bottom': maze[x + 1][y] = 1; maze[x][y] = 1; break;
            case 'left': maze[x][y - 1] = 1; maze[x][y] = 1; break;
        }
    }

    maze[current.x][current.y] = 1;
    do {
        let neighbors = getNeighbors(current.x, current.y);
        if (neighbors.length > 0) {
            let next = neighbors[Math.floor(Math.random() * neighbors.length)];
            carvePath(current.x, current.y, next.wall);
            maze[next.x][next.y] = 1;
            stack.push(current);
            current = next;
        } else if (stack.length > 0) {
            current = stack.pop();
        }
    } while (stack.length > 0);

	// The maze is too dense, so we remove some random walls
	let removedWalls = 0;
	while (removedWalls < (rows*3)) {
		let x = Math.floor(Math.random() * rows) * 2;
		let y = Math.floor(Math.random() * columns) * 2;
		if (maze[x][y] == 0 && isInsideMaze(x, y)) {
			maze[x][y] = 1;
			removedWalls++;
		}
	}

	const { container } = await client.createContainer(containerSchema, "2");
	globalContainer = container;
	initialMaze.rows = maze;
	playerNumber = 1;
	initials = prompt("Please enter your 2-3 letter initials");
	player = getRandomPosition(initialMaze);
	initialMaze.playerList.push(player);
	const sharedTree = container.initialObjects.mazeTree.viewWith(treeConfiguration);
	sharedTree.initialize(new Maze(initialMaze));

	const id = await container.attach();

	const mazeModel = sharedTree.root;
	player = {...mazeModel.playerList.find(p => p.number === playerNumber)};
	globalMazeRef = sharedTree.root;
	window.maze = sharedTree.root;

	drawMaze(mazeModel, root);
	Tree.on(mazeModel.playerList, "treeChanged", drawMaze);
	return id;
    // return maze;
}

function getRandomPosition(mazeModel) {
	let number, x, y;
	do {
		number = playerNumber;
		x = Math.floor(Math.random() * mazeModel.rows.length);
		y = Math.floor(Math.random() * (mazeModel.rows[0] && mazeModel.rows[0].length || mazeModel.rows.length));
	} while (mazeModel.rows[y][x] === 0);
	return { number, x, y, initials, uuid: Math.random().toString(36)};
}

let initialMazeDrawn = false;

// Draw the maze
function drawMaze(mazeModel, root) {
	// Apparently the Tree.on() method passes a new argument now that is not the tree itself
		mazeModel = globalMazeRef;
	// }
	// If current player was removed from the playerlist, it means you lost the game. Remove from the maze.
	if (player && !mazeModel.playerList.find(p => p.number === player.number)) {
		player = null;
	}
    let table = document.querySelector('table');
    if (!table) {
        table = document.createElement('table');
        table.style.width = "100%"; // Set the table width to 100% of the document
        table.style.height = "100%"; // Set the table height to 100% of the document
        document.body.appendChild(table);
    }

    for (let i = 0; i < mazeModel.rows.length; i++) {
        let row = table.rows[i] || table.insertRow();
        for (let j = 0; j < mazeModel.rows[i].length; j++) {
            let cell = row.cells[j] || row.insertCell();
            cell.style.width = '20px'; // Set a fixed width
            cell.style.height = '20px'; // Set a fixed height
            if (mazeModel.rows[i][j] === 0) {
				if(!initialMazeDrawn) {
					cell.style.backgroundColor = 'black';
					cell.style.width = '20px'; // Set a fixed width
					cell.style.height = '20px'; // Set a fixed height
					cell.style.border = 'none'; // Remove the border
					let text = cell.querySelector('span') || document.createElement('span'); 
					text.textContent = '';
				}
            } else if (player && i === player.y && j === player.x) {
                cell.style.backgroundColor = playerColor;
                cell.style.border = '3px solid black'; // Add a dark border
                cell.style.width = '14px'; // Adjust the width to account for the border
                cell.style.height = '14px'; // Adjust the height to account for the border
                cell.style.position = 'relative'; // Make the cell a relative container

                let text = cell.querySelector('span') || document.createElement('span'); // Create a new span element for the text
                text.textContent = initials; // Set the text
                text.style.position = 'absolute'; // Position the text absolutely
                text.style.top = '50%'; // Center the text vertically
                text.style.left = '50%'; // Center the text horizontally
                text.style.transform = 'translate(-50%, -50%)'; // Ensure the text is centered
                text.style.color = 'black'; // Set the text color to black

                cell.appendChild(text); // Add the text to the cell
            } else {
                cell.style.backgroundColor = 'white'
				cell.style.width = '20px'; // Set a fixed width
				cell.style.height = '20px'; // Set a fixed height
				cell.style.border = 'none'; // Remove the border
				let text = cell.querySelector('span') || document.createElement('span'); 
				text.textContent = '';
            }
        }
    }

	// add other players from the playerList
	mazeModel.playerList.filter(p => p.number !== playerNumber).forEach(player => {
		let cell = table.rows[player.y].cells[player.x];
		cell.style.backgroundColor = otherPlayerColor;
		cell.style.border = '3px solid black'; // Add a dark border
		cell.style.width = '14px'; // Adjust the width to account for the border
		cell.style.height = '14px'; // Adjust the height to account for the border
		cell.style.position = 'relative'; // Make the cell a relative container

		let text = cell.querySelector('span') || document.createElement('span'); // Create a new span element for the text
		text.textContent = player.initials; // Set the text
		text.style.position = 'absolute'; // Position the text absolutely
		text.style.top = '50%'; // Center the text vertically
		text.style.left = '50%'; // Center the text horizontally
		text.style.transform = 'translate(-50%, -50%)'; // Ensure the text is centered
		text.style.color = 'black'; // Set the text color to black

		cell.appendChild(text); // Add the text to the cell
	});
	initialMazeDrawn = true;
}

// Generate a random bold color
function getRandomColor() {
    let color = "#";
    for (let i = 0; i < 3; i++) {
        let component = Math.floor(Math.random() * (256 - 128) + 128).toString(16);
        color += component.length === 1 ? "0" + component : component;
    }
    return color;
}

async function start() {
	if (location.hash) {
		console.log("Loading existing maze: ", location.hash.substring(1));
		await loadExistingMaze(location.hash.substring(1));
	} else {
		console.log("Generating new maze");
		const id = await generateMaze(mazeRows, mazeColumns);
		console.log("New maze id: ", id);
		location.hash = id;
		setTimeout(() => {
			let aiPlayer = getRandomPosition(globalMazeRef);
			aiPlayer.initials = "AI";
			aiPlayer.number = globalMazeRef.playerList.length + 1;
			globalMazeRef.playerList.insertAtEnd(aiPlayer);
		}, 5000);
		setTimeout(() => {
			updateAiPlayer();
		}, 10000);
	}
}

// Periodically check if the game has an AI player and call chatgpt to get the next move
const updateAiPlayer = () => {
	const aiPlayer = globalMazeRef.playerList.find(p => p.initials === "AI");
	if (aiPlayer) {
		console.log("AI player found");
		const serializedGameState = JSON.stringify(globalMazeRef);
		const prompt = "This is a 2D maze game with multiple human players and you, an AI player. \
		The game state is represented by a 2D array of 0s and 1s, where 0 represents a wall and 1 represents a path. \
		Rows are listed top to bottom, with each row listing the value in each column from left to right. \
		You can't go through walls, so you should only move in directions where an open path exists. \
		The game state is updated in real-time as players move around the maze. \
		When players collide, one of the players is randomly chosen and eliminated. \
		You should either chase other players or run away from them. \
		The game ends when only one player remains. \
		Your task is to predict the next 10 moves of the AI player based on the current game state. \
		Please only respond with 10 arrow key moves for the AI player, consisting of 'ArrowUp,' 'ArrowDown,' 'ArrowLeft,' or 'ArrowRight.' \
		You can put it in a JSON object with a comma separated list of moves like {'moves': 'ArrowUp,ArrowUp,ArrowLeft,ArrowLeft,ArrowDown,ArrowUp,ArrowUp,ArrowLeft,ArrowLeft,ArrowDown'} but don't wrap the JSON in a code block. \
		The game state is as follows: " + serializedGameState;
		// call chatgpt to get the next move
		fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": "Bearer <your-token-here>",
				"Accept": "application/json"
			},
			body: JSON.stringify({
				"max_tokens": 50,
				"model": "gpt-4o",
				"messages": [
					{
						"role": "user",
						"content": prompt
					}
				]
			})
		}).then(response => response.json()).then(data => {
			// check if status is 200
			if (data.error) {
				console.error("AI response error: ", data.error);
				return;
			}
			console.log("AI response: ", data);
			const moveText = data.choices[0].message.content.replace(/'/g, "\"");
			console.log("AI move text: ", moveText);
			const moves = moveText && JSON.parse(moveText).moves.split(",");
			console.log("AI moves: ", moves);
			// update the AI player's position based on the moves but add a slight delay between each move
			moves.forEach((move, index) => {
				setTimeout(() => {
					console.log("AI move: ", move);
					let newX = globalMazeRef.playerList.find(p => p.initials === "AI").x;
					let newY = globalMazeRef.playerList.find(p => p.initials === "AI").y;
					switch (move) {
						case "ArrowUp":
							newY--;
							break;
						case "ArrowDown":
							newY++;
							break;
						case "ArrowLeft":
							newX--;
							break;
						case "ArrowRight":
							newX++;
							break;
					}
					if (globalMazeRef.rows[newY][newX] === 1) {
						const collidedPlayer = globalMazeRef.playerList.find(p => p.number !== aiPlayer.number && p.x === newX && p.y === newY);
						if (collidedPlayer) {
							console.log("AI collided with player", collidedPlayer.number);
						} else {
							globalMazeRef.playerList.find(p => p.initials === "AI").x = newX;
							globalMazeRef.playerList.find(p => p.initials === "AI").y = newY;
						}
					}
				}, index * 250);
			});
			// call updateAiPlayer again after all moves have been processed
			setTimeout(() => {
				updateAiPlayer();
			}, moves.length * 250);
		}).catch(error => console.error(error));
	}
};

start().then(() => {
	// Handle keyboard events
	document.addEventListener('keydown', function(e) {
		e.preventDefault(); // Prevent default scrolling behavior
		if(!player) return;
		let newX = player.x;
		let newY = player.y;
		// make a copy of player.x instead of taking a reference
		switch (e.key) {
			case 'ArrowUp':
				newY--;
				break;
			case 'ArrowDown':
				newY++;
				break;
			case 'ArrowLeft':
				newX--;
				break;
			case 'ArrowRight':
				newX++;
				break;
		}
		if (globalMazeRef.rows[newY][newX] === 1) {
			const collidedPlayer = globalMazeRef.playerList.find(p => p.number !== player.number && p.x === newX && p.y === newY);
			// const collidedPlayer = null;
			if (collidedPlayer) {
				console.log("Player", player.number, "collided with player", collidedPlayer.number);
				const currentPlayer = globalMazeRef.playerList.find(p => p.number === player.number);
				const winningPlayer = Math.random() < 0.5 ? currentPlayer : collidedPlayer;
				const losingPlayer = winningPlayer === currentPlayer ? collidedPlayer : currentPlayer;
				const losingPlayerIndex = globalMazeRef.playerList.findIndex(p => p.number === losingPlayer.number);
				if (losingPlayerIndex !== -1) {
					globalMazeRef.playerList.removeAt(losingPlayerIndex);
					console.log("Player", losingPlayer.number, "has been removed from the game.");
					if (losingPlayer.number === playerNumber) {
						player = null;
						// Show the game over screen
						let gameOverScreen = document.getElementById('game-over-screen');
						gameOverScreen.style.display = 'block';
						// Remove the game over screen after the animation ends
						setTimeout(() => gameOverScreen.style.display = 'none', 2000);
					} else {
						player.x = newX;
						player.y = newY;
						Tree.runTransaction(globalMazeRef.playerList, (playerList) => {
							// only change the player's position if it has changed from previous value
							if(currentPlayer.x !== player.x) {
								currentPlayer.x = player.x;
							}
							if(currentPlayer.y !== player.y) {
								currentPlayer.y = player.y;
							}
						});
						// if the player is the last player remaining, they win
						if (globalMazeRef.playerList.length === 1) {
							console.log("Player", winningPlayer.number, "has won the game!");
							alert("Player " + winningPlayer.number + " with initials " + winningPlayer.initials + " has won the game!");
						}
					}
				}
			} else {
				player.x = newX;
				player.y = newY;
				Tree.runTransaction(globalMazeRef.playerList, (playerList) => {
					const currentPlayer = playerList.find(p => p.number === player.number);
					// only change the player's position if it has changed from previous value
					if(currentPlayer.x !== player.x) {
						currentPlayer.x = player.x;
					}
					if(currentPlayer.y !== player.y) {
						currentPlayer.y = player.y;
					}
				});
			}
		}
	});
}).catch((error) => console.error(error));
