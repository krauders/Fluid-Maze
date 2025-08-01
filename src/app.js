/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { SharedMatrix } from "@fluidframework/matrix";
import { TinyliciousClient } from "@fluidframework/tinylicious-client";
import { SharedTree, TreeViewConfiguration } from "fluid-framework";
import { SchemaFactoryAlpha, TableSchema } from "fluid-framework/alpha";

// Number of iterations to run for each file when doing a full performance test
const FULL_TEST_ITERATIONS = 2;


const client = new TinyliciousClient();
const containerSchema = {
    initialObjects: { 
		sharedMatrix: SharedMatrix,
		sharedTree: SharedTree
	},
};
const schemaFactory = new SchemaFactoryAlpha("test-app");

/**
 * Defines the schema for a table cell.
 */
export const Cell = schemaFactory.string;

/**
 * Defines the schema for a table column.
 */
export class Column extends TableSchema.column({
	schemaFactory,
	cell: Cell,
}) {}

/**
 * Defines the schema for a table row.
 */
export class Row extends TableSchema.row({
	schemaFactory,
	cell: Cell,
}) {}

/**
 * Defines the schema for a table, which includes columns and rows.
 * It uses the previously defined Cell, Column, and Row schemas.
 */
export class Table extends TableSchema.table({
	schemaFactory,
	cell: Cell,
	column: Column,
	row: Row,
}) {}
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
    
    // Initialize SharedTree with proper schema if not already initialized
    if (sharedTreeView.compatibility.canView === false) {
        // For TableSchema.table, we need to initialize with empty structure
        sharedTreeView.initialize(Table.empty());
    }
    
    sharedTree = container.initialObjects.sharedTree;
    console.log("SharedTree compatibility:", sharedTreeView.compatibility);    
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

/**
 * Performance monitoring Chart.js instances for visualizing SharedMatrix vs SharedTree comparison data
 * 
 * @var {Chart} creationTimeChart - Line chart displaying execution time (ms) for initial data population operations across different dataset sizes
 * @var {Chart} creationMemoryChart - Line chart showing memory consumption (MB) during data creation/insertion phase
 * @var {Chart} updateTimeChart - Line chart measuring time performance for cell modification operations (adding "_updated" suffix to existing data)
 * @var {Chart} updateMemoryChart - Line chart tracking memory usage during bulk data update operations
 * @var {Chart} removeTimeChart - Line chart monitoring execution time for complete data structure cleanup (removing all rows/columns)
 * @var {Chart} removeMemoryChart - Line chart displaying memory changes during data removal operations
 * 
 * Each chart compares SharedMatrix (blue) vs SharedTree (purple) performance across dataset sizes from 100 to 10,000+ cells
 */
let creationTimeChart, creationMemoryChart, updateTimeChart, updateMemoryChart, removeTimeChart, removeMemoryChart;
const creationData = { sharedMatrix: {}, sharedTree: {} }; // Store creation data
const updateData = { sharedMatrix: {}, sharedTree: {} }; // Store update data  
const removeData = { sharedMatrix: {}, sharedTree: {} }; // Store remove data

