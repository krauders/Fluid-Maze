/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { SharedMatrix } from "@fluidframework/matrix";
import { TinyliciousClient } from "@fluidframework/tinylicious-client";
import { SharedTree, SchemaFactory, TreeViewConfiguration } from "fluid-framework";

// Number of iterations to run for each file when doing a full performance test
const FULL_TEST_ITERATIONS = 5;

const client = new TinyliciousClient();
const containerSchema = {
    initialObjects: { 
		sharedMatrix: SharedMatrix,
		sharedTree: SharedTree
	},
};
const sf = new SchemaFactory("sharedMatrixPerf");
class Columns extends sf.array("Columns", sf.string) {}
class Rows extends sf.array("Rows", Columns) {}
class Table extends sf.object("Table", {
	rows: Rows
}) {};
const treeConfiguration = new TreeViewConfiguration({
	schema: Table,
});

const table = document.getElementById("matrixTable");
const csvFileInput = document.getElementById("csvFile");

const attachContainerCheckbox = document.getElementById("attachContainer");
const handleQuotesCheckbox = document.getElementById("handleQuotes");
const renderTableCheckbox = document.getElementById("renderTable");
const logArea = document.getElementById("logArea");

// Override console.log to display logs in the logArea
const originalConsoleLog = console.log;
console.log = (...args) => {
    originalConsoleLog(...args);
    const logMessage = args.map(arg => (typeof arg === "object" ? JSON.stringify(arg) : arg)).join(" ");
    const logEntry = document.createElement("div");
    logEntry.textContent = logMessage;
    logArea.appendChild(logEntry);
    logArea.scrollTop = logArea.scrollHeight; // Auto-scroll to the bottom
};

const ddsSelector = document.getElementById("ddsSelector");
let sharedMatrix;
let sharedTree;
let sharedTreeView;

async function start() {
    console.log("Starting the app");

    // Create a detached container
    const { container } = await client.createContainer(containerSchema, "2");
    console.log("Container attachState: ", container.attachState);

    // Access the DDS objects from the container's initialObjects
    sharedMatrix = container.initialObjects.sharedMatrix;
    sharedTreeView = container.initialObjects.sharedTree.viewWith(treeConfiguration);
	sharedTreeView.initialize(new Table({rows: []}));
    sharedTree = container.initialObjects.sharedTree;
	console.log(sharedTreeView.compatibility);

    let currentDDS = sharedMatrix; // Default DDS is SharedMatrix

    // Listen for DDS selection changes
    ddsSelector.addEventListener("change", (event) => {
        const selectedDDS = event.target.value;
        if (selectedDDS === "SharedMatrix") {
            currentDDS = sharedMatrix;
            console.log("Switched to SharedMatrix");
        } else if (selectedDDS === "SharedTree") {
            currentDDS = sharedTree;
            console.log("Switched to SharedTree");
        }
    });

    // Listen for CSV file upload
    csvFileInput.addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (file) {
            const handleQuotes = handleQuotesCheckbox.checked;
            console.log("Reading CSV file: ", file.name);
            const csvData = await readCSVFile(file, handleQuotes);
            console.log("Finished reading CSV file: ", file.name);
            console.log("Populating selected DDS with CSV data");

            if (currentDDS === sharedMatrix) {
                populateSharedMatrix(sharedMatrix, csvData);
                renderMatrix(sharedMatrix);
            } else if (currentDDS === sharedTree) {
                populateSharedTree(sharedTreeView, csvData);
                renderTree(sharedTreeView);
            }
        }
    });

    // Optionally attach the container
    attachContainerCheckbox.addEventListener("change", async () => {
        if (attachContainerCheckbox.checked) {
            const containerId = await container.attach();
            console.log("Container attached with ID:", containerId);
        } else {
            console.log("Container not attached");
        }
    });

    // Listen for changes in the SharedMatrix or SharedTree and update the UI
    sharedMatrix.on("valueChanged", () => {
        if (currentDDS === sharedMatrix) {
            renderMatrix(sharedMatrix);
        }
    });

    sharedTree.on("valueChanged", () => {
        if (currentDDS === sharedTree) {
            renderTree(sharedTree);
        }
    });
}

// Function to render the SharedTree as an HTML list
function renderTree(sharedTreeView) {
    console.log("Rendering SharedTree");

    // Clear the existing table
    table.innerHTML = "";

    // Traverse the rows and columns in the tree
    const rootNode = sharedTreeView.root;
    const rows = rootNode.rows || [];

    // Get the max rows to render from the input
	const renderTable = renderTableCheckbox.checked;

    // Don't try to render the table unless the user wants it, as it can be slow for large datasets
    if (!renderTable) {
        return;
    }

    rows.forEach((row, rowIndex) => {
        const tr = document.createElement("tr");
        row.forEach((cell, colIndex) => {
            const td = document.createElement("td");
            td.textContent = cell || ""; // Render the cell value
            tr.appendChild(td);
        });
        table.appendChild(tr);
    });

    console.log("SharedTree rendered");
}

