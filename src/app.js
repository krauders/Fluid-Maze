/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { SharedTree, SchemaFactory, Tree, TreeViewConfiguration } from "fluid-framework";
import { TinyliciousClient } from "@fluidframework/tinylicious-client";

const client = new TinyliciousClient();
const containerSchema = {
	initialObjects: { doc: SharedTree },
};
const root = document.getElementById("content");
// The string passed to the SchemaFactory should be unique
const sf = new SchemaFactory("doc");
class Lines extends sf.array("Lines", sf.string) {}
// Here we define an object we'll use in the schema, a document.
class Doc extends sf.object("Doc", {
	lines: Lines
}) {}

// Here we define the tree schema, which has a single doc object.
const treeConfiguration = new TreeViewConfiguration({
	schema: Doc,
});

let doc = null;

// method to check if the connection state is 2 (connected) and if not, wait for 5 seconds and check again
const checkConnectionState = async (container) => {
	if (container.connectionState !== 2) {
		console.log("Container connection state:" + container.connectionState);
		await new Promise((resolve) => setTimeout(resolve, 5000));
		await checkConnectionState(container);
	}
};

const loadExistingDoc = async (id) => {
	console.log("Getting container: ", id);
	const { container } = await client.getContainer(id, containerSchema).catch((error) => {
		console.error("Error getting container: ", error);
		// redirect to root path
		// location.href = "/";
	});
	const sharedTree = container.initialObjects.doc.viewWith(treeConfiguration);
	const docModel = sharedTree.root;
	Tree.on(docModel.lines, "treeChanged", drawDoc);
	await checkConnectionState(container);
	doc = docModel;
	drawDoc();
};

const generateDoc = async() => {

	const { container } = await client.createContainer(containerSchema, "2");
	const sharedTree = container.initialObjects.doc.viewWith(treeConfiguration);
	sharedTree.initialize(new Doc({ lines: ["Hello, World!"]}));
	const id = await container.attach();
	const docModel = sharedTree.root;
	Tree.on(docModel.lines, "treeChanged", drawDoc);
	doc = docModel;
	drawDoc();
	return id;
}


async function start() {
	if (location.hash) {
		console.log("Loading existing doc: ", location.hash.substring(1));
		await loadExistingDoc(location.hash.substring(1));
	} else {
		console.log("Generating new doc");
		const id = await generateDoc();
		console.log("New doc id: ", id);
		location.hash = id;
	}
}

let activeIndex = -1;
let savedOffset = null;
let cursorPositionDirty = false;