// Initialize the charts
function initializeCharts() {
    const creationTimeCtx = document.getElementById("creationTimeChart").getContext("2d");
    const creationMemoryCtx = document.getElementById("creationMemoryChart").getContext("2d");
    const updateTimeCtx = document.getElementById("updateTimeChart").getContext("2d");
    const updateMemoryCtx = document.getElementById("updateMemoryChart").getContext("2d");
    const removeTimeCtx = document.getElementById("removeTimeChart").getContext("2d");
    const removeMemoryCtx = document.getElementById("removeMemoryChart").getContext("2d");

    // Creation Time Chart
    creationTimeChart = new Chart(creationTimeCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "SharedMatrix",
                    data: [],
                    borderColor: "rgba(75, 192, 192, 1)",
                    backgroundColor: "rgba(75, 192, 192, 0.2)",
                    borderWidth: 2,
                    fill: false,
                },
                {
                    label: "SharedTree",
                    data: [],
                    borderColor: "rgba(153, 102, 255, 1)",
                    backgroundColor: "rgba(153, 102, 255, 0.2)",
                    borderWidth: 2,
                    fill: false,
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

    // Creation Memory Chart
    creationMemoryChart = new Chart(creationMemoryCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "SharedMatrix",
                    data: [],
                    borderColor: "rgba(255, 159, 64, 1)",
                    backgroundColor: "rgba(255, 159, 64, 0.2)",
                    borderWidth: 2,
                    fill: false,
                },
                {
                    label: "SharedTree",
                    data: [],
                    borderColor: "rgba(255, 99, 132, 1)",
                    backgroundColor: "rgba(255, 99, 132, 0.2)",
                    borderWidth: 2,
                    fill: false,
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
                        text: "Memory Usage (MB)",
                    },
                },
            },
        },
    });

    // Update Time Chart
    updateTimeChart = new Chart(updateTimeCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "SharedMatrix",
                    data: [],
                    borderColor: "rgba(75, 192, 192, 1)",
                    backgroundColor: "rgba(75, 192, 192, 0.2)",
                    borderWidth: 2,
                    fill: false,
                },
                {
                    label: "SharedTree",
                    data: [],
                    borderColor: "rgba(153, 102, 255, 1)",
                    backgroundColor: "rgba(153, 102, 255, 0.2)",
                    borderWidth: 2,
                    fill: false,
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

    // Update Memory Chart
    updateMemoryChart = new Chart(updateMemoryCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "SharedMatrix",
                    data: [],
                    borderColor: "rgba(255, 159, 64, 1)",
                    backgroundColor: "rgba(255, 159, 64, 0.2)",
                    borderWidth: 2,
                    fill: false,
                },
                {
                    label: "SharedTree",
                    data: [],
                    borderColor: "rgba(255, 99, 132, 1)",
                    backgroundColor: "rgba(255, 99, 132, 0.2)",
                    borderWidth: 2,
                    fill: false,
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
                        text: "Memory Usage (MB)",
                    },
                },
            },
        },
    });

    // Remove Time Chart
    removeTimeChart = new Chart(removeTimeCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "SharedMatrix",
                    data: [],
                    borderColor: "rgba(75, 192, 192, 1)",
                    backgroundColor: "rgba(75, 192, 192, 0.2)",
                    borderWidth: 2,
                    fill: false,
                },
                {
                    label: "SharedTree",
                    data: [],
                    borderColor: "rgba(153, 102, 255, 1)",
                    backgroundColor: "rgba(153, 102, 255, 0.2)",
                    borderWidth: 2,
                    fill: false,
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

    // Remove Memory Chart
    removeMemoryChart = new Chart(removeMemoryCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "SharedMatrix",
                    data: [],
                    borderColor: "rgba(255, 159, 64, 1)",
                    backgroundColor: "rgba(255, 159, 64, 0.2)",
                    borderWidth: 2,
                    fill: false,
                },
                {
                    label: "SharedTree",
                    data: [],
                    borderColor: "rgba(255, 99, 132, 1)",
                    backgroundColor: "rgba(255, 99, 132, 0.2)",
                    borderWidth: 2,
                    fill: false,
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
                        text: "Memory Usage (MB)",
                    },
                },
            },
        },
    });
}