// Function to render the SharedMatrix as an HTML table
function renderMatrix(sharedMatrix) {
    // Clear the existing table
    table.innerHTML = "";

    // Get the dimensions of the matrix
    const rowCount = sharedMatrix.rowCount;
    const colCount = sharedMatrix.colCount;

    // Get the max rows to render from the input
	const renderTable = renderTableCheckbox.checked;

    // Don't try to render the table unless the user wants it, as it can be slow for large datasets
    if (!renderTable) {
        return;
    }

    // Create table rows and cells
    for (let row = 0; row < rowCount; row++) {
        const tr = document.createElement("tr");
        for (let col = 0; col < colCount; col++) {
            const td = document.createElement("td");
            td.textContent = sharedMatrix.getCell(row, col) || "";
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
}

// Function to read a CSV file and parse its contents
function readCSVFile(file, handleQuotes = true) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target.result;

            if (!handleQuotes) {
                // Basic parsing: Split by commas and newlines
                const rows = text
                    .split("\n")
                    .map((row) => row.split(",").map((cell) => cell.trim()))
                    .filter((row) => row.length > 0 && row.some((cell) => cell !== ""));

                // Determine the maximum number of columns
                const maxColCount = Math.max(...rows.map((row) => row.length));

                // Pad rows with missing cells to ensure consistent column count
                const paddedRows = rows.map((row) => {
                    while (row.length < maxColCount) {
                        row.push(""); // Add empty strings for missing cells
                    }
                    return row;
                });

                resolve(paddedRows);
                return;
            }

            // Advanced parsing: Handle quotes and commas inside quotes
            const rows = [];
            let currentRow = [];
            let currentCell = "";
            let insideQuotes = false;

            for (let i = 0; i < text.length; i++) {
                const char = text[i];

                if (char === '"' && (i === 0 || text[i - 1] !== "\\")) {
                    // Toggle the insideQuotes flag when encountering an unescaped double quote
                    insideQuotes = !insideQuotes;
                } else if (char === "," && !insideQuotes) {
                    // If not inside quotes, treat a comma as a cell delimiter
                    currentRow.push(currentCell.trim());
                    currentCell = "";
                } else if (char === "\n" && !insideQuotes) {
                    // If not inside quotes, treat a newline as a row delimiter
                    currentRow.push(currentCell.trim());
                    rows.push(currentRow);
                    currentRow = [];
                    currentCell = "";
                } else {
                    // Otherwise, add the character to the current cell
                    currentCell += char;
                }
            }

            // Add the last cell and row if necessary
            if (currentCell) {
                currentRow.push(currentCell.trim());
            }
            if (currentRow.length > 0) {
                rows.push(currentRow);
            }

            // Determine the maximum number of columns
            const maxColCount = Math.max(...rows.map((row) => row.length));

            // Pad rows with missing cells to ensure consistent column count
            const paddedRows = rows.map((row) => {
                while (row.length < maxColCount) {
                    row.push(""); // Add empty strings for missing cells
                }
                return row;
            });

            resolve(paddedRows);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsText(file);
    });
}

let sharedMatrixChart, sharedTreeChart;
const sharedMatrixData = {}; // Store data grouped by the number of cells for SharedMatrix
const sharedTreeData = {}; // Store data grouped by the number of cells for SharedTree

// Initialize the charts
function initializeCharts() {
    const matrixCtx = document.getElementById("sharedMatrixChart").getContext("2d");
    const treeCtx = document.getElementById("sharedTreeChart").getContext("2d");

    sharedMatrixChart = new Chart(matrixCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Average Time to Set Cells (ms)",
                    data: [],
                    borderColor: "rgba(75, 192, 192, 1)",
                    backgroundColor: "rgba(75, 192, 192, 0.2)",
                    borderWidth: 2,
                    fill: true,
                },
            ],
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: true,
                },
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: "Number of Cells",
                    },
                },
                y: {
                    title: {
                        display: true,
                        text: "Average Time (ms)",
                    },
                },
            },
        },
    });

    sharedTreeChart = new Chart(treeCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Average Time to Set Cells (ms)",
                    data: [],
                    borderColor: "rgba(255, 99, 132, 1)",
                    backgroundColor: "rgba(255, 99, 132, 0.2)",
                    borderWidth: 2,
                    fill: true,
                },
            ],
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: true,
                },
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: "Number of Cells",
                    },
                },
                y: {
                    title: {
                        display: true,
                        text: "Average Time (ms)",
                    },
                },
            },
        },
    });
}

// Update the chart with new data
function updateChart(chart, dataStore, numCells, timeTaken) {
    // Group data by the number of cells
    if (!dataStore[numCells]) {
        dataStore[numCells] = [];
    }
    dataStore[numCells].push(timeTaken);

    // Calculate the average time for each group
    const labels = Object.keys(dataStore).map(Number).sort((a, b) => a - b);
    const averages = labels.map((cells) => {
        const times = dataStore[cells];
        return times.reduce((sum, time) => sum + time, 0) / times.length;
    });

    // Update the chart
    chart.data.labels = labels;
    chart.data.datasets[0].data = averages;
    chart.update();
}

