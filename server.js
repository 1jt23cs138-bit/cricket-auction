const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = "2026";

const DATA_FILE = path.join(__dirname, "auction-data.json");


// ============================================================
// TEAMS
// ============================================================

const TEAM_NAMES = [
    "Chida Team",
    "Suraj Team",
    "Siddu Team",
    "Nithin Team",
    "Kshamay Team"
];

const INITIAL_BUDGET = 20000;


// ============================================================
// ALL PLAYERS
// IMPORTANT:
// DO NOT REMOVE DUPLICATES
// DO NOT FILTER YES / NO
// DO NOT CHANGE THE LIST
// ============================================================

const DEFAULT_PLAYERS = [
    "Adarsh",
    "Preetham KP",
    "Abhinayakumar",
    "Abhishek Purad",
    "Mahanth",
    "Sriniketh C.H",
    "Rohan",
    "CHIDANANDA G",
    "Daksh Sharma",
    "Mahesh S B",
    "Siddharth P H",
    "Prayas upase",
    "Varun N Shetty",
    "Sujal",
    "B Ajay",
    "SUHAS HANAMAPPA M",
    "Dhanush",
    "Preetham HM",
    "Balmukund",
    "Veda Prakash Reddy.O",
    "Vishwas",
    "Virupaksha kulkarni",
    "Achyuth",
    "Hithesh M O",
    "MEGHARAJ R M",
    "Halesh N M",
    "K Manoj",
    "Kshamay P Bharadwaj",
    "Shrikara M",
    "Jashwanth P",
    "Jogi",
    "Yashwanthkumar",
    "Amogha Bhat",
    "Shyam",
    "Tarun kulkarni",
    "B. Nithin",
    "Harsh Kumar",
    "Jeevan Bhat",
    "Dharanesh MN",
    "Krishna",
    "Chaluvaraj",
    "Akash C",
    "Manmith",
    "Vishnu",
    "Koushik ak",
    "Harsh Kumar",
    "Santanu Kumar Tunga",
    "Srikrishna",
    "Shrikant",
    "Shashank gowda s"
];


// ============================================================
// CREATE NEW AUCTION
// ============================================================

function createNewAuction() {

    return {

        players: DEFAULT_PLAYERS.map((name, index) => ({
            id: index + 1,
            name: name,
            status: "pending",
            team: null,
            amount: 0
        })),

        teams: TEAM_NAMES.map(name => ({
            name: name,
            budget: INITIAL_BUDGET,
            spent: 0,
            players: []
        })),

        current: 0,

        liveBid: 200,

        liveBidTeam: null,

        history: []
    };
}


// ============================================================
// LOAD SAVED AUCTION
// ============================================================

let state;

function loadState() {

    try {

        if (fs.existsSync(DATA_FILE)) {

            const data =
                fs.readFileSync(DATA_FILE, "utf8");

            state = JSON.parse(data);

            normalizeState();

            console.log("Saved auction loaded.");

        } else {

            state = createNewAuction();

            saveState();

            console.log("New auction created.");
        }

    } catch (error) {

        console.log("Error loading auction:");
        console.log(error);

        state = createNewAuction();

        saveState();
    }
}


// ============================================================
// SAVE
// ============================================================

function saveState() {

    try {

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(state, null, 2),
            "utf8"
        );

    } catch (error) {

        console.log("Error saving auction:");
        console.log(error);
    }
}


// ============================================================
// NORMALIZE STATE
// ============================================================

function normalizeState() {

    if (!state || typeof state !== "object") {

        state = createNewAuction();

        return;
    }


    if (!Array.isArray(state.players)) {
        state.players = [];
    }


    if (!Array.isArray(state.teams)) {
        state.teams = [];
    }


    if (!Array.isArray(state.history)) {
        state.history = [];
    }


    if (typeof state.current !== "number") {
        state.current = 0;
    }


    if (typeof state.liveBid !== "number") {
        state.liveBid = 200;
    }


    if (state.liveBidTeam === undefined) {
        state.liveBidTeam = null;
    }


    // --------------------------------------------------------
    // ENSURE PLAYER IDs
    // --------------------------------------------------------

    state.players.forEach((player, index) => {

        if (!player.id) {
            player.id = index + 1;
        }

        if (!player.name) {
            player.name = "Unnamed Player";
        }

        if (!player.status) {
            player.status = "pending";
        }

        if (typeof player.amount !== "number") {
            player.amount =
                Number(player.amount) || 0;
        }

        if (
            player.status !== "sold" &&
            player.status !== "unsold"
        ) {

            player.status = "pending";
        }

    });


    // --------------------------------------------------------
    // CREATE TEAM STRUCTURE
    // --------------------------------------------------------

    const oldTeams =
        Array.isArray(state.teams)
            ? state.teams
            : [];


    const oldTeamMap = {};


    oldTeams.forEach(team => {

        if (team && team.name) {

            oldTeamMap[team.name] = team;
        }

    });


    state.teams =
        TEAM_NAMES.map(name => {

            const oldTeam =
                oldTeamMap[name];


            return {

                name: name,

                budget:
                    oldTeam &&
                    typeof oldTeam.budget === "number"
                        ? oldTeam.budget
                        : INITIAL_BUDGET,

                spent: 0,

                players: []
            };

        });


    // --------------------------------------------------------
    // REBUILD TEAM DATA
    // --------------------------------------------------------

    rebuildTeams();
}