/**
 * Update the time and memory charts with new data from performance tests
 * @param {Chart} timeChart - Chart.js instance for displaying time performance data (line chart showing execution time vs number of cells)
 * @param {Chart} memoryChart - Chart.js instance for displaying memory usage data (line chart showing memory consumption vs number of cells)
 * @param {Object} operationData - Data structure storing accumulated performance metrics, organized by DDS type and cell count: { sharedMatrix: { [numCells]: { times: [], memory: [] } }, sharedTree: { [numCells]: { times: [], memory: [] } } }
 * @param {string} ddsType - Type of Distributed Data Structure being tested, either "sharedMatrix" or "sharedTree"
 * @param {number} numCells - Total number of cells processed in this operation (rows × columns)
 * @param {number} timeTaken - Execution time in milliseconds for the operation (create/update/remove)
 * @param {number|null} memoryUsed - Memory usage in megabytes after the operation, or null if memory measurement is unavailable
 */
function updateSeparateCharts(timeChart, memoryChart, operationData, ddsType, numCells, timeTaken, memoryUsed) {
    // Group data by the number of cells for the specific DDS type
    if (!operationData[ddsType][numCells]) {
        operationData[ddsType][numCells] = { times: [], memory: [] };
    }
    operationData[ddsType][numCells].times.push(timeTaken);
    if (memoryUsed !== null && memoryUsed !== undefined) {
        console.log(`Adding memory data for ${ddsType}: ${memoryUsed} MB`);
        operationData[ddsType][numCells].memory.push(memoryUsed);
    } else {
        console.log(`No memory data available for ${ddsType} with ${numCells} cells`);
    }

    console.log(`Updating separate charts for ${ddsType} with ${numCells} cells:`);
    console.log(`Time taken: ${timeTaken} ms`);
    console.log(`Memory used: ${memoryUsed} MB`);

    // Get all unique cell counts from both DDS types
    const allCellCounts = new Set([
        ...Object.keys(operationData.sharedMatrix).map(Number),
        ...Object.keys(operationData.sharedTree).map(Number)
    ]);
    const labels = Array.from(allCellCounts).sort((a, b) => a - b);

    // Calculate averages for SharedMatrix
    const matrixTimeAverages = labels.map((cells) => {
        const data = operationData.sharedMatrix[cells];
        if (data && data.times.length > 0) {
            return data.times.reduce((sum, time) => sum + time, 0) / data.times.length;
        }
        return null;
    });

    const matrixMemoryAverages = labels.map((cells) => {
        const data = operationData.sharedMatrix[cells];
        if (data && data.memory.length > 0) {
            return data.memory.reduce((sum, mem) => sum + mem, 0) / data.memory.length;
        }
        return null;
    });

    // Calculate averages for SharedTree
    const treeTimeAverages = labels.map((cells) => {
        const data = operationData.sharedTree[cells];
        if (data && data.times.length > 0) {
            return data.times.reduce((sum, time) => sum + time, 0) / data.times.length;
        }
        return null;
    });

    const treeMemoryAverages = labels.map((cells) => {
        const data = operationData.sharedTree[cells];
        if (data && data.memory.length > 0) {
            return data.memory.reduce((sum, mem) => sum + mem, 0) / data.memory.length;
        }
        return null;
    });

    console.log(`Labels: ${labels}`);
    console.log(`SharedMatrix time averages: ${matrixTimeAverages}`);
    console.log(`SharedMatrix memory averages: ${matrixMemoryAverages}`);
    console.log(`SharedTree time averages: ${treeTimeAverages}`);
    console.log(`SharedTree memory averages: ${treeMemoryAverages}`);

    // Update the time chart
    timeChart.data.labels = labels;
    timeChart.data.datasets[0].data = matrixTimeAverages; // SharedMatrix time
    timeChart.data.datasets[1].data = treeTimeAverages; // SharedTree time
    timeChart.update("none");

    // Update the memory chart
    memoryChart.data.labels = labels;
    memoryChart.data.datasets[0].data = matrixMemoryAverages; // SharedMatrix memory
    memoryChart.data.datasets[1].data = treeMemoryAverages; // SharedTree memory
    memoryChart.update("none");
}