// Example usage in populateSharedMatrix
function populateSharedMatrix(sharedMatrix, csvData) {
    const rowCount = csvData.length;
    const colCount = csvData[0]?.length || 0;

    console.log("Row count: ", rowCount);
    console.log("Col count: ", colCount);

    // Resize the SharedMatrix
    if (sharedMatrix.rowCount > 0) {
        sharedMatrix.removeRows(0, sharedMatrix.rowCount);
    }
    if (sharedMatrix.colCount > 0) {
        sharedMatrix.removeCols(0, sharedMatrix.colCount);
    }
    sharedMatrix.insertRows(0, rowCount);
    sharedMatrix.insertCols(0, colCount);

    // Populate the matrix with data
    const start = performance.now();
    for (let row = 0; row < rowCount; row++) {
        for (let col = 0; col < colCount; col++) {
            sharedMatrix.setCell(row, col, csvData[row][col]);
        }
    }
    const end = performance.now();
    const timeTaken = end - start;

    console.log("Populating SharedMatrix took:", timeTaken, "ms");

    // Update the SharedMatrix chart
    updateChart(sharedMatrixChart, sharedMatrixData, rowCount * colCount, timeTaken);
}

// Example usage in populateSharedTree
function populateSharedTree(sharedTreeView, csvData) {
    console.log("Populating SharedTree with CSV data");

    // Clear the existing tree by resetting the rows array
    const rootNode = sharedTreeView.root;
    rootNode.rows = []; // Reset the rows array to clear the tree

    // Populate the tree with rows and columns
    const rows = csvData.map((row) => {
        return row.map((cell) => cell); // Each cell is a string
    });

    const start = performance.now();
    rootNode.rows = rows; // Assign the new rows to the root node
    const end = performance.now();
    const timeTaken = end - start;

    console.log("Populating SharedTree took:", timeTaken, "ms");

    // Update the SharedTree chart
    updateChart(sharedTreeChart, sharedTreeData, rows.length * (rows[0]?.length || 0), timeTaken);
}

// Initialize the charts when the app starts
initializeCharts();

const fullPerformanceTestButton = document.getElementById("fullPerformanceTest");
const runningIcon = document.getElementById("runningIcon");

async function runFullPerformanceTest() {
    console.log("Starting full performance test...");
    runningIcon.style.display = "inline"; // Show the running icon

    const testFilesFolder = ""; // Folder containing test CSV files
    const testFiles = await fetchTestFiles(testFilesFolder); // Fetch the list of test files
    const iterations = FULL_TEST_ITERATIONS; // Number of times to test each file with each DDS

    for (const fileName of testFiles) {
        console.log(`Testing file: ${fileName}`);
        const fileContent = await fetchFileContent(`${testFilesFolder}/${fileName}`);

        for (let i = 0; i < iterations; i++) {
            console.log(`Iteration ${i + 1} for SharedMatrix`);
            await testDDS("SharedMatrix", fileContent);

            console.log(`Iteration ${i + 1} for SharedTree`);
            await testDDS("SharedTree", fileContent);
        }
    }

    runningIcon.style.display = "none"; // Hide the running icon
    console.log("Full performance test completed.");
}

// Fetch the list of test files from the /testFiles folder
async function fetchTestFiles(folderPath) {
    // Simulate fetching file names (replace with actual server-side logic if needed)
    return [
		"customers-100.csv", 
		"customers-1000.csv", 
		"customers-5000.csv", 
		"customers-10000.csv",
		"customers-20000.csv", 
		"customers-30000.csv",
		"customers-40000.csv",
		"customers-50000.csv",
		"customers-60000.csv",
		"customers-70000.csv",
		"customers-80000.csv",
		"customers-90000.csv",
		"customers-100000.csv"
	];
}

// Fetch the content of a specific file
async function fetchFileContent(filePath) {
    const response = await fetch(filePath);
    if (!response.ok) {
        throw new Error(`Failed to fetch file: ${filePath}`);
    }
    return await response.text();
}

// Test a specific DDS with the given file content
async function testDDS(ddsType, fileContent) {
    const csvData = parseCSV(fileContent); // Parse the CSV content into an array

    if (ddsType === "SharedMatrix") {
        const start = performance.now();
        populateSharedMatrix(sharedMatrix, csvData);
        const end = performance.now();
        const timeTaken = end - start;
        console.log(`SharedMatrix test completed in ${timeTaken} ms`);
        updateChart(sharedMatrixChart, sharedMatrixData, csvData.length * csvData[0].length, timeTaken);
    } else if (ddsType === "SharedTree") {
        const start = performance.now();
        populateSharedTree(sharedTreeView, csvData);
        const end = performance.now();
        const timeTaken = end - start;
        console.log(`SharedTree test completed in ${timeTaken} ms`);
        updateChart(sharedTreeChart, sharedTreeData, csvData.length * csvData[0].length, timeTaken);
    }
}

// Parse CSV content into a 2D array
function parseCSV(content) {
    const rows = content.split("\n").map((row) => row.split(","));
    return rows;
}

// Attach event listener to the button
fullPerformanceTestButton.addEventListener("click", runFullPerformanceTest);

start().then(() => {
    console.log("App started");
}).catch((error) => console.error(error));