const drawDoc = () => {
	// console.log("Drawing doc");
	const lines = doc.lines;
	const activeElement = document.activeElement;

	// Check if the active element is one of our line elements and save the cursor position as an offset
	if (activeElement && activeElement.contentEditable === "true" && !cursorPositionDirty) {
		activeIndex = Array.from(root.children).indexOf(activeElement);
		const selection = window.getSelection();
		if (selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			savedOffset = range.startOffset; // Save cursor position as an offset
		}
	}

	// destroy all existing lines because we will recreate them
	while (root.firstChild) {
		root.removeChild(root.firstChild);
	}

	// Update existing lines or add new ones as needed
	lines.forEach((line, index) => {
		let lineElement = root.children[index];
		if (!lineElement) {
			lineElement = document.createElement("div");
			root.appendChild(lineElement);
		
			lineElement.textContent = line;
			lineElement.contentEditable = "true";
			lineElement.style.width = "600px"; // Set a fixed width of 400px

			lineElement.addEventListener("input", () => {
				// console.log("Line " + index + " edited: " + lineElement.textContent);
				Tree.runTransaction(lines, () => {
					// If no new lines, just update the current line
					lines.removeAt(index);
					lines.insertAt(index, lineElement.textContent);
				});
				// Redraw the document to reflect the changes
				// drawDoc();
			});
			
			lineElement.addEventListener("keydown", (e) => {
				// console.log("index: ", index, "activeIndex: " + activeIndex + " savedOffset: " + savedOffset);
				if (e.key === "Enter") {
					e.preventDefault(); // Prevent the default action to avoid inserting a <div> or <br>
					// console.log("Enter key detected");
			
					// Split the current line at the cursor position
					const selection = window.getSelection();
					const range = selection.getRangeAt(0);
					const cursorPosition = range.startOffset;
					const currentText = lineElement.textContent;
					const beforeEnter = currentText.substring(0, cursorPosition);
					const afterEnter = currentText.substring(cursorPosition);
					// console.log("beforeEnter: ", beforeEnter);
					// console.log("afterEnter: ", afterEnter);

					// console.log("index: " + index);
					document.activeElement.blur();
			
					Tree.runTransaction(doc.lines, (lines) => {
						// console.log("index 2: " + index);
						// Remove the current line
						doc.lines.removeAt(index);
						// Insert two new lines at the same index
						doc.lines.insertAt(index, beforeEnter);

						doc.lines.insertAt(index + 1, afterEnter);
						// Optionally, set the cursor position to the beginning of the new line
						// console.log("setting active index to " + (index + 1))
						activeIndex = index + 1;
						savedOffset = 0;
						cursorPositionDirty = true;
						// remove focus from the current element
						document.activeElement.blur();
						drawDoc();
						updateAi();
					});
				} 
			});
		}
		
	});

	// Remove excess line elements
	while (root.children.length > lines.length) {
		root.removeChild(root.lastChild);
	}

	// Restore focus and cursor position if applicable
	if (activeIndex !== -1 && savedOffset !== null) {
		try {
			const newActiveElement = root.children[activeIndex];
			if (newActiveElement) {
				newActiveElement.focus();
				const range = document.createRange();
				const sel = window.getSelection();
				const textNode = newActiveElement.childNodes[0] || newActiveElement;
				range.setStart(textNode, savedOffset);
				range.collapse(true);
				sel.removeAllRanges();
				sel.addRange(range);
				cursorPositionDirty = false;
			}
		} catch (error) {
			// console.error("Error restoring cursor position: ", error);
			cursorPositionDirty = true;
		}
	}
};

// Periodically check if the game has an AI player and call chatgpt to get the next move
const updateAi = () => {
		// console.log("Calling copilot");
		const serializedDoc = JSON.stringify(doc.lines);
		const prompt = 'You are collaborating on a document in real time with at least one human collaborator. You are a helpful assistant that contributes when people leave comments asking you to contribute. \
		The document is a list of lines. I will send you the updated document every time a new line is added. \
		You can decide whether you wish to make a contribution or not. If you do, please provide a JSON response like this: \
		{"changes": [{"removeLine": {"index": 3}}, {"addLine": {"index": 4, "text": "new line"}}, {"addLine": {"index": 5, "text": "new line 2"}} ]} \
		Make sure you do not add any other text or code block information, send only the JSON. \
		If you contribute a list of ideas, put each idea on a separate line. \
		Please make sure your JSON is always well formed. \
		If you do not want to make a contribution, please respond with an empty JSON message and do not add any other text. \
		If there are comments suggesting AI or assistant or copilot will help, then please make a contribution. \
		If you address a comment fully, make sure to remove the comment itself too. \
		The current document is: ' + serializedDoc;
		fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": "Bearer <openai-token-here>",
				"Accept": "application/json"
			},
			body: JSON.stringify({
				"max_tokens": 4000,
				"model": "gpt-4-turbo",
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
			// console.log("AI response: ", data);
			const responseText = data.choices[0].message.content.replace(/'/g, "\"");
			// console.log("AI text: ", responseText);
			const aiContributions = responseText && JSON.parse(responseText);
			if(aiContributions && aiContributions.changes) {
				console.log("AI contributions: ", aiContributions.changes);
				try {
					Tree.runTransaction(doc.lines, (lines) => {
						aiContributions.changes.forEach(aiContribution => {
							if (aiContribution.removeLine) {
								lines.removeAt(aiContribution.removeLine.index);
							}
						});
					});
				} catch (error) {
					console.error("Error running transaction:", error);
				}
				aiContributions.changes.forEach((aiContribution, index) => {
					if (aiContribution.addLine) {
						setTimeout(() => {
							doc.lines.insertAt(Math.min(aiContribution.addLine.index, doc.lines.length), aiContribution.addLine.text);
						}, (index + 1) * 200); // Delay each line by 1 second
					}
				});
			}

		}).catch(error => console.error(error));
};

start().then(() => {
	// 
}).catch((error) => console.error(error));