// Function to remove the SharedMatrix
async function removeSharedMatrix(sharedMatrix) {
    // Capture the number of cells before removal
    const cellCount = sharedMatrix.rowCount * sharedMatrix.colCount;
    
    await gc();
    // Measure memory before the operation
    const memoryBefore = performance.memory ? performance.memory.usedJSHeapSize : null;
    // Measure time before operation
    const start = performance.now();

    // Operation
    if (sharedMatrix) { 
        await sharedMatrix.removeRows(0, sharedMatrix.rowCount);
        await sharedMatrix.removeCols(0, sharedMatrix.colCount);
    }

    // Measure time after operation
    const end = performance.now();
    const timeTaken = end - start;

    // Measure memory after the operation
    const memoryAfter = performance.memory ? performance.memory.usedJSHeapSize : null;
    const memoryMB = memoryAfter ? memoryAfter / 1024 / 1024 : null;
    if (memoryBefore && memoryAfter) {
        const memoryDelta = (memoryAfter - memoryBefore) / 1024 / 1024;
        console.log("Memory delta: ", memoryDelta.toFixed(2), "MB");
    }

    console.log("Total cells removed: ", cellCount);
    console.log("Removing cells took: ", timeTaken, "ms");

    // Update the remove chart using the captured cell count
    updateSeparateCharts(removeTimeChart, removeMemoryChart, removeData, "sharedMatrix", cellCount, timeTaken, memoryMB);
}

// Function to update the SharedMatrix with new CSV data
async function updateSharedMatrix(sharedMatrix, csvData) {
    const rowCount = csvData.length;
    const colCount = csvData[0]?.length || 0;

    console.log("Updating SharedMatrix - Row count: ", rowCount);
    console.log("Updating SharedMatrix - Col count: ", colCount);

    // Ensure the matrix has the right dimensions (this should already be done in populate)
    if (sharedMatrix.rowCount !== rowCount) {
        throw new Error("Row count mismatch during update. Please ensure the matrix is populated correctly before updating.");
    }
    if (sharedMatrix.colCount !== colCount) {
       throw new Error("Column count mismatch during update. Please ensure the matrix is populated correctly before updating.");
    }

    await gc();
    // Measure memory before the operation
    const memoryBefore = performance.memory ? performance.memory.usedJSHeapSize : null;
    const start = performance.now();

    // Operation
	for (let row = 0; row < rowCount; row++) {
		for (let col = 0; col < colCount; col++) {
            // Ensure cell is a string and clean any control characters
            const cleanCell = String(csvData[row][col] || "").replace(/[\x00-\x1F\x7F]/g, '');
			await sharedMatrix.setCell(row, col, cleanCell + "_updated"); // Add suffix to show it's updated
		}
	}

    // Measure time after operation
    const end = performance.now();
    const timeTaken = end - start;

    // Measure memory after the operation
    const memoryAfter = performance.memory ? performance.memory.usedJSHeapSize : null;
    const memoryMB = memoryAfter ? memoryAfter / 1024 / 1024 : null;

    console.log("Total cells updated: ", sharedMatrix.rowCount * sharedMatrix.colCount);
    console.log("Updating cells took: ", timeTaken, "ms");
    if (memoryBefore && memoryAfter) {
        const memoryDelta = (memoryAfter - memoryBefore) / 1024 / 1024;
        console.log("Memory delta: ", memoryDelta.toFixed(2), "MB");
    }

    // Update the chart
    updateSeparateCharts(updateTimeChart, updateMemoryChart, updateData, "sharedMatrix", ((rowCount) * colCount), timeTaken, memoryMB);
}