// ============================================================
// REBUILD TEAMS
// ============================================================

function rebuildTeams() {

    state.teams.forEach(team => {

        team.spent = 0;

        team.players = [];

    });


    state.players.forEach(player => {

        if (player.status !== "sold") {
            return;
        }


        const team =
            state.teams.find(
                t => t.name === player.team
            );


        if (!team) {
            return;
        }


        const amount =
            Number(player.amount) || 0;


        team.spent += amount;


        team.players.push({

            id: player.id,

            name: player.name,

            amount: amount

        });

    });
}


// ============================================================
// SAVE HISTORY
// ============================================================

function saveHistory() {

    const snapshot =
        JSON.stringify({

            players: state.players,

            teams: state.teams,

            current: state.current,

            liveBid: state.liveBid,

            liveBidTeam: state.liveBidTeam,

            history: []

        });


    state.history.push(snapshot);


    // Keep last 50 changes
    if (state.history.length > 50) {

        state.history.shift();
    }
}


// ============================================================
// BROADCAST
// ============================================================

function broadcast() {

    rebuildTeams();

    saveState();

    io.emit("update", state);
}


// ============================================================
// ERROR MESSAGE
// ============================================================

function sendError(socket, message) {

    socket.emit(
        "errorMsg",
        message
    );
}


// ============================================================
// VALID PLAYER
// ============================================================

function validPlayer(index) {

    return (
        Number.isInteger(index) &&
        index >= 0 &&
        index < state.players.length
    );
}


// ============================================================
// STATIC FILES
// ============================================================

app.use(express.static(__dirname));


// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "index.html")
    );

});


// ============================================================
// DOWNLOAD TEAM-WISE CSV
// ============================================================

app.get("/download-excel", (req, res) => {

    rebuildTeams();


    let csv = "";


    // --------------------------------------------------------
    // TEAM BY TEAM
    // --------------------------------------------------------

    state.teams.forEach(team => {

        csv += `"${escapeCSV(team.name)}"\n`;

        csv += `"Player Name","Sold Price"\n`;


        if (team.players.length === 0) {

            csv += `"No players",""\n`;

        } else {

            team.players.forEach(player => {

                csv +=
                    `"${escapeCSV(player.name)}","${player.amount}"\n`;

            });

        }


        csv +=
            `"Total Spent","${team.spent}"\n`;

        csv +=
            `"Remaining Budget","${team.budget - team.spent}"\n`;

        csv += "\n\n";

    });


    // --------------------------------------------------------
    // COMPLETE SOLD LIST
    // --------------------------------------------------------

    csv += `"ALL SOLD PLAYERS"\n`;

    csv +=
        `"Player Name","Team","Sold Price"\n`;


    state.players
        .filter(
            player =>
                player.status === "sold"
        )
        .forEach(player => {

            csv +=
                `"${escapeCSV(player.name)}","${escapeCSV(player.team)}","${player.amount}"\n`;

        });


    res.setHeader(
        "Content-Type",
        "text/csv; charset=utf-8"
    );


    res.setHeader(
        "Content-Disposition",
        "attachment; filename=cricket-auction-team-wise.csv"
    );


    res.send(csv);

});


// ============================================================
// CSV ESCAPE
// ============================================================