// Function to populate the SharedMatrix with CSV data
async function populateSharedMatrix(sharedMatrix, csvData) {
    const rowCount = csvData.length;
    const colCount = csvData[0]?.length || 0;

    console.log("Row count: ", rowCount);
    console.log("Col count: ", colCount);
    
    // Clear the old SharedMatrix
    if (sharedMatrix.rowCount > 0) {
        sharedMatrix.removeRows(0, sharedMatrix.rowCount);
    }
    if (sharedMatrix.colCount > 0) {
        sharedMatrix.removeCols(0, sharedMatrix.colCount);
    }

    await gc();
    // Measure memory before the operation
    const memoryBefore = performance.memory ? performance.memory.usedJSHeapSize : null;
    const start = performance.now();
    
    // Operation
    await sharedMatrix.insertRows(0, rowCount);
    await sharedMatrix.insertCols(0, colCount);
    for (let row = 0; row < rowCount; row++) {
		for (let col = 0; col < colCount; col++) {
            // Ensure cell is a string and clean any control characters
            const cleanCell = String(csvData[row][col] || "").replace(/[\x00-\x1F\x7F]/g, '');
			await sharedMatrix.setCell(row, col, cleanCell); // Add suffix to show it's updated
		}
	}

    // Measure time after operation
    const end = performance.now();
    const timeTaken = end - start;

    // Measure memory after the operation
    const memoryAfter = performance.memory ? performance.memory.usedJSHeapSize : null;
    const memoryMB = memoryAfter ? memoryAfter / 1024 / 1024 : null;

    console.log("Total cells set: ", sharedMatrix.rowCount * sharedMatrix.colCount);
    console.log("Setting cells took: ", timeTaken, "ms");
    if (memoryBefore && memoryAfter) {
        const memoryDelta = (memoryAfter - memoryBefore) / 1024 / 1024;
        console.log("Memory delta: ", memoryDelta.toFixed(2), "MB");
    }

    // Update the chart
    updateSeparateCharts(creationTimeChart, creationMemoryChart, creationData, "sharedMatrix", ((rowCount) * colCount), timeTaken, memoryMB);
}

async function removeSharedTree(sharedTreeView) {
    const treeTable = sharedTreeView.root;
    const rowCount = treeTable.rows.length;
    const colCount = treeTable.columns.length;
    const cellCount = rowCount * colCount;

    const { start, memoryBefore } = await initializePerformanceMeasurement();

    // operation
    for (let i = 0; i < rowCount; i++) {
        const row = treeTable.rows[0];
        treeTable.removeRow(row);
    }

    for (let j = 0; j < colCount; j++) {
        const column = treeTable.columns[0];
        treeTable.removeColumn(column);
    }

    // Measure time after operation
    const end = performance.now();
    const timeTaken = end - start;

    // Measure memory after the operation
    const memoryAfter = performance.memory ? performance.memory.usedJSHeapSize : null;
    const memoryMB = memoryAfter ? memoryAfter / 1024 / 1024 : null;

    if (memoryBefore && memoryAfter) {
        const memoryDelta = (memoryAfter - memoryBefore) / 1024 / 1024;
        console.log("Memory delta: ", memoryDelta.toFixed(2), "MB");
    }

    // Update the remove chart using the captured cell count
    updateSeparateCharts(removeTimeChart, removeMemoryChart, removeData, "sharedTree", cellCount, timeTaken, memoryMB);
}

async function updateSharedTree(sharedTreeView, csvData) {
    console.log("Updating SharedTree with new data");
    const rowCount = csvData.length;
    const colCount = csvData[0]?.length || 0;
    
    // Check schema compatibility first
    if (sharedTreeView.compatibility.canView === false) {
        console.log("SharedTree is out of schema, cannot update");
        return;
    }
    
    // Get the existing tree data
    const treeTable = sharedTreeView.root;
    const { start, memoryBefore } = await initializePerformanceMeasurement();
    
    for (let i = 0; i < rowCount; i++) {
        const row = treeTable.rows[i];
		for (let j = 0; j < colCount; j++) {
            const column = treeTable.columns[j];
			treeTable.setCell({
				key: {
					column,
					row,
				},
				cell: String(csvData[i][j] || "").replace(/[\x00-\x1F\x7F]/g, '') + "_updated", // Add suffix to show it's updated
			});
		}
	}
    
    const end = performance.now();
    const timeTaken = end - start;
    console.log("Updating SharedTree took:", timeTaken, "ms");

    // Measure memory after the operation
    const memoryAfter = performance.memory ? performance.memory.usedJSHeapSize : null;
    const memoryMB = memoryAfter ? memoryAfter / 1024 / 1024 : null;

    if (memoryBefore && memoryAfter) {
        const memoryDelta = (memoryAfter - memoryBefore) / 1024 / 1024;
        console.log("Memory delta: ", memoryDelta.toFixed(2), "MB");
    }

    // Calculate the number of cells updated
    const cellsUpdated = treeTable.rows.length * treeTable.columns.length;

    // Update the SharedTree chart
    updateSeparateCharts(updateTimeChart, updateMemoryChart, updateData, "sharedTree", cellsUpdated, timeTaken, memoryMB);
}

async function populateSharedTree(sharedTreeView, csvData) {
    console.log("Populating SharedTree with CSV data");
    const rowCount = csvData.length;
    const colCount = csvData[0]?.length || 0;
 
    // Clear existing data first
    sharedTreeView.root = Table.empty();
    const treeTable = sharedTreeView.root;

    const { start, memoryBefore } = await initializePerformanceMeasurement();
    
    try {
        for (let j = 0; j < colCount; j++) {
            const column = new Column({});
            treeTable.insertColumn({ index: j, column });
        }
        console.log("Columns inserted: ", treeTable.columns.length);

        for (let i = 0; i < rowCount; i++) {
            treeTable.insertRow({ index: i, row: new Row({ cells: {} }) });
        }
        console.log("Rows inserted: ", treeTable.rows.length);
        
    } catch (e) {
        console.error("Error populating SharedTree:", e);
    }
    
    // Populate cells with data after structure is created
    for (let i = 0; i < rowCount; i++) {
        const row = treeTable.rows[i];
		for (let j = 0; j < colCount; j++) {
            const column = treeTable.columns[j];
			treeTable.setCell({
				key: {
					column,
					row,
				},
				cell: String(csvData[i][j] || "").replace(/[\x00-\x1F\x7F]/g, ''),
			});
		}
	}

    // Measure time after operation
    const end = performance.now();
    const timeTaken = end - start;

    // Measure memory after the operation
    const memoryAfter = performance.memory ? performance.memory.usedJSHeapSize : null;
    const memoryMB = memoryAfter ? memoryAfter / 1024 / 1024 : null;

    console.log("Populating SharedTree took:", timeTaken, "ms");
    if (memoryBefore && memoryAfter) {
        const memoryDelta = (memoryAfter - memoryBefore) / 1024 / 1024;
        console.log("Memory delta: ", memoryDelta.toFixed(2), "MB");
    }

    // Calculate total cells
    const totalCells = csvData.length * (csvData[0]?.length || 0);

    // Update the SharedTree chart
    updateSeparateCharts(creationTimeChart, creationMemoryChart, creationData, "sharedTree", totalCells, timeTaken, memoryMB);
}

// Initialize the charts when the app starts
initializeCharts();

const fullPerformanceTestButton = document.getElementById("fullPerformanceTest");
const runningIcon = document.getElementById("runningIcon");

async function gc() {
    window.gc && window.gc();
	await new Promise((resolve) => setTimeout(resolve, 1000));
}

/**
 * Helper function to initialize performance measurement baseline
 * Ensures clean memory state and captures initial timing/memory metrics
 * @returns {Object} Object containing start time and initial memory measurement
 */
async function initializePerformanceMeasurement() {
    await gc(); // Force garbage collection for clean memory baseline
    // Measure memory before the operation
    const memoryBefore = performance.memory ? performance.memory.usedJSHeapSize : null;
    // Measure time before operation
    const start = performance.now();
    
    return { start, memoryBefore };
}