function escapeCSV(value) {

    return String(value ?? "")
        .replace(/"/g, '""');
}


// ============================================================
// SOCKET.IO
// ============================================================

io.on("connection", socket => {

    console.log(
        "Client connected:",
        socket.id
    );


    // Send current state immediately
    socket.emit(
        "update",
        state
    );


    // ========================================================
    // ADMIN LOGIN
    // ========================================================

    socket.on("login", pin => {

        const correct =
            String(pin) === ADMIN_PIN;


        socket.emit(
            "login",
            correct
        );

    });


    // ========================================================
    // SELECT PLAYER
    // ========================================================

    socket.on("select", index => {

        index = Number(index);


        if (!validPlayer(index)) {

            sendError(
                socket,
                "Invalid player."
            );

            return;
        }


        state.current = index;


        const player =
            state.players[index];


        if (player.status === "pending") {

            state.liveBid = 200;

            state.liveBidTeam = null;

        }


        broadcast();

    });


    // ========================================================
    // UPDATE BID
    // ========================================================

    socket.on("bid", data => {

        const playerIndex =
            Number(data?.playerIndex);

        const teamIndex =
            Number(data?.team);

        const amount =
            Number(data?.amount);


        if (!validPlayer(playerIndex)) {

            sendError(
                socket,
                "Invalid player."
            );

            return;
        }


        if (!state.teams[teamIndex]) {

            sendError(
                socket,
                "Invalid team."
            );

            return;
        }


        const player =
            state.players[playerIndex];


        if (player.status !== "pending") {

            sendError(
                socket,
                "This player is already completed."
            );

            return;
        }


        if (
            !Number.isFinite(amount) ||
            amount < 200
        ) {

            sendError(
                socket,
                "Minimum price is ₹200."
            );

            return;
        }


        const team =
            state.teams[teamIndex];


        const remaining =
            team.budget - team.spent;


        if (amount > remaining) {

            sendError(
                socket,
                `${team.name} has only ₹${remaining} remaining.`
            );

            return;
        }


        state.current =
            playerIndex;


        state.liveBid =
            amount;


        state.liveBidTeam =
            teamIndex;


        broadcast();

    });


    // ========================================================
    // SOLD
    // ========================================================

    socket.on("sold", data => {

        const playerIndex =
            Number(data?.playerIndex);

        const teamIndex =
            Number(data?.team);

        const amount =
            Number(data?.amount);


        if (!validPlayer(playerIndex)) {

            sendError(
                socket,
                "Invalid player."
            );

            return;
        }


        if (!state.teams[teamIndex]) {

            sendError(
                socket,
                "Invalid team."
            );

            return;
        }


        if (
            !Number.isFinite(amount) ||
            amount < 200
        ) {

            sendError(
                socket,
                "Invalid sale price."
            );

            return;
        }


        const player =
            state.players[playerIndex];


        const team =
            state.teams[teamIndex];


        if (player.status !== "pending") {

            sendError(
                socket,
                "This player is already sold or unsold."
            );

            return;
        }


        const remaining =
            team.budget - team.spent;


        if (amount > remaining) {

            sendError(
                socket,
                `${team.name} has only ₹${remaining} remaining.`
            );

            return;
        }


        // Save state before sale
        saveHistory();


        // ====================================================
        // THIS IS THE IMPORTANT PART
        // EXACT PRICE + EXACT TEAM ARE SAVED
        // ====================================================

        player.status = "sold";

        player.team = team.name;

        player.amount = amount;


        state.current =
            playerIndex;


        state.liveBid = 200;

        state.liveBidTeam = null;


        rebuildTeams();

        broadcast();

    });


    // ========================================================
    // UNSOLD
    // ========================================================

    socket.on("unsold", () => {

        const player =
            state.players[state.current];


        if (!player) {
            return;
        }


        if (player.status !== "pending") {

            sendError(
                socket,
                "This player is already completed."
            );

            return;
        }


        saveHistory();


        player.status = "unsold";

        player.team = null;

        player.amount = 0;


        state.liveBid = 200;

        state.liveBidTeam = null;


        broadcast();

    });


    // ========================================================
    // NEXT PLAYER
    // ========================================================

    socket.on("next", () => {

        if (state.players.length === 0) {
            return;
        }


        let next =
            state.current + 1;


        if (
            next >=
            state.players.length
        ) {

            next = 0;
        }


        state.current =
            next;


        state.liveBid = 200;

        state.liveBidTeam = null;


        broadcast();

    });


    // ========================================================
    // UNDO LAST ACTION
    // ========================================================

    socket.on("undoSale", () => {

        if (
            !Array.isArray(state.history) ||
            state.history.length === 0
        ) {

            sendError(
                socket,
                "Nothing to undo."
            );

            return;
        }


        try {

            const previous =
                state.history.pop();


            const restored =
                JSON.parse(previous);


            state.players =
                restored.players;


            state.teams =
                restored.teams;


            state.current =
                restored.current;


            state.liveBid =
                restored.liveBid;


            state.liveBidTeam =
                restored.liveBidTeam;


            rebuildTeams();

            saveState();

            io.emit(
                "update",
                state
            );

        } catch (error) {

            console.log(error);

            sendError(
                socket,
                "Undo failed."
            );

        }

    });


    // ========================================================
    // ADD PLAYER
    // ========================================================

    socket.on("addPlayer", name => {

        name =
            String(name || "").trim();


        if (!name) {

            sendError(
                socket,
                "Enter player name."
            );

            return;
        }


        saveHistory();


        const nextId =
            state.players.length > 0
                ? Math.max(
                    ...state.players.map(
                        p => Number(p.id) || 0
                    )
                ) + 1
                : 1;


        state.players.push({

            id: nextId,

            name: name,

            status: "pending",

            team: null,

            amount: 0

        });


        state.current =
            state.players.length - 1;


        state.liveBid = 200;

        state.liveBidTeam = null;


        broadcast();

    });


    // ========================================================
    // EDIT PLAYER NAME
    // ========================================================

    socket.on("editPlayer", data => {

        const index =
            Number(data?.index);

        const name =
            String(data?.name || "").trim();


        if (!validPlayer(index)) {

            sendError(
                socket,
                "Invalid player."
            );

            return;
        }


        if (!name) {

            sendError(
                socket,
                "Enter player name."
            );

            return;
        }


        saveHistory();


        state.players[index].name =
            name;


        broadcast();

    });


    // ========================================================
    // DELETE PLAYER
    // ========================================================

    socket.on("removePlayer", index => {

        index = Number(index);


        if (!validPlayer(index)) {

            sendError(
                socket,
                "Invalid player."
            );

            return;
        }


        const player =
            state.players[index];


        // Do not allow sold players
        // to be deleted accidentally

        if (player.status === "sold") {

            sendError(
                socket,
                "Sold players cannot be deleted. Use Correct Sold Player instead."
            );

            return;
        }


        saveHistory();


        state.players.splice(
            index,
            1
        );


        if (state.players.length === 0) {

            state.current = 0;

        } else if (
            state.current >=
            state.players.length
        ) {

            state.current =
                state.players.length - 1;
        }


        broadcast();

    });


    // ========================================================
    // CORRECT SOLD PLAYER
    // ========================================================

    socket.on("editSoldPlayer", data => {

        const index =
            Number(data?.index);

        const teamIndex =
            Number(data?.team);

        const amount =
            Number(data?.amount);


        if (!validPlayer(index)) {

            sendError(
                socket,
                "Invalid player."
            );

            return;
        }


        if (!state.teams[teamIndex]) {

            sendError(
                socket,
                "Invalid team."
            );

            return;
        }


        if (
            !Number.isFinite(amount) ||
            amount < 200
        ) {

            sendError(
                socket,
                "Invalid price."
            );

            return;
        }


        const player =
            state.players[index];


        if (player.status !== "sold") {

            sendError(
                socket,
                "This player is not sold."
            );

            return;
        }


        // ----------------------------------------------------
        // Calculate available money correctly
        // ----------------------------------------------------

        const oldTeam =
            state.teams.find(
                team =>
                    team.name === player.team
            );


        const newTeam =
            state.teams[teamIndex];


        let available =
            newTeam.budget -
            newTeam.spent;


        // If correcting within same team,
        // add old price back first

        if (
            oldTeam &&
            oldTeam.name === newTeam.name
        ) {

            available +=
                Number(player.amount) || 0;
        }


        if (amount > available) {

            sendError(
                socket,
                `${newTeam.name} has only ₹${available} available.`
            );

            return;
        }


        saveHistory();


        // ----------------------------------------------------
        // CHANGE TEAM + PRICE
        // ----------------------------------------------------

        player.team =
            newTeam.name;


        player.amount =
            amount;


        player.status =
            "sold";


        rebuildTeams();

        broadcast();

    });


    // ========================================================
    // RESET AUCTION
    // ========================================================

    socket.on("resetAuction", () => {

        saveHistory();


        state =
            createNewAuction();


        saveState();


        io.emit(
            "update",
            state
        );

    });


    // ========================================================
    // DISCONNECT
    // ========================================================

    socket.on("disconnect", () => {

        console.log(
            "Client disconnected:",
            socket.id
        );

    });

});


// ============================================================
// START SERVER
// ============================================================

loadState();

rebuildTeams();

saveState();


server.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "🏏 CRICKET AUCTION LIVE"
        );
        console.log(
            "========================================"
        );
        console.log(
            `Port: ${PORT}`
        );
        console.log(
            `Players: ${state.players.length}`
        );
        console.log(
            `Teams: ${TEAM_NAMES.join(", ")}`
        );
        console.log(
            `Admin PIN: ${ADMIN_PIN}`
        );
        console.log(
            "========================================"
        );
        console.log("");

    }
);