async function runFullPerformanceTest() {
    console.log("Starting full performance test...");
    runningIcon.style.display = "inline"; // Show the running icon

    const testFilesFolder = ""; // Folder containing test CSV files
    const testFiles = await fetchTestFiles(testFilesFolder); // Fetch the list of test files
    const iterations = FULL_TEST_ITERATIONS; // Number of times to test each file with each DDS

    for (let i = 0; i < iterations; i++) {
        console.log(`Iteration ${i + 1} of ${iterations}`);
		for (const fileName of testFiles) {
			console.log(`Testing file: ${fileName}`);
       		const fileContent = await fetchFileContent(`${testFilesFolder}/${fileName}`);

            await operateDDS("SharedTree", fileContent);
            await gc();
        }

		for (const fileName of testFiles) {
			console.log(`Testing file: ${fileName}`);
       		const fileContent = await fetchFileContent(`${testFilesFolder}/${fileName}`);

            await operateDDS("SharedMatrix", fileContent);
			await gc();
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
        // app crashes with larger files, mainly due to sharedTree performance/memory issues
        // Uncomment these lines to test larger files if needed
		// "customers-20000.csv", 
		// "customers-30000.csv",
		//"customers-40000.csv",
		//"customers-50000.csv",
		// "customers-60000.csv",
		// "customers-70000.csv",
		// "customers-80000.csv",
		// "customers-90000.csv",
		// "customers-100000.csv"
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

// Create, update, remove a specific DDS with the given file content
async function operateDDS(ddsType, fileContent) {
    const csvData = parseCSV(fileContent); // Parse the CSV content into an array
    console.log(`Operating on ${ddsType} with CSV data`);
    
    if (ddsType === "SharedMatrix") {
        await populateSharedMatrix(sharedMatrix, csvData);
        await updateSharedMatrix(sharedMatrix, csvData);
        await removeSharedMatrix(sharedMatrix);
    } else if (ddsType === "SharedTree") {
        await populateSharedTree(sharedTreeView, csvData);
        await updateSharedTree(sharedTreeView, csvData);
        await removeSharedTree(sharedTreeView);
    }

    console.log(`${ddsType} operations completed`);
}

// Parse CSV content into a 2D array
function parseCSV(content) {
    console.log("Starting CSV parsing...");
    
    // Clean the content by removing only specific control characters but keep newlines
    const cleanedContent = content.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
    
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;
    
    for (let i = 0; i < cleanedContent.length; i++) {
        const char = cleanedContent[i];
        const nextChar = cleanedContent[i + 1];
        
        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                // Handle escaped quotes ("") - add one quote to cell content
                currentCell += '"';
                i++; // Skip the next quote
            } else {
                // Toggle quote state - don't add quote to cell content
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            // End of field - comma outside quotes
            currentRow.push(currentCell.trim());
            currentCell = '';
        } else if (char === '\n' && !insideQuotes) {
            // End of row - newline outside quotes
            currentRow.push(currentCell.trim());
            if (currentRow.length > 0 && currentRow.some(cell => cell !== '')) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentCell = '';
        } else {
            // Regular character - add to current cell
            currentCell += char;
        }
    }
    
    // Add the last cell and row if there's content
    if (currentCell || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        if (currentRow.length > 0 && currentRow.some(cell => cell !== '')) {
            rows.push(currentRow);
        }
    }
    
    // Ensure consistent column count
    if (rows.length > 0) {
        const maxColCount = Math.max(...rows.map(row => row.length));
        const normalizedRows = rows.map(row => {
            while (row.length < maxColCount) {
                row.push(''); // Add empty strings for missing cells
            }
            return row;
        });
        
        return normalizedRows;
    }
    
    return rows;
}

// Attach event listener to the button
fullPerformanceTestButton.addEventListener("click", runFullPerformanceTest);

start().then(() => {
    console.log("App started");
}).catch((error) => console.error(error